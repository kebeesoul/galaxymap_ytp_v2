"""
Detect-speech FastAPI server — port 8001.
Provides POST /detect-speech: finds the first speech segment in a preview mp4
using ffmpeg silencedetect. Runs alongside worker.py as a separate process.

Start: uvicorn server:app --host 0.0.0.0 --port 8001
"""
import os
import re
import subprocess
import tempfile
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")

app = FastAPI()


class DetectSpeechBody(BaseModel):
    project_id: str


def _get_signed_url(supabase, storage_path: str) -> str:
    resp = supabase.storage.from_("sources").create_signed_url(storage_path, 3600)
    # supabase-py 2.x returns a dataclass with signed_url, or a dict with signedURL
    url: str = getattr(resp, "signed_url", None) or (
        resp.get("signedURL") or resp.get("signed_url", "")
        if isinstance(resp, dict)
        else ""
    )
    return url


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
