"""
Roomform.ai — FastAPI + Gradio Backend for Hugging Face Spaces
Uses HF Inference API for image generation (FLUX, SDXL Turbo).
"""

import os
import io
import base64
import time
import logging
import requests
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
import gradio as gr

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("roomform")

HF_TOKEN = os.getenv("HF_TOKEN")
HEADERS = {"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {}

FLUX_URL = "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell"
SDXL_URL = "https://api-inference.huggingface.co/models/stabilityai/sdxl-turbo"

app = FastAPI(title="Roomform.ai API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def query_hf_model(url: str, payload: dict, retries: int = 10) -> Image.Image | None:
    """Query HF Inference API with retry for model loading."""
    for attempt in range(retries):
        try:
            resp = requests.post(url, headers=HEADERS, json=payload, timeout=120)

            if resp.status_code == 503:
                logger.info(f"Model loading, retry {attempt + 1}/{retries}...")
                time.sleep(5)
                continue

            if resp.status_code != 200:
                logger.error(f"HF API error {resp.status_code}: {resp.text[:200]}")
                return None

            # Raw image bytes
            try:
                return Image.open(io.BytesIO(resp.content))
            except Exception:
                pass

            # JSON with image URL
            try:
                data = resp.json()
                if isinstance(data, list) and "generated_image" in data[0]:
                    img_resp = requests.get(data[0]["generated_image"], stream=True)
                    return Image.open(img_resp.raw)
            except Exception:
                pass

            logger.error("Could not parse HF response")
            return None

        except requests.exceptions.Timeout:
            logger.warning(f"Timeout on attempt {attempt + 1}")
            continue
        except Exception as e:
            logger.error(f"Request error: {e}")
            return None

    return None


def image_to_base64(img: Image.Image, fmt: str = "PNG") -> str:
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode()


# ── Health ──

@app.get("/")
async def root():
    return {
        "status": "running",
        "service": "roomform.ai",
        "hf_token_set": bool(HF_TOKEN),
        "models": ["FLUX.1-schnell", "SDXL Turbo"],
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "hf_token": bool(HF_TOKEN)}


# ── Image Generation (REST API for frontend) ──

@app.post("/design/generate/2d/repaint")
async def generate_repaint(
    file: UploadFile = File(...),
    style_prompt: str = Form("modern minimalist interior design, photorealistic"),
    model: str = Form("flux"),
):
    """
    Generate a room redesign using HF Inference API.
    Accepts: image file + style_prompt + model (flux | sdxl)
    Returns: { image_url: "data:image/png;base64,..." }
    """
    if not HF_TOKEN:
        raise HTTPException(status_code=503, detail="HF_TOKEN not set")

    try:
        contents = await file.read()
        input_image = Image.open(io.BytesIO(contents)).convert("RGB")
        logger.info(f"📸 Input: {file.filename} ({input_image.size}), model={model}")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")

    # Build the prompt
    prompt = style_prompt

    # Pick model URL
    model_url = FLUX_URL if model != "sdxl" else SDXL_URL
    model_name = "FLUX.1-schnell" if model != "sdxl" else "SDXL Turbo"

    logger.info(f"🎨 Generating with {model_name}: {prompt[:80]}...")

    result_image = query_hf_model(model_url, {"inputs": prompt})

    if result_image is None:
        raise HTTPException(status_code=500, detail=f"{model_name} generation failed")

    # Return as base64 data URL
    b64 = image_to_base64(result_image)
    image_url = f"data:image/png;base64,{b64}"

    logger.info("✅ Generation complete")
    return JSONResponse(content={"image_url": image_url})


# ── Gradio UI (for manual testing) ──

def gradio_generate(image, prompt, task):
    if task == "Interior Generation (FLUX Schnell)":
        return query_hf_model(FLUX_URL, {"inputs": prompt})
    elif task == "Fast Generation (SDXL Turbo)":
        return query_hf_model(SDXL_URL, {"inputs": prompt})
    else:
        if image is None:
            return None
        return query_hf_model(FLUX_URL, {"inputs": prompt})


demo = gr.Interface(
    fn=gradio_generate,
    inputs=[
        gr.Image(type="pil", label="Upload Interior or Floorplan"),
        gr.Textbox(label="Prompt"),
        gr.Dropdown(
            [
                "Interior Generation (FLUX Schnell)",
                "Fast Generation (SDXL Turbo)",
                "Floorplan Editing",
            ],
            value="Interior Generation (FLUX Schnell)",
            label="Model",
        ),
    ],
    outputs=gr.Image(label="Generated Image"),
    title="AI Interior + Floorplan Generator",
    description="Generate interiors using Hugging Face models (FLUX, SDXL Turbo).",
)

app = gr.mount_gradio_app(app, demo, path="/gradio")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)
