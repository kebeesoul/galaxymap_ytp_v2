"""
Ingest FastAPI server — port 8001.
Endpoints:
  POST /upload-bgm  — upload BGM file to Supabase Storage

Start: uvicorn server:app --host 0.0.0.0 --port 8001
"""
import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")

app = FastAPI()


def _get_signed_url(supabase, storage_path: str) -> str:
    resp = supabase.storage.from_("sources").create_signed_url(storage_path, 31_536_000)
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
