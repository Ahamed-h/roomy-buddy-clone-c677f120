from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn, shutil, os, uuid
import torch
from dotenv import load_dotenv
from contextlib import asynccontextmanager
import json
import requests
import base64

load_dotenv()

from room_ai_engine import analyze_room

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
TEMP_DIR = "temp_uploads"
MODELS_DIR = "models"

os.makedirs(TEMP_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs("static", exist_ok=True)

# 🔥 Global model cache flag
_models_loaded = False


# ⭐ Lifespan (startup/shutdown)
@asynccontextmanager
async def lifespan(app: FastAPI):
    global _models_loaded
    
    print("🚀 Server ready! /analyze = 500ms after first request")
    
    # Preload models here if needed
    # analyze_room("dummy.jpg")
    
    yield
    
    print("🛑 Server shutting down")


# ⭐ Create app ONLY ONCE
app = FastAPI(
    title="AI Interior Design Engine v1.0",
    lifespan=lifespan
)


# ⭐ CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ⭐ Static files
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return {
        "status": "AI Interior Design Engine v1.0",
        "device": DEVICE,
        "endpoints": ["/analyze", "/design/generate/2d/repaint", "/design/chat", "/design/enhance_prompt"]
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "models_loaded": _models_loaded}


# ================== OLLAMA VISION (FAST PATH) ==================

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")

def analyze_with_ollama(image_path: str):
    """Try Qwen2.5-VL via Ollama for fast local analysis."""
    try:
        with open(image_path, "rb") as f:
            img_b64 = base64.b64encode(f.read()).decode()

        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": "qwen2.5-vl:3b",
                "prompt": (
                    "Analyze this room or floor plan image. Return a JSON object with: "
                    "aesthetic_score (0-100), brightness (0-100), objects (list of {name, confidence}), "
                    "style_scores (object with style names and 0-1 scores), "
                    "recommendations (list of strings), and room_type (string). "
                    "Return ONLY valid JSON."
                ),
                "images": [img_b64],
                "stream": False,
            },
            timeout=120,
        )

        if response.status_code == 200:
            raw = response.json().get("response", "")
            # Try to parse JSON from response
            import re
            json_match = re.search(r'\{[\s\S]*\}', raw)
            if json_match:
                parsed = json.loads(json_match.group())
                return {
                    "source": "ollama_qwen_vl",
                    **parsed,
                }
            # Return raw if can't parse
            return {
                "source": "ollama_qwen_vl",
                "analysis": raw,
            }

    except Exception as e:
        print(f"⚡ Ollama unavailable, falling back to heavy pipeline: {e}")

    return None


# ================== ANALYZE (HYBRID) ==================

@app.post("/analyze")
async def analyze_room_api(file: UploadFile = File(...)):
    global _models_loaded

    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "Upload a valid image")

    temp_path = os.path.join(TEMP_DIR, f"{uuid.uuid4()}_{file.filename}")

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        # 🔥 FIRST: Try Ollama Qwen-VL (fast, lightweight)
        ollama_result = analyze_with_ollama(temp_path)
        if ollama_result:
            print("⚡ Analyzed via Ollama Qwen-VL")
            return JSONResponse(content=ollama_result)

        # 🧠 FALLBACK: Heavy pipeline (SAM + YOLO + CLIP + MiDaS)
        print("🧠 Using heavy ML pipeline...")
        if not _models_loaded:
            print("🔥 First request: Loading models...")
            result = analyze_room(temp_path)
            _models_loaded = True
            print("✅ Models cached! Future requests = instant")
        else:
            result = analyze_room(temp_path)

        return JSONResponse(content={"source": "heavy_pipeline", **result})
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


# ================== DESIGN ==================

@app.post("/design/generate/2d/repaint")
async def generate_repaint(file: UploadFile = File(...), style_prompt: str = Form(...)):
    return {
        "image_url": "https://via.placeholder.com/1024x768/1a1f3a/ffffff?text=Redesign+Generated",
        "prompt_used": style_prompt
    }


@app.post("/design/chat")
async def design_chat(session_id: str = Form(...), message: str = Form(...)):
    return {
        "response": f"Chat response to: '{message}' (session: {session_id})",
        "action": "generate",
        "params": {"style": "modern"}
    }


@app.post("/design/enhance_prompt")
async def enhance_prompt(evaluation_json: str = Form(...), user_style: str = Form(...)):
    eval_data = json.loads(evaluation_json)
    enhanced = f"{user_style} interior, improve {eval_data.get('recommendations', ['lighting'])[0]}"
    return {"enhanced_prompt": enhanced}


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)