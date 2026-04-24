import asyncio
import json
import os
from pathlib import Path
import tempfile

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client

app = FastAPI()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")


class IngestRequest(BaseModel):
    url: str


class IngestResponse(BaseModel):
    video_id: str
    title: str
    duration_sec: int
    thumbnail_url: str
    preview_path: str


@app.post("/ingest", response_model=IngestResponse)
async def ingest(body: IngestRequest) -> IngestResponse:
    # Step 1: fetch metadata via yt-dlp --dump-json
    try:
        proc = await asyncio.create_subprocess_exec(
            "yt-dlp", "--dump-json", "--no-playlist", body.url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=408, detail="yt-dlp metadata timeout (60s)")

    if proc.returncode != 0:
        err = stderr.decode(errors="replace")
        if any(k in err for k in ("403", "Private video", "age-restricted", "not available")):
            raise HTTPException(
                status_code=403,
                detail="Video unavailable (age-restricted / private / region-locked)",
            )
        raise HTTPException(status_code=422, detail=f"yt-dlp error: {err[:500]}")

    info = json.loads(stdout.decode())
    video_id: str = info["id"]
    title: str = info.get("title", "")
    duration_sec: int = int(info.get("duration") or 0)
    thumbnail_url: str = info.get("thumbnail", "")

    # Step 2: download worst[ext=mp4] to temp dir
    with tempfile.TemporaryDirectory() as tmpdir:
        out_tmpl = str(Path(tmpdir) / "%(id)s.%(ext)s")
        try:
            proc2 = await asyncio.create_subprocess_exec(
                "yt-dlp",
                "-f", "worst[ext=mp4]/worst",
                "--no-playlist",
                "-o", out_tmpl,
                body.url,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr2 = await asyncio.wait_for(proc2.communicate(), timeout=300)
        except asyncio.TimeoutError:
            raise HTTPException(status_code=408, detail="Download timeout (300s)")

        if proc2.returncode != 0:
            raise HTTPException(
                status_code=422,
                detail=f"Download error: {stderr2.decode(errors='replace')[:500]}",
            )

        files = list(Path(tmpdir).iterdir())
        if not files:
            raise HTTPException(status_code=422, detail="Download produced no output file")
        out_path = files[0]

        # Step 3: upload to Supabase Storage sources/preview/{video_id}.mp4
        storage_path = f"preview/{video_id}.mp4"
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        with open(out_path, "rb") as f:
            supabase.storage.from_("sources").upload(
                path=storage_path,
                file=f.read(),
                file_options={"content-type": "video/mp4", "upsert": "true"},
            )

    return IngestResponse(
        video_id=video_id,
        title=title,
        duration_sec=duration_sec,
        thumbnail_url=thumbnail_url,
        preview_path=storage_path,
    )
