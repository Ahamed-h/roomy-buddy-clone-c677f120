/**
 * Generate an image using Puter.js (free, no API keys needed).
 * Returns a base64 data URL of the generated image.
 */
export async function puterGenerateImage(
  prompt: string,
  model: string = "flux-schnell"
): Promise<string> {
  if (!window.puter?.ai?.txt2img) {
    throw new Error("Puter.js not loaded. Please refresh the page.");
  }

  const imgElement = await window.puter.ai.txt2img(prompt, { model });

  // Convert the returned <img> element to a base64 data URL
  const canvas = document.createElement("canvas");
  canvas.width = imgElement.naturalWidth || imgElement.width || 1024;
  canvas.height = imgElement.naturalHeight || imgElement.height || 1024;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(imgElement, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Available models for Puter.js image generation */
export const PUTER_MODELS = [
  { id: "flux-schnell", label: "Flux Schnell (Fast)" },
  { id: "dall-e-3", label: "DALL-E 3" },
  { id: "gpt-image-1", label: "GPT Image" },
  { id: "gemini-2.5-flash-image-preview", label: "Gemini Flash Image" },
  { id: "stable-diffusion-xl", label: "Stable Diffusion XL" },
  { id: "flux-1.1-pro", label: "Flux 1.1 Pro" },
];
