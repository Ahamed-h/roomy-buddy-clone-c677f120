import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert architectural floor plan analyzer. Analyze the provided floor plan image and extract ALL structural and furniture elements with precise coordinates.

CRITICAL: Return ONLY a valid JSON object. No markdown, no explanation, no code blocks.

JSON SCHEMA:
{
  "unit": "feet" | "meters",
  "dimensions": { "width": <number>, "height": <number> },
  "walls": [
    { "start": { "x": <number>, "y": <number> }, "end": { "x": <number>, "y": <number> }, "thickness": <number> }
  ],
  "doors": [
    { "position": { "x": <number>, "y": <number> }, "width": <number>, "rotation": <number>, "type": "single"|"double"|"sliding" }
  ],
  "windows": [
    { "start": { "x": <number>, "y": <number> }, "end": { "x": <number>, "y": <number> }, "width": <number> }
  ],
  "furniture": [
    { "type": "<string>", "label": "<string>", "position": { "x": <number>, "y": <number> }, "rotation": <number>, "width": <number>, "depth": <number>, "height": <number> }
  ],
  "rooms": [
    { "name": "<string>", "center": { "x": <number>, "y": <number> } }
  ]
}

STEP-BY-STEP INSTRUCTIONS:

1. UNIT DETECTION:
   - Look at the dimension numbers on the image. If values are large (e.g., 20, 30, 40), they are likely in FEET.
   - If values are small (e.g., 3.5, 8.8), they are likely in METERS.
   - Set the "unit" field accordingly. ALL coordinates must use the SAME unit as shown on the image.

2. COORDINATE SYSTEM:
   - Origin (0, 0) = top-left corner of the outer boundary
   - X increases to the right, Y increases downward
   - Read EVERY dimension label on the image to determine exact coordinates
   - For example, if the top edge shows "8" then "8" then "14" from left to right, the partition walls are at x=8 and x=16, and the right edge is at x=30

3. WALL DETECTION (most important):
   - Trace EVERY wall segment as a separate entry
   - Exterior walls form the outer boundary — trace all 4+ sides
   - Interior partition walls divide rooms — include ALL of them
   - Where walls meet at corners, one wall ends and another begins
   - Wall thickness: use 0.5 for feet-based plans, 0.15 for meter-based plans
   - Include walls around bathroom, kitchen, closets — every enclosed space

4. DOOR DETECTION:
   - Look for arc symbols (quarter circles) indicating door swings
   - Look for gaps in walls with small lines perpendicular to the opening
   - Position is the CENTER of the door opening
   - Width is the opening width
   - Rotation: 0=opens right, 90=opens down, 180=opens left, 270=opens up

5. WINDOW DETECTION:
   - Look for parallel lines on exterior walls (typically 3 parallel lines)
   - Look for small rectangles on walls
   - Start/end coordinates should be on the wall line

6. FURNITURE DETECTION:
   - Identify ALL drawn furniture: beds, sofas, tables, chairs, desks, toilets, bathtubs, sinks, kitchen counters, stoves, refrigerators, wardrobes, shelves, TV units, rugs
   - Read any text labels near furniture items
   - Position is the CENTER of each item
   - Use realistic dimensions in the detected unit
   - Common furniture sizes in feet: bed=5x6.5, sofa=7x3, dining table=4x3, toilet=1.5x2.5, bathtub=2.5x5

7. ROOM DETECTION:
   - Read room name labels from the image (e.g., "Bedroom", "Kitchen", "Living Room", "Bath")
   - Place center point at the approximate center of each room
   - Include ALL labeled rooms`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageBase64 } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "imageBase64 is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const imageUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/png;base64,${imageBase64}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Analyze this floor plan. Read ALL dimension labels carefully. Extract every wall, door, window, furniture item, and room. Pay special attention to: 1) The unit system (feet vs meters) based on dimension values. 2) Precise wall coordinates using the labeled measurements. 3) ALL furniture items visible in the drawing.",
              },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again shortly." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI analysis failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content || "";
    console.log("AI raw response length:", content.length);

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content;
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    // Also try to find raw JSON object
    if (!jsonStr.startsWith("{")) {
      const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (braceMatch) jsonStr = braceMatch[0];
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("JSON parse failed. Raw content:", content.substring(0, 1000));
      throw new Error("Failed to parse AI response as JSON");
    }

    // Detect unit and convert to meters if needed
    const unit = parsed.unit || "meters";
    const toMeters = unit === "feet" ? 0.3048 : 1;
    console.log(`Detected unit: ${unit}, conversion factor: ${toMeters}`);

    const dimensions = {
      width: (parsed.dimensions?.width || 10) * toMeters,
      height: (parsed.dimensions?.height || 10) * toMeters,
    };

    // Process walls with unit conversion
    const walls = (parsed.walls || []).map((w: any, i: number) => ({
      id: `w-ai-${i}`,
      start: { x: (w.start?.x || 0) * toMeters, y: (w.start?.y || 0) * toMeters },
      end: { x: (w.end?.x || 0) * toMeters, y: (w.end?.y || 0) * toMeters },
      thickness: (w.thickness || (unit === "feet" ? 0.5 : 0.15)) * toMeters,
    }));

    // Process doors
    const doors = (parsed.doors || []).map((d: any, i: number) => ({
      id: `d-ai-${i}`,
      type: "door",
      label: `Door (${d.type || "single"})`,
      position: { x: (d.position?.x || 0) * toMeters, y: (d.position?.y || 0) * toMeters },
      rotation: d.rotation || 0,
      width: (d.width || (unit === "feet" ? 3 : 0.9)) * toMeters,
      depth: 0.1,
      height: 2.1,
    }));

    // Process windows
    const windows = (parsed.windows || []).map((w: any, i: number) => {
      const sx = (w.start?.x || 0) * toMeters;
      const sy = (w.start?.y || 0) * toMeters;
      const ex = (w.end?.x || 0) * toMeters;
      const ey = (w.end?.y || 0) * toMeters;
      return {
        id: `win-ai-${i}`,
        type: "window",
        label: "Window",
        position: { x: (sx + ex) / 2, y: (sy + ey) / 2 },
        rotation: 0,
        width: w.width ? w.width * toMeters : Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2),
        depth: 0.15,
        height: 1.2,
      };
    });

    // Process furniture
    const furniture = (parsed.furniture || []).map((f: any, i: number) => ({
      id: `f-ai-${i}`,
      type: f.type || "table",
      label: f.label || f.type || "Item",
      position: { x: (f.position?.x || 0) * toMeters, y: (f.position?.y || 0) * toMeters },
      rotation: f.rotation || 0,
      width: (f.width || 1) * toMeters,
      depth: (f.depth || 1) * toMeters,
      height: (f.height || 1) * toMeters,
    }));

    // Process rooms
    const rooms = (parsed.rooms || []).map((r: any, i: number) => ({
      id: `r-ai-${i}`,
      name: r.name,
      center: { x: (r.center?.x || 0) * toMeters, y: (r.center?.y || 0) * toMeters },
    }));

    const allFurniture = [...furniture, ...doors, ...windows];

    console.log(`Extracted: ${walls.length} walls, ${doors.length} doors, ${windows.length} windows, ${furniture.length} furniture, ${rooms.length} rooms`);

    return new Response(JSON.stringify({ walls, furniture: allFurniture, rooms, dimensions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-floorplan error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
