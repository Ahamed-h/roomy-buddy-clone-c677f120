import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Image generation is handled by local ComfyUI — edge functions cannot reach localhost
  return new Response(
    JSON.stringify({
      error: "Image generation is handled locally via ComfyUI. Please use the local FastAPI backend at /design/generate/2d/comfyui or /design/generate/2d/repaint.",
      fallback: "comfyui",
    }),
    { status: 501, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
