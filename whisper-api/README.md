# Whisper Hebrew Transcription API

A simple REST API for transcribing Hebrew audio files using the [ivrit-ai/whisper-large-v3-ct2](https://huggingface.co/ivrit-ai/whisper-large-v3-ct2) model.

## Features

- Hebrew speech-to-text transcription
- Supports OGA files (Telegram voice messages), WAV, MP3, FLAC, M4A, and more
- Pre-downloaded model for fast container startup
- Docker and Docker Compose support
- CPU-optimized with INT8 quantization

## Quick Start

### Using Docker Compose (Recommended)

```bash
# Build and run
docker-compose up --build

# Or run in detached mode
docker-compose up -d --build
```

### Using Docker directly

```bash
# Build the image
docker build -t whisper-hebrew-api .

# Run the container
docker run -p 8000:8000 whisper-hebrew-api
```

## API Usage

### Transcribe an audio file

```bash
curl -X POST "http://localhost:8000/transcribe" \
  -H "accept: application/json" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@voice_message.oga"
```

### Response

```json
{
  "text": "שלום, מה שלומך היום?",
  "language": "he",
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "שלום, מה שלומך היום?"
    }
  ]
}
```

### Health Check

```bash
curl http://localhost:8000/health
```

### API Documentation

Once running, visit:
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_PATH` | `/app/models/whisper-large-v3-ct2` | Path to the model |
| `DEVICE` | `cpu` | Device to use (`cpu` or `cuda`) |
| `COMPUTE_TYPE` | `int8` | Computation type (`int8` for CPU, `float16` for GPU) |

## GPU Support

For GPU acceleration, modify the environment variables:

```yaml
environment:
  - DEVICE=cuda
  - COMPUTE_TYPE=float16
```

And ensure you have NVIDIA Container Toolkit installed.

## Model Information

- **Model**: ivrit-ai/whisper-large-v3-ct2
- **Format**: CTranslate2 (Faster Whisper)
- **Base Model**: OpenAI Whisper Large V3
- **Fine-tuned for**: Hebrew language
- **Size**: ~3GB

## Development

### Local development (without Docker)

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Download model
python app/download_model.py

# Run the API
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## License

Apache 2.0 (following the model's license)
