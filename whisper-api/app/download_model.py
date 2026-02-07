#!/usr/bin/env python3
"""
Download the ivrit-ai/whisper-large-v3-ct2 model from Hugging Face.
This script is run during Docker build to pre-download the model.
"""

import os
import sys
from huggingface_hub import snapshot_download

MODEL_REPO = "ivrit-ai/whisper-large-v3-ct2"
MODEL_PATH = os.environ.get("MODEL_PATH", "/app/models/whisper-large-v3-ct2")


def download_model():
    """Download the Whisper model from Hugging Face."""
    print(f"Downloading model {MODEL_REPO} to {MODEL_PATH}...")
    
    try:
        snapshot_download(
            repo_id=MODEL_REPO,
            local_dir=MODEL_PATH,
            local_dir_use_symlinks=False,
        )
        print(f"Model downloaded successfully to {MODEL_PATH}")
        
        # List downloaded files
        print("\nDownloaded files:")
        for root, dirs, files in os.walk(MODEL_PATH):
            for file in files:
                filepath = os.path.join(root, file)
                size_mb = os.path.getsize(filepath) / (1024 * 1024)
                print(f"  {filepath}: {size_mb:.2f} MB")
                
    except Exception as e:
        print(f"Error downloading model: {e}")
        sys.exit(1)


if __name__ == "__main__":
    download_model()
