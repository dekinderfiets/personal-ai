"""
Whisper API - Hebrew Transcription Service
Uses ivrit-ai/whisper-large-v3-ct2 model with faster-whisper
"""

import asyncio
import os
import tempfile
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from faster_whisper import WhisperModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Model configuration
MODEL_PATH = os.environ.get("MODEL_PATH", "/app/models/whisper-large-v3-ct2")
DEVICE = os.environ.get("DEVICE", "cpu")  # "cpu" or "cuda"
COMPUTE_TYPE = os.environ.get("COMPUTE_TYPE", "int8")  # int8 for CPU, float16 for GPU

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# Global model instance
model = None


class TranscriptionResponse(BaseModel):
    text: str
    language: str
    duration: float
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
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
    file: UploadFile = File(..., description="Audio file to transcribe (OGA, WAV, MP3, etc.)"),
    language: str = Form("he", description="Language code (default: he for Hebrew)"),
    initial_prompt: Optional[str] = Form(None, description="Optional context hint to improve accuracy"),
    word_timestamps: bool = Form(False, description="Include word-level timestamps in segments"),
):
    """
    Transcribe an audio file.

    Supported formats: OGA, OGG, WAV, MP3, FLAC, M4A, and more.
    Defaults to Hebrew but supports any language via the language parameter.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # Validate file
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # Read and enforce file size limit
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)}MB")

    # Get file extension
    suffix = Path(file.filename).suffix.lower()
    if not suffix:
        suffix = ".oga"  # Default for Telegram voice messages

    logger.info(f"Received file: {file.filename}, size: {len(content)} bytes, content_type: {file.content_type}")

    try:
        # Save uploaded file to temp location
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(content)
            temp_path = temp_file.name

        logger.info(f"Processing audio file: {temp_path} (language={language}, word_timestamps={word_timestamps})")

        # Build transcribe kwargs
        transcribe_kwargs = dict(
            language=language,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
            word_timestamps=word_timestamps,
        )
        if initial_prompt:
            transcribe_kwargs["initial_prompt"] = initial_prompt

        # Run transcription in a thread pool to avoid blocking the event loop
        segments_iter, info = await asyncio.to_thread(
            model.transcribe, temp_path, **transcribe_kwargs
        )

        # Collect segments (iterator must be consumed in the same thread context)
        raw_segments = await asyncio.to_thread(list, segments_iter)

        segment_list = []
        full_text_parts = []

        for segment in raw_segments:
            segment_data = {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
                "avg_logprob": segment.avg_logprob,
                "no_speech_prob": segment.no_speech_prob,
            }
            if word_timestamps and segment.words:
                segment_data["words"] = [
                    {
                        "start": w.start,
                        "end": w.end,
                        "word": w.word,
                        "probability": w.probability,
                    }
                    for w in segment.words
                ]
            segment_list.append(segment_data)
            full_text_parts.append(segment.text.strip())

        full_text = " ".join(full_text_parts)

        logger.info(f"Transcription complete. Length: {len(full_text)} chars, duration: {info.duration:.1f}s")

        return TranscriptionResponse(
            text=full_text,
            language=info.language,
            duration=info.duration,
            segments=segment_list,
        )

    except HTTPException:
        raise
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
        "default_language": "Hebrew",
        "endpoints": {
            "/transcribe": "POST - Transcribe audio file",
            "/health": "GET - Health check",
        }
    }
