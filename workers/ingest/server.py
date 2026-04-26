"""
Ingest FastAPI server — port 8001.
Endpoints:
  POST /upload-bgm      — upload BGM file to Supabase Storage
  POST /detect-speech   — find first speech onset in preview mp4 via ffmpeg
  POST /transcribe      — extract clip-range audio, send to Replicate Whisper

Start: uvicorn server:app --host 0.0.0.0 --port 8001
"""
import os
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import List

import replicate
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")

app = FastAPI()


class DetectSpeechBody(BaseModel):
    project_id: str


def _get_signed_url(supabase, storage_path: str) -> str:
    resp = supabase.storage.from_("sources").create_signed_url(storage_path, 31_536_000)
    # supabase-py 2.x returns a dataclass with signed_url, or a dict with signedURL
    url: str = getattr(resp, "signed_url", None) or (
        resp.get("signedURL") or resp.get("signed_url", "")
        if isinstance(resp, dict)
        else ""
    )
    return url


@app.post("/upload-bgm")
async def upload_bgm(clip_id: str = Form(...), file: UploadFile = File(...)):
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase env vars not set")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    content = await file.read()
    storage_path = f"bgm/{clip_id}.mp3"

    supabase.storage.from_("sources").upload(
        path=storage_path,
        file=content,
        file_options={"content-type": "audio/mpeg", "upsert": "true"},
    )

    # Generate a long-lived signed URL (1 year) so Remotion can access the file at render time
    signed_url = _get_signed_url(supabase, storage_path)

    return {"path": storage_path, "url": signed_url}


@app.post("/detect-speech")
def detect_speech(body: DetectSpeechBody):
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase env vars not set")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. Fetch project to get storage path and duration
    result = (
        supabase.table("projects")
        .select("yt_source_path, yt_duration_sec")
        .eq("id", body.project_id)
        .single()
        .execute()
    )
    if not result.data or not result.data.get("yt_source_path"):
        raise HTTPException(status_code=404, detail="preview video not found")

    storage_path: str = result.data["yt_source_path"]
    duration_sec: float = float(result.data.get("yt_duration_sec") or 0)

    # 2. Generate signed URL
    signed_url = _get_signed_url(supabase, storage_path)
    if not signed_url:
        raise HTTPException(status_code=500, detail="failed to generate signed URL")

    # 3. Download preview mp4 to a temp file
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        tmp_path = f.name

    try:
        urllib.request.urlretrieve(signed_url, tmp_path)

        # 4. Run ffmpeg silencedetect on the first 60s (enough to find the first speech onset)
        proc = subprocess.run(
            [
                "ffmpeg", "-i", tmp_path,
                "-t", "60",
                "-af", "silencedetect=noise=-30dB:duration=0.5",
                "-f", "null", "-",
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )

        stderr = proc.stderr
        silence_starts = [float(m) for m in re.findall(r"silence_start: ([0-9.]+)", stderr)]
        silence_ends = [float(m) for m in re.findall(r"silence_end: ([0-9.]+)", stderr)]

        # 5. Determine the first speech onset
        if silence_starts and silence_starts[0] < 1.0 and silence_ends:
            # Video opens with silence → speech starts when that silence ends
            start_sec = round(silence_ends[0], 2)
            confidence = 0.9
        elif not silence_starts and not silence_ends:
            # No silence at all → full-speech track, start from 0
            start_sec = 0.0
            confidence = 0.5
        else:
            # Video opens with speech (no leading silence)
            start_sec = 0.0
            confidence = 0.7

        # 6. Cap end at start + 30s (or total duration)
        ceiling = duration_sec if duration_sec > 0 else start_sec + 30.0
        end_sec = round(min(start_sec + 30.0, ceiling), 2)

        return {"start_sec": start_sec, "end_sec": end_sec, "confidence": confidence}

    finally:
        Path(tmp_path).unlink(missing_ok=True)


class TranscribeBody(BaseModel):
    clip_id: str
    source_url: str
    start_sec: float
    end_sec: float
    language: str = "ko"


@app.post("/transcribe")
def transcribe_clip(body: TranscribeBody):
    """
    A6: extract only the clip's audio range, send to Replicate Whisper.
    Returns segments with timestamps adjusted to absolute video time.
    """
    replicate_token = os.environ.get("REPLICATE_API_TOKEN", "")
    if not replicate_token:
        raise HTTPException(status_code=500, detail="REPLICATE_API_TOKEN not set")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase env vars not set")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        tmp_video = f.name
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        tmp_audio = f.name

    audio_storage_path = f"temp/transcribe-{body.clip_id}.mp3"

    try:
        # 1. Download full preview video
        urllib.request.urlretrieve(body.source_url, tmp_video)

        # 2. Extract clip-range audio with ffmpeg
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

        # 3. Upload trimmed audio to Supabase Storage (temp slot, overwrite)
        with open(tmp_audio, "rb") as f:
            supabase.storage.from_("sources").upload(
                path=audio_storage_path,
                file=f.read(),
                file_options={"content-type": "audio/mpeg", "upsert": "true"},
            )

        # 4. Create short-lived signed URL (5 min) for Replicate to fetch
        signed = _get_signed_url(supabase, audio_storage_path)
        if not signed:
            raise HTTPException(status_code=500, detail="Failed to sign trimmed audio URL")

        # 5. Run Replicate Whisper on the trimmed audio
        output = replicate.run(
            "openai/whisper",
            input={
                "audio": signed,
                "language": body.language,
                "word_timestamps": True,
                "transcription": "plain text",
                "task": "transcribe",
            },
        )

        # 6. Parse and adjust timestamps to absolute video time
        segments: List[dict] = []
        for seg in (output.get("segments") or []):
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

    finally:
        Path(tmp_video).unlink(missing_ok=True)
        Path(tmp_audio).unlink(missing_ok=True)
        try:
            supabase.storage.from_("sources").remove([audio_storage_path])
        except Exception:
            pass
