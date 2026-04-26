"""
WhisperX local transcription server — port 8002.
Endpoint:
  POST /transcribe  — extract clip-range audio with ffmpeg, run whisperX locally

Start: uvicorn server:app --host 0.0.0.0 --port 8002

Requires:
  - ffmpeg in PATH
  - CUDA (optional, falls back to CPU)
  - pip install -r requirements.txt
"""
import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import List

import whisperx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

app = FastAPI()

# Load model once at startup (large-v2 gives best Korean accuracy)
DEVICE = "cuda" if _cuda_available() else "cpu"
COMPUTE = "float16" if DEVICE == "cuda" else "int8"
MODEL_SIZE = os.environ.get("WHISPERX_MODEL", "large-v2")
_model = None


def _cuda_available() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def get_model():
    global _model
    if _model is None:
        _model = whisperx.load_model(MODEL_SIZE, DEVICE, compute_type=COMPUTE, language="ko")
    return _model


class TranscribeBody(BaseModel):
    clip_id: str
    source_url: str
    start_sec: float
    end_sec: float
    language: str = "ko"


@app.post("/transcribe")
def transcribe_clip(body: TranscribeBody):
    """
    C4: local whisperX transcription — no Replicate API, no cost.
    1. Download source video
    2. ffmpeg: extract clip-range audio (16kHz mono)
    3. whisperX: transcribe + align word timestamps
    4. Return segments with absolute timestamps
    """
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        tmp_video = f.name
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp_audio = f.name

    try:
        # 1. Download source
        urllib.request.urlretrieve(body.source_url, tmp_video)

        # 2. Extract clip range as WAV (16kHz mono for whisperX)
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", tmp_video,
                "-ss", str(body.start_sec),
                "-to", str(body.end_sec),
                "-vn", "-ar", "16000", "-ac", "1",
                tmp_audio,
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )

        # 3. Transcribe with whisperX
        model = get_model()
        result = model.transcribe(tmp_audio, batch_size=16, language=body.language)

        # 4. Align word-level timestamps
        align_model, metadata = whisperx.load_align_model(
            language_code=body.language, device=DEVICE
        )
        result = whisperx.align(
            result["segments"], align_model, metadata, tmp_audio, DEVICE,
            return_char_alignments=False
        )

        # 5. Parse and adjust to absolute video time
        segments: List[dict] = []
        for seg in result.get("segments") or []:
            words = seg.get("words") or []
            if words:
                for w in words:
                    text = (w.get("word") or "").strip()
                    if not text:
                        continue
                    segments.append({
                        "text": text,
                        "start_sec": round(body.start_sec + float(w.get("start", 0)), 3),
                        "end_sec": round(body.start_sec + float(w.get("end", 0)), 3),
                    })
            else:
                text = (seg.get("text") or "").strip()
                if text:
                    segments.append({
                        "text": text,
                        "start_sec": round(body.start_sec + float(seg.get("start", 0)), 3),
                        "end_sec": round(body.start_sec + float(seg.get("end", 0)), 3),
                    })

        return {"segments": segments}

    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"ffmpeg error: {e.stderr.decode()}")
    finally:
        Path(tmp_video).unlink(missing_ok=True)
        Path(tmp_audio).unlink(missing_ok=True)
