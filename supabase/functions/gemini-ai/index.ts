import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const IMAGE_GEN_MODEL = "gemini-2.0-flash-exp";
const VISION_MODEL = "gemini-2.5-flash";
const CHAT_MODEL = "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function getApiKey(): string {
  const key = Deno.env.get("GOOGLE_GEMINI_API_KEY");
  if (!key) throw new Error("GOOGLE_GEMINI_API_KEY not configured");
  return key;
}

async function callGemini(model: string, apiKey: string, contents: any[], systemInstruction?: any, generationConfig?: any): Promise<any> {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`;
  const body: any = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (generationConfig) body.generationConfig = generationConfig;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error(`Gemini [${model}] error:`, resp.status, errText);
    if (resp.status === 429) throw { status: 429, message: "Rate limit exceeded. Please try again." };
    if (resp.status === 403) throw { status: 402, message: "API key quota exceeded or permission denied." };
    throw new Error(`Gemini [${model}] failed [${resp.status}]: ${errText}`);
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = getApiKey();
    const body = await req.json();
    const { action, prompt, imageBase64, messages, systemPrompt } = body;

    // ── ACTION: generate-image ──
    if (action === "generate-image") {
      const parts: any[] = [{ text: prompt || "Generate an image" }];
      if (imageBase64) {
        const raw = imageBase64.startsWith("data:") ? imageBase64.split(",")[1] : imageBase64;
        parts.push({ inlineData: { mimeType: "image/jpeg", data: raw } });
      }

      const data = await callGemini(IMAGE_GEN_MODEL, apiKey,
        [{ role: "user", parts }],
        undefined,
        { responseModalities: ["IMAGE", "TEXT"] }
      );

      return new Response(JSON.stringify({ image_url: extractImage(data), description: extractText(data) }), {
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
      const raw = imageBase64.startsWith("data:") ? imageBase64.split(",")[1] : imageBase64;
      const data = await callGemini(VISION_MODEL, apiKey,
        [{ role: "user", parts: [
          { text: prompt || "Describe this image" },
          { inlineData: { mimeType: "image/jpeg", data: raw } },
        ]}]
      );
      return new Response(JSON.stringify({ text: extractText(data) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ACTION: chat ──
    if (action === "chat") {
      const contents: any[] = [];
      let sysInstruction = undefined;
      if (systemPrompt) sysInstruction = { parts: [{ text: systemPrompt }] };

      for (const msg of (messages || [])) {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }

      const data = await callGemini(CHAT_MODEL, apiKey, contents, sysInstruction);
      return new Response(JSON.stringify({ text: extractText(data) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use: generate-image, vision, or chat" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    if (e?.status === 429 || e?.status === 402) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.error("gemini-ai error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
