import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const VISION_MODEL = "google/gemini-2.5-flash";

const FLOORPLAN_ANALYSIS_PROMPT = `You are a licensed senior architect with 25+ years of residential and commercial design experience. Analyse the uploaded floor plan image with the precision and detail of a professional architectural review.

Return ONLY a single valid JSON object — no markdown, no explanation, nothing else.

Schema:
{
  "rooms": [
    {
      "id": "r0",
      "type": "Living Room",
      "label": "Living Room",
      "estimatedSqFt": 220,
      "x": 5,
      "y": 8,
      "width": 30,
      "height": 25,
      "notes": "Open plan, south-facing, 3.2m ceiling height"
    }
  ],
  "totalArea": 1400,
  "score": 7.2,
  "summary": "Compact 2BR apartment with efficient layout but suboptimal kitchen work triangle",
  "insights": [
    { "type": "positive", "text": "Excellent separation of public and private zones" },
    { "type": "warning",  "text": "Bedroom 2 lacks direct fenestration" },
    { "type": "negative", "text": "No clear egress path from master bedroom" }
  ],
  "flowIssues": [
    "Living room serves as mandatory through-corridor to bedrooms"
  ],
  "recommendations": [
    {
      "id": "rec1",
      "title": "Optimize Kitchen Work Triangle",
      "description": "Relocate refrigerator to north wall and extend counter 4 ft east.",
      "impact": "high",
      "roomChanges": [
        { "id": "r2", "width": 22, "height": 18, "notes": "L-shaped layout with island" }
      ]
    }
  ]
}

RULES:
- x, y, width, height are PERCENTAGES (0–100) of the image dimensions
- Only identify rooms clearly visible in the image — do NOT invent rooms
- Every recommendation roomChange must reference a real room id
- score is 0–10 (be critical — most residential plans score 5-7)
- type must be one of: Living Room, Bedroom, Kitchen, Bathroom, Dining Room, Office, Hallway, Garage, Laundry, Storage, Balcony, Unknown
- impact must be "high", "medium", or "low"

PROFESSIONAL EVALUATION CRITERIA:
1. CIRCULATION & FLOW: Traffic patterns, dead-end corridors, cross-traffic through private zones
2. SPATIAL PROPORTIONS: Room aspect ratios (ideal 1:1.2 to 1:1.6)
3. NATURAL LIGHT: Fenestration ratio, light penetration depth
4. KITCHEN WORK TRIANGLE: Sink-stove-fridge triangle (ideal 12-26 ft per NKBA)
5. PRIVACY ZONING: Separate public from private zones
6. ACCESSIBILITY: 36" min doorways, 60" turning radius in bathrooms
7. STRUCTURAL LOGIC: Load-bearing wall implications
8. STORAGE: Minimum 10% of total area should be dedicated storage

Provide at least 4-6 insights and 2-4 actionable recommendations.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imageUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;

    console.log("Analyzing floor plan with Gemini Flash...");

    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          { role: "system", content: FLOORPLAN_ANALYSIS_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this floor plan image. Return only the JSON object." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Vision analysis failed:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`Vision API failed: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log("Vision response length:", content.length);

    // Parse JSON from response
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    if (!jsonStr.startsWith("{")) {
      const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (braceMatch) jsonStr = braceMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    if (!parsed.rooms || !Array.isArray(parsed.rooms)) {
      throw new Error("Invalid analysis result: no rooms array");
    }

    parsed.source = "gemini-flash";
    console.log(`Analysis complete: ${parsed.rooms.length} rooms, score: ${parsed.score}`);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: any) {
    console.error("analyze-floorplan error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
