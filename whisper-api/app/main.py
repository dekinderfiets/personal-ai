"""
Whisper API - Hebrew Transcription Service
Uses ivrit-ai/whisper-large-v3-ct2 model with faster-whisper
"""

import os
import tempfile
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from faster_whisper import WhisperModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model configuration
MODEL_PATH = os.environ.get("MODEL_PATH", "/app/models/whisper-large-v3-ct2")
DEVICE = os.environ.get("DEVICE", "cpu")  # "cpu" or "cuda"
COMPUTE_TYPE = os.environ.get("COMPUTE_TYPE", "int8")  # int8 for CPU, float16 for GPU

# Global model instance
model = None


class TranscriptionResponse(BaseModel):
    text: str
    language: str
    segments: list[dict]


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup."""
    global model
    logger.info(f"Loading Whisper model from {MODEL_PATH}")
    logger.info(f"Device: {DEVICE}, Compute type: {COMPUTE_TYPE}")
    
    try:
        model = WhisperModel(
            MODEL_PATH,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
        )
        logger.info("Model loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load model: {e}")
        raise
    
    yield
    
    # Cleanup
    logger.info("Shutting down...")


app = FastAPI(
    title="Whisper Hebrew Transcription API",
    description="API for transcribing Hebrew audio using ivrit-ai/whisper-large-v3-ct2",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check API health and model status."""
    return HealthResponse(
        status="healthy",
        model_loaded=model is not None
    )


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    file: UploadFile = File(..., description="Audio file to transcribe (OGA, WAV, MP3, etc.)")
):
    """
    Transcribe an audio file to Hebrew text.
    
    Supported formats: OGA, OGG, WAV, MP3, FLAC, M4A, and more.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    # Validate file
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    
    # Get file extension
    suffix = Path(file.filename).suffix.lower()
    if not suffix:
        suffix = ".oga"  # Default for Telegram voice messages
    
    logger.info(f"Received file: {file.filename}, content_type: {file.content_type}")
    
    try:
        # Save uploaded file to temp location
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name
        
        logger.info(f"Processing audio file: {temp_path}")
        
        # Transcribe with Hebrew language
        segments, info = model.transcribe(
            temp_path,
            language="he",  # Hebrew
            beam_size=5,
            vad_filter=True,  # Filter out silence
            vad_parameters=dict(
                min_silence_duration_ms=500,
            ),
        )
        
        # Collect segments
        segment_list = []
        full_text_parts = []
        
        for segment in segments:
            segment_data = {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            }
            segment_list.append(segment_data)
            full_text_parts.append(segment.text.strip())
        
        full_text = " ".join(full_text_parts)
        
        logger.info(f"Transcription complete. Length: {len(full_text)} chars")
        
        return TranscriptionResponse(
            text=full_text,
            language=info.language,
            segments=segment_list,
        )
        
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    
    finally:
        # Cleanup temp file
        if 'temp_path' in locals():
            try:
                os.unlink(temp_path)
            except Exception:
                pass


@app.get("/")
async def root():
    """API information."""
    return {
        "name": "Whisper Hebrew Transcription API",
        "model": "ivrit-ai/whisper-large-v3-ct2",
        "language": "Hebrew",
        "endpoints": {
            "/transcribe": "POST - Transcribe audio file",
            "/health": "GET - Health check",
        }
    }
