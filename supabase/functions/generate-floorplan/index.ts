import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const IMAGE_GEN_MODEL = "gemini-2.0-flash-exp";
const VERIFY_MODEL = "gemini-2.5-flash-preview-05-20";

// ─── Vertex AI Auth ─────────────────────────────────────────────────────

function b64url(data: string): string {
  return btoa(data).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlBytes(arr: Uint8Array): string {
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  const saJson = Deno.env.get("GCP_SERVICE_ACCOUNT_JSON");
  if (!saJson) throw new Error("GCP_SERVICE_ACCOUNT_JSON not configured");
  const sa = JSON.parse(saJson);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  }));
  const signInput = `${header}.${payload}`;
  const pemContent = sa.private_key.replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signInput));
  const sig = b64urlBytes(new Uint8Array(signature));
  const jwt = `${header}.${payload}.${sig}`;
  const tokenRes = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
  return (await tokenRes.json()).access_token;
}

function getProjectId(): string {
  return JSON.parse(Deno.env.get("GCP_SERVICE_ACCOUNT_JSON")!).project_id;
}

async function callVertexAI(accessToken: string, projectId: string, model: string, contents: any[], systemInstruction?: any, generationConfig?: any): Promise<any> {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;
  const body: any = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (generationConfig) body.generationConfig = generationConfig;
  const resp = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!resp.ok) {
    const t = await resp.text();
    if (resp.status === 429) throw { status: 429, message: "Rate limit exceeded. Please try again." };
    throw new Error(`Vertex AI [${model}] failed [${resp.status}]: ${t}`);
  }
  return await resp.json();
}

function extractText(data: any): string {
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
}

function extractImage(data: any): string | null {
  for (const part of (data.candidates?.[0]?.content?.parts || [])) {
    if (part.inlineData) return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
  }
  return null;
}

// ─── Generate & Verify ──────────────────────────────────────────────────

async function generateImage(accessToken: string, projectId: string, prompt: string, imageBase64?: string): Promise<{ image_url: string | null; description: string }> {
  const parts: any[] = [{ text: prompt }];
  if (imageBase64) {
    const raw = imageBase64.startsWith("data:") ? imageBase64.split(",")[1] : imageBase64;
    parts.push({ inlineData: { mimeType: "image/jpeg", data: raw } });
  }

  const data = await callVertexAI(accessToken, projectId, IMAGE_GEN_MODEL,
    [{ role: "user", parts }],
    undefined,
    { responseModalities: ["IMAGE", "TEXT"] }
  );

  return { image_url: extractImage(data), description: extractText(data) };
}

async function verifyGeneration(accessToken: string, projectId: string, generatedImageUrl: string, originalPrompt: string): Promise<{ passed: boolean; feedback: string }> {
  try {
    const raw = generatedImageUrl.startsWith("data:") ? generatedImageUrl.split(",")[1] : generatedImageUrl;
    const data = await callVertexAI(accessToken, projectId, VERIFY_MODEL,
      [{ role: "user", parts: [
        { text: `Original requirements: ${originalPrompt.substring(0, 500)}` },
        { inlineData: { mimeType: "image/png", data: raw } },
      ]}],
      { parts: [{ text: `You are an architectural drawing quality inspector. Evaluate the generated floor plan. Return ONLY JSON: { "passed": true/false, "feedback": "brief reason" }. Pass if: clear 2D floor plan with room labels, walls, doors. Fail if: blurry, 3D perspective, no labels.` }] }
    );
    const content = extractText(data);
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { passed: !!parsed.passed, feedback: parsed.feedback || "" };
    }
    return { passed: true, feedback: "Could not parse verification" };
  } catch (err) {
    console.error("Verification error:", err);
    return { passed: true, feedback: "Verification skipped" };
  }
}

// ─── Main Handler ───────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { analysisData, aiSuggestions, userSuggestions, imageBase64 } = await req.json();
    if (!analysisData) {
      return new Response(JSON.stringify({ error: "analysisData is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await getAccessToken();
    const projectId = getProjectId();

    const rooms = analysisData.rooms || [];
    const roomDescriptions = rooms.map((r: any) =>
      `${r.label || r.type} (${r.estimatedSqFt || 0} sq ft, position: ${r.x || 0}%x${r.y || 0}%, size: ${r.width || 0}%x${r.height || 0}%)`
    ).join("\n  - ");
    const aiRecsList = (aiSuggestions || []).map((s: string) => `- ${s}`).join("\n");
    const userReqs = userSuggestions || "";

    const prompt = `You are an expert architectural drafter. Generate a REDESIGNED 2D architectural floor plan drawing.

CRITICAL EDGE-PRESERVATION INSTRUCTIONS (Canny ControlNet approach):
- Study the EDGE STRUCTURE and WALL BOUNDARIES of the original floor plan image carefully
- PRESERVE the overall building envelope, exterior wall positions, and structural grid
- Only modify INTERIOR partitions, room sizes, and door/window placements as specified
- Maintain the same scale, orientation, and drawing style as the original
- Keep load-bearing walls in their exact positions

CURRENT LAYOUT:
  Total Area: ${analysisData.totalArea || "unknown"} sq ft
  Layout Score: ${analysisData.score || "N/A"}/10
  Rooms:
  - ${roomDescriptions}

ARCHITECTURAL RECOMMENDATIONS TO APPLY:
${aiRecsList || "None specified"}

CLIENT REQUIREMENTS:
${userReqs || "None specified"}

DRAWING SPECIFICATIONS:
- Clean, professional 2D top-down architectural floor plan
- Black lines on white background, standard architectural line weights
- Include: room labels with dimensions, door swings, window markers
- Show wall thicknesses (exterior: 12", interior: 6")
- Add dimension lines for major room measurements`;

    console.log("Generating floor plan (attempt 1)...");
    let result = await generateImage(accessToken, projectId, prompt, imageBase64);

    if (result.image_url) {
      console.log("Verifying generated floor plan quality...");
      const verification = await verifyGeneration(accessToken, projectId, result.image_url, prompt);
      console.log(`Verification: passed=${verification.passed}, feedback=${verification.feedback}`);

      if (!verification.passed) {
        console.log("Verification failed, regenerating (attempt 2)...");
        const retryPrompt = `${prompt}\n\nIMPORTANT CORRECTION:\n${verification.feedback}\nPlease ensure clear 2D architectural floor plan with all room labels visible.`;
        result = await generateImage(accessToken, projectId, retryPrompt, imageBase64);
        if (result.image_url) result.description = `[Refined] ${result.description}`;
      }
    }

    return new Response(JSON.stringify({ image_url: result.image_url, description: result.description }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    if (e?.status === 429) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("generate-floorplan error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
