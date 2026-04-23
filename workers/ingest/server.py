from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()


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
    # TODO: Phase 1 —
    # 1. Extract video_id from URL
    # 2. yt-dlp --dump-json for metadata
    # 3. yt-dlp -f worst[ext=mp4] to download preview
    # 4. Upload preview to Supabase Storage sources/preview/{video_id}.mp4
    # 5. Return metadata + preview_path
    raise HTTPException(status_code=501, detail="not implemented")
