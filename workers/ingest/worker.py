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
    proc = await asyncio.create_subprocess_exec(
        "yt-dlp", *args,
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
            if any(k in err for k in ("403", "Private video", "age-restricted", "not available")):
                raise RuntimeError("Video unavailable (age-restricted / private / region-locked)")
            raise RuntimeError(f"yt-dlp metadata error: {err[:400]}")

        info = json.loads(stdout.decode())
        video_id: str = info["id"]
        title: str = info.get("title", "")
        duration_sec: int = int(info.get("duration") or 0)
        thumbnail_url: str = info.get("thumbnail", "")

        # Download lowest-quality mp4 for preview
        with tempfile.TemporaryDirectory() as tmpdir:
            out_tmpl = str(Path(tmpdir) / "%(id)s.%(ext)s")
            rc2, _, stderr2 = await _run(
                300,
                "-f", "worst[ext=mp4]/worst",
                "--no-playlist",
                "-o", out_tmpl,
                source_url,
            )
            if rc2 != 0:
                raise RuntimeError(f"yt-dlp download error: {stderr2.decode(errors='replace')[:400]}")

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
