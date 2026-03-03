import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { analysisData, aiSuggestions, userSuggestions } = await req.json();
    
    if (!analysisData) {
      return new Response(JSON.stringify({ error: "analysisData is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_KEY) {
      throw new Error("GOOGLE_GEMINI_API_KEY is not configured");
    }

    const rooms = analysisData.rooms || [];
    const roomDescriptions = rooms.map((r: any) => 
      `${r.label || r.type} (${r.estimatedSqFt || 0} sq ft)`
    ).join(", ");

    const aiRecsList = (aiSuggestions || []).map((s: string) => `- ${s}`).join("\n");
    const userReqs = userSuggestions || "";

    // Use Gemini text model to generate a detailed textual floorplan description
    // (actual image generation must happen via local ComfyUI)
    const promptResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are an architectural floor plan designer. Given the current layout and suggestions, describe a detailed redesigned floor plan in text. Include room positions, dimensions, and spatial relationships. Be specific about improvements made.`
          },
          {
            role: "user",
            content: `Redesign this floor plan:

CURRENT ROOMS: ${roomDescriptions}
TOTAL AREA: ${analysisData.totalArea || "unknown"} sq ft
LAYOUT SCORE: ${analysisData.score || "N/A"}/10

AI RECOMMENDATIONS TO APPLY:
${aiRecsList || "None selected"}

USER REQUIREMENTS:
${userReqs || "None specified"}

Provide a detailed text description of the improved floor plan layout.`
          }
        ],
      }),
    });

    if (!promptResponse.ok) {
      const errText = await promptResponse.text();
      console.error("Gemini text generation failed:", promptResponse.status, errText);
      if (promptResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("Failed to generate floorplan description");
    }

    const promptData = await promptResponse.json();
    const description = promptData.choices?.[0]?.message?.content || "No description generated.";

    // Return text description only — image generation requires local ComfyUI
    return new Response(JSON.stringify({
      image_url: null,
      description,
      prompt_used: `Redesigned floorplan for ${rooms.length} rooms`,
      fallback: "comfyui",
      message: "Image generation requires local ComfyUI. Use the local FastAPI backend for visual output.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("generate-floorplan error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
