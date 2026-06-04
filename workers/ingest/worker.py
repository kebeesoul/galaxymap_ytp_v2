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
POLL_INTERVAL = 1


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


def classify_ytdlp_error(stderr: str, stage: str) -> str:
    err = stderr[:1000]
    lowered = stderr.lower()

    if any(k in lowered for k in ("age-restricted", "age restricted", "confirm your age", "sign in to confirm your age")):
        return f"{stage} 실패: 연령 제한 영상입니다. YouTube 로그인 쿠키가 필요합니다."

    if any(k in lowered for k in ("private video", "this video is private")):
        return f"{stage} 실패: 비공개 영상입니다. 영상 공개 여부를 확인해주세요."

    if any(k in lowered for k in ("removed by", "copyright", "has been removed")):
        return f"{stage} 실패: 저작권 또는 게시자 조치로 삭제된 영상입니다."

    if any(k in lowered for k in ("video unavailable", "this video is unavailable")):
        return f"{stage} 실패: YouTube에서 unavailable로 응답했습니다. 지역 제한, 삭제, 공개 상태를 확인해주세요."

    if any(k in lowered for k in ("not available in your country", "not available in your region", "uploader has not made this video available")):
        return f"{stage} 실패: 지역 제한 영상입니다. Mac worker의 네트워크 지역 또는 다른 공식 영상 후보를 확인해주세요."

    if any(k in lowered for k in ("403", "forbidden", "bot", "po token", "sign in to confirm you’re not a bot", "sign in to confirm you're not a bot")):
        return (
            f"{stage} 실패: YouTube 접근이 차단되었습니다. 영상 자체가 삭제된 것은 아닐 수 있습니다. "
            "yt-dlp 업데이트, 로그인 쿠키 갱신, player client 재시도를 확인해주세요. "
            f"원본 오류: {err}"
        )

    if any(k in lowered for k in ("unable to extract", "unable to download webpage", "expected to find", "nsig extraction failed")):
        return (
            f"{stage} 실패: yt-dlp extractor가 YouTube 변경을 따라가지 못했습니다. "
            f"yt-dlp 업데이트가 우선입니다. 원본 오류: {err}"
        )

    if any(k in lowered for k in ("unsupported url", "is not a valid url", "invalid url")):
        return f"{stage} 실패: 유효하지 않은 YouTube URL입니다."

    if any(k in lowered for k in ("requested format is not available", "no video formats found", "no suitable formats")):
        return (
            f"{stage} 실패: 선택한 mp4 preview 포맷을 받을 수 없습니다. "
            f"format fallback 또는 다른 영상 후보가 필요합니다. 원본 오류: {err}"
        )

    return f"{stage} 실패: 분류되지 않은 yt-dlp 오류입니다. 원본 오류: {err}"


async def process(supabase, project_id: str, source_url: str) -> None:
    # Claim the job atomically — only update if still pending (guard against duplicates)
    claim = supabase.table("projects").update({"import_status": "processing"}).eq("id", project_id).eq("import_status", "pending").execute()
    if not claim.data:
        return  # Already claimed by another instance

    try:
        # Fetch metadata
        rc, stdout, stderr = await _run(60, "--dump-json", "--no-playlist", source_url)
        if rc != 0:
            raise RuntimeError(classify_ytdlp_error(stderr.decode(errors="replace"), "메타데이터 조회"))

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
                raise RuntimeError(classify_ytdlp_error(stderr2.decode(errors="replace"), "preview 다운로드"))

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
