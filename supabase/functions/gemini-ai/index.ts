import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.2.0/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Models
const IMAGE_GEN_MODEL = "gemini-2.0-flash-exp";
const VISION_MODEL = "gemini-2.5-flash-preview-05-20";
const CHAT_MODEL = "gemini-2.5-flash-preview-05-20";

/** Get access token using service account JWT */
async function getAccessToken(): Promise<string> {
  const saJson = Deno.env.get("GCP_SERVICE_ACCOUNT_JSON");
  if (!saJson) throw new Error("GCP_SERVICE_ACCOUNT_JSON not configured");

  const sa = JSON.parse(saJson);
  const privateKey = await importPKCS8(sa.private_key, "RS256");

  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/cloud-platform",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(sa.token_uri)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  const tokenRes = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

function getProjectId(): string {
  const saJson = Deno.env.get("GCP_SERVICE_ACCOUNT_JSON");
  if (!saJson) throw new Error("GCP_SERVICE_ACCOUNT_JSON not configured");
  return JSON.parse(saJson).project_id;
}

/** Call Vertex AI Gemini API */
async function callVertexAI(
  accessToken: string,
  projectId: string,
  model: string,
  contents: any[],
  systemInstruction?: any,
  generationConfig?: any,
): Promise<any> {
  const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/${model}:generateContent`;

  const body: any = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (generationConfig) body.generationConfig = generationConfig;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`Vertex AI error [${model}]:`, resp.status, errText);
    if (resp.status === 429) {
      throw { status: 429, message: "Rate limit exceeded. Please try again in a moment." };
    }
    if (resp.status === 402 || resp.status === 403) {
      throw { status: 402, message: "API quota exceeded or permission denied. Check your GCP project." };
    }
    throw new Error(`Vertex AI failed [${resp.status}]: ${errText}`);
  }

  return await resp.json();
}

/** Extract text from Vertex AI response */
function extractText(data: any): string {
  return data.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text || "")
    .join("") || "";
}

/** Extract inline image from Vertex AI response */
function extractImage(data: any): string | null {
  for (const part of (data.candidates?.[0]?.content?.parts || [])) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  return null;
}

/** Handle error responses */
function handleErrorResponse(e: any, context: string) {
  if (e?.status === 429) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
      status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (e?.status === 402) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  console.error(`${context} error:`, e);
  return new Response(JSON.stringify({ error: `${context} failed`, details: e?.message || String(e) }), {
    status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const accessToken = await getAccessToken();
    const projectId = getProjectId();

    const body = await req.json();
    const { action, prompt, imageBase64, messages, systemPrompt } = body;

    // ── ACTION: generate-image ──
    if (action === "generate-image") {
      const parts: any[] = [{ text: prompt || "Generate an image" }];

      if (imageBase64) {
        const raw = imageBase64.startsWith("data:")
          ? imageBase64.split(",")[1]
          : imageBase64;
        parts.push({ inlineData: { mimeType: "image/jpeg", data: raw } });
      }

      const data = await callVertexAI(accessToken, projectId, IMAGE_GEN_MODEL,
        [{ role: "user", parts }],
        undefined,
        { responseModalities: ["IMAGE", "TEXT"] }
      );

      const image_url = extractImage(data);
      const description = extractText(data);

      return new Response(JSON.stringify({ image_url, description }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: vision ──
    if (action === "vision") {
      if (!imageBase64) {
        return new Response(JSON.stringify({ error: "imageBase64 is required for vision" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const raw = imageBase64.startsWith("data:")
        ? imageBase64.split(",")[1]
        : imageBase64;

      const data = await callVertexAI(accessToken, projectId, VISION_MODEL,
        [{
          role: "user",
          parts: [
            { text: prompt || "Describe this image" },
            { inlineData: { mimeType: "image/jpeg", data: raw } },
          ],
        }]
      );

      const text = extractText(data);
      return new Response(JSON.stringify({ text }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: chat ──
    if (action === "chat") {
      const contents: any[] = [];
      let sysInstruction = undefined;

      if (systemPrompt) {
        sysInstruction = { parts: [{ text: systemPrompt }] };
      }

      for (const msg of (messages || [])) {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }

      const data = await callVertexAI(accessToken, projectId, CHAT_MODEL, contents, sysInstruction);
      const text = extractText(data);

      return new Response(JSON.stringify({ text }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use: generate-image, vision, or chat" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return handleErrorResponse(e, "gemini-ai");
  }
});
