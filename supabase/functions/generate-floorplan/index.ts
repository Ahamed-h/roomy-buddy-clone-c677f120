import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const IMAGE_GEN_MODEL = "google/gemini-2.5-flash-image";
const VERIFY_MODEL = "google/gemini-2.5-flash";

async function generateImage(apiKey: string, prompt: string, imageBase64?: string): Promise<{ image_url: string | null; description: string }> {
  const contentParts: any[] = [{ type: "text", text: prompt }];

  if (imageBase64) {
    const imageUrl = imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
    contentParts.push({ type: "image_url", image_url: { url: imageUrl } });
  }

  const resp = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_GEN_MODEL,
      messages: [{ role: "user", content: contentParts }],
      modalities: ["image", "text"],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("Floorplan gen error:", resp.status, errText);
    if (resp.status === 429) throw { status: 429, message: "Rate limit exceeded. Please try again." };
    if (resp.status === 402) throw { status: 402, message: "Payment required. Please add credits." };
    throw new Error(`Failed to generate floor plan image: ${resp.status}`);
  }

  const data = await resp.json();
  const msg = data.choices?.[0]?.message;
  return {
    image_url: msg?.images?.[0]?.image_url?.url || null,
    description: msg?.content || "",
  };
}

async function verifyGeneration(apiKey: string, generatedImageUrl: string, originalPrompt: string): Promise<{ passed: boolean; feedback: string }> {
  try {
    const resp = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VERIFY_MODEL,
        messages: [
          {
            role: "system",
            content: `You are an architectural drawing quality inspector. Return ONLY a JSON object: { "passed": true/false, "feedback": "brief reason" }. Pass if it shows a clear 2D floor plan with room labels and walls. Fail if blurry, 3D, or no labels.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Requirements: ${originalPrompt.substring(0, 300)}` },
              { type: "image_url", image_url: { url: generatedImageUrl } },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) return { passed: true, feedback: "Verification skipped" };

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { passed: !!parsed.passed, feedback: parsed.feedback || "" };
    }
    return { passed: true, feedback: "Could not parse verification" };
  } catch {
    return { passed: true, feedback: "Verification skipped" };
  }
}

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

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const rooms = analysisData.rooms || [];
    const roomDescriptions = rooms.map((r: any) =>
      `${r.label || r.type} (${r.estimatedSqFt || 0} sq ft, pos: ${r.x || 0}%x${r.y || 0}%, size: ${r.width || 0}%x${r.height || 0}%)`
    ).join("\n  - ");

    const aiRecsList = (aiSuggestions || []).map((s: string) => `- ${s}`).join("\n");

    const prompt = `You are an expert architectural drafter. Generate a REDESIGNED 2D architectural floor plan.

EDGE-PRESERVATION (Canny ControlNet approach):
- PRESERVE the building envelope, exterior walls, and structural grid from the original image
- Only modify INTERIOR partitions, room sizes, and door/window placements
- Maintain same scale, orientation, and drawing style
- The generated plan must be recognizably the SAME building

CURRENT LAYOUT:
  Total Area: ${analysisData.totalArea || "unknown"} sq ft
  Rooms:
  - ${roomDescriptions}

RECOMMENDATIONS TO APPLY:
${aiRecsList || "None"}

CLIENT REQUIREMENTS:
${userSuggestions || "None"}

DRAWING SPECS:
- Clean 2D top-down architectural floor plan
- Black lines on white background
- Room labels with dimensions, door swings, window markers
- Wall thicknesses (exterior: 12", interior: 6")
- North arrow and scale bar`;

    console.log("Generating floor plan (attempt 1)...");
    let result = await generateImage(LOVABLE_API_KEY, prompt, imageBase64);

    if (result.image_url) {
      console.log("Verifying quality...");
      const verification = await verifyGeneration(LOVABLE_API_KEY, result.image_url, prompt);
      console.log(`Verification: passed=${verification.passed}`);

      if (!verification.passed) {
        console.log("Retrying with feedback...");
        const retryPrompt = `${prompt}\n\nCORRECTION: ${verification.feedback}\nEnsure clear 2D floor plan with all room labels visible.`;
        result = await generateImage(LOVABLE_API_KEY, retryPrompt, imageBase64);
        if (result.image_url) result.description = `[Refined] ${result.description}`;
      }
    }

    return new Response(JSON.stringify({ image_url: result.image_url, description: result.description }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    if (e?.status === 429 || e?.status === 402) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("generate-floorplan error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
