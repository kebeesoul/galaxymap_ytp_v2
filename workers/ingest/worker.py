"""
Pull-based ingest worker.
Polls Supabase for projects with import_status='pending', downloads via yt-dlp,
uploads preview mp4 to Supabase Storage, then updates the project row.
No HTTP server — only outbound connections to Supabase.
"""
import asyncio
import json
import os
from pathlib import Path
import tempfile

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
POLL_INTERVAL = 3


async def _run(timeout: int, *args: str) -> tuple[int, bytes, bytes]:
    # YouTube returns "Precondition check failed" / HTTP 400 against the default
    # player client (requires a PO token). Force iOS / web clients which don't.
    proc = await asyncio.create_subprocess_exec(
        "yt-dlp",
        "--extractor-args", "youtube:player_client=ios,web",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return proc.returncode or 0, stdout, stderr


async def process(supabase, project_id: str, source_url: str) -> None:
    # Claim the job atomically — only update if still pending (guard against duplicates)
    claim = supabase.table("projects").update({"import_status": "processing"}).eq("id", project_id).eq("import_status", "pending").execute()
    if not claim.data:
        return  # Already claimed by another instance

    try:
        # Fetch metadata
        rc, stdout, stderr = await _run(60, "--dump-json", "--no-playlist", source_url)
        if rc != 0:
            err = stderr.decode(errors="replace")
            if any(k in err for k in ("age-restricted", "age restricted", "confirm your age")):
                raise RuntimeError("연령 제한 영상 — YouTube 로그인 없이는 다운로드할 수 없습니다.")
            elif any(k in err for k in ("Private video", "private video", "This video is private")):
                raise RuntimeError("비공개 영상 — 영상 공개 여부를 확인해주세요.")
            elif any(k in err for k in ("copyright", "Copyright", "removed by")):
                raise RuntimeError("저작권으로 인해 삭제된 영상입니다.")
            elif any(k in err for k in ("not available", "is unavailable", "Video unavailable", "403")):
                raise RuntimeError("사용할 수 없는 영상입니다 (지역 제한 또는 삭제됨).")
            elif any(k in err for k in ("Unable to extract", "Unsupported URL", "is not a valid URL")):
                raise RuntimeError("유효하지 않은 YouTube URL입니다.")
            else:
                raise RuntimeError(f"메타데이터를 가져올 수 없습니다: {err[:200]}")

        info = json.loads(stdout.decode())
        video_id: str = info["id"]
        title: str = info.get("title", "")
        duration_sec: int = int(info.get("duration") or 0)
        thumbnail_url: str = info.get("thumbnail", "")

        # Download a small, browser-friendly mp4 for preview.
        # Cap at 360p and prefer pre-muxed mp4 (H.264 + AAC) so the browser can
        # decode it without re-encoding — required for smooth 1× playback while
        # WaveSurfer is reading the same media element.
        with tempfile.TemporaryDirectory() as tmpdir:
            out_tmpl = str(Path(tmpdir) / "%(id)s.%(ext)s")
            rc2, _, stderr2 = await _run(
                300,
                "-f",
                "best[height<=360][ext=mp4]/best[height<=480][ext=mp4]/worst[ext=mp4]/worst",
                "--no-playlist",
                "-o", out_tmpl,
                source_url,
            )
            if rc2 != 0:
                err2 = stderr2.decode(errors="replace")
                if any(k in err2 for k in ("age-restricted", "confirm your age")):
                    raise RuntimeError("연령 제한 영상 — YouTube 로그인 없이는 다운로드할 수 없습니다.")
                raise RuntimeError(f"다운로드 실패: {err2[:200]}")

            files = list(Path(tmpdir).iterdir())
            if not files:
                raise RuntimeError("Download produced no output file")

            storage_path = f"preview/{video_id}.mp4"
            with open(files[0], "rb") as f:
                supabase.storage.from_("sources").upload(
                    path=storage_path,
                    file=f.read(),
                    file_options={"content-type": "video/mp4", "upsert": "true"},
                )

        supabase.table("projects").update({
            "import_status": "success",
            "yt_video_id": video_id,
            "yt_title": title,
            "yt_duration_sec": duration_sec,
            "yt_thumbnail_url": thumbnail_url,
            "yt_source_path": storage_path,
            "import_error": None,
        }).eq("id", project_id).execute()
        print(f"[OK]  {project_id}  {title}")

    except Exception as exc:
        supabase.table("projects").update({
            "import_status": "failed",
            "import_error": str(exc)[:500],
        }).eq("id", project_id).execute()
        print(f"[ERR] {project_id}  {exc}")


async def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise SystemExit("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set")

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # Reset any jobs stuck in 'processing' from a previous crash
    supabase.table("projects").update({"import_status": "pending"}).eq("import_status", "processing").execute()

    print(f"galaxymap ingest worker — polling every {POLL_INTERVAL}s")
    while True:
        try:
            result = (
                supabase.table("projects")
                .select("id, source_url")
                .eq("import_status", "pending")
                .order("created_at")
                .limit(1)
                .execute()
            )
            if result.data:
                job = result.data[0]
                print(f"[JOB] {job['id']}")
                await process(supabase, job["id"], job["source_url"])
        except Exception as exc:
            print(f"[POLL ERR] {exc}")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
