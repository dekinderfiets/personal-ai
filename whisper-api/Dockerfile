# Whisper Hebrew Transcription API
# Using ivrit-ai/whisper-large-v3-ct2 model

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for audio processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Set environment variables
ENV MODEL_PATH=/app/models/whisper-large-v3-ct2
ENV DEVICE=cpu
ENV COMPUTE_TYPE=int8
ENV PYTHONUNBUFFERED=1

# Create models directory
RUN mkdir -p /app/models

# Download the model during build (this makes the image larger but faster to start)
RUN python app/download_model.py

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Run the API
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
