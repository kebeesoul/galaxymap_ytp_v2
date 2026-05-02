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


async def _run_with_client(client: str, timeout: int, *args: str) -> tuple[int, bytes, bytes]:
    proc = await asyncio.create_subprocess_exec(
        "yt-dlp",
        "--extractor-args", f"youtube:player_client={client}",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return proc.returncode or 0, stdout, stderr


async def _run(timeout: int, *args: str) -> tuple[int, bytes, bytes]:
    # Primary: ios,web bypasses PO token requirement (YouTube bot detection).
    rc, stdout, stderr = await _run_with_client("ios,web", timeout, *args)
    if rc != 0:
        err = stderr.decode(errors="replace")
        # tv_embedded player skips YouTube's age-gate — retry only for that error.
        if any(k in err for k in ("age-restricted", "age restricted", "confirm your age", "Sign in to confirm")):
            rc, stdout, stderr = await _run_with_client("tv_embedded", timeout, *args)
    return rc, stdout, stderr


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
                "--concurrent-fragments", "8",
                "--external-downloader", "aria2c",
                "--external-downloader-args", "aria2c:-x8 -k1M -s8",
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

            preview_size = files[0].stat().st_size
            print(f"[PREVIEW] size: {preview_size:,} bytes")

            storage_path = f"preview/{video_id}.mp4"
            with open(files[0], "rb") as f:
                supabase.storage.from_("sources").upload(
                    path=storage_path,
                    file=f.read(),
                    file_options={"content-type": "video/mp4", "upsert": "true"},
                )

        # Mark import as success immediately — project is usable for editing now.
        # HQ download below is non-blocking; its path is patched in separately.
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

        # HQ source for render — non-blocking, failure does not affect import completion.
        # Must use 'web' client (not 'ios') to access DASH adaptive streams for 1080p.
        with tempfile.TemporaryDirectory() as hq_tmpdir:
            try:
                hq_out = str(Path(hq_tmpdir) / f"{video_id}_hq.%(ext)s")
                rc3, _, stderr3 = await _run_with_client(
                    "web",
                    600,
                    "-f", "bestvideo[height>=720][height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height>=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height>=720]+bestaudio",
                    "--merge-output-format", "mp4",
                    "--concurrent-fragments", "8",
                    "--no-playlist",
                    "-o", hq_out,
                    source_url,
                )
                if rc3 == 0:
                    hq_file = Path(hq_tmpdir) / f"{video_id}_hq.mp4"
                    if hq_file.exists():
                        hq_size = hq_file.stat().st_size
                        print(f"[HQ]      size: {hq_size:,} bytes  preview: {preview_size:,} bytes  ratio: {hq_size/max(preview_size,1):.2f}x")
                        if hq_size <= preview_size * 1.5:
                            print(f"[HQ ERROR] {project_id}  HQ ({hq_size:,}) not significantly larger than preview ({preview_size:,}) — likely same quality, skipping")
                        else:
                            with open(hq_file, "rb") as f:
                                upload_resp = supabase.storage.from_("sources").upload(
                                    path=f"hq/{video_id}.mp4",
                                    file=f.read(),
                                    file_options={"content-type": "video/mp4", "upsert": "true"},
                                )
                            if getattr(upload_resp, "error", None):
                                raise RuntimeError(f"HQ upload failed: {upload_resp.error}")
                            hq_storage_path = f"hq/{video_id}.mp4"
                            supabase.table("projects").update({"yt_hq_source_path": hq_storage_path}).eq("id", project_id).execute()
                            print(f"[HQ]  {project_id}  {hq_storage_path}")
                else:
                    print(f"[HQ WARN] {project_id}  HQ download failed (non-fatal): {stderr3.decode(errors='replace')[:200]}")
            except Exception as exc:
                print(f"[HQ WARN] {project_id}  HQ download error (non-fatal): {exc}")

    except Exception as exc:
        supabase.table("projects").update({
            "import_status": "failed",
            "import_error": str(exc)[:500],
        }).eq("id", project_id).execute()
        import traceback
        print(f"[ERR] {project_id}  {exc}")
        traceback.print_exc()


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
