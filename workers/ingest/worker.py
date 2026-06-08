"""
Pull-based ingest worker.
Polls Supabase for projects with import_status='pending', downloads via yt-dlp,
uploads the source mp4 to Cloudflare R2, then updates the project row.
No HTTP server — only outbound connections to Supabase, YouTube, and R2.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import shutil

from dotenv import load_dotenv
from supabase import create_client
from storage import upload_source

load_dotenv()

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
STORAGE_ROOT = Path(os.environ.get("STORAGE_ROOT", PROJECT_ROOT / "workspace")).expanduser()
COOKIE_FILE = Path(__file__).resolve().parent / "cookies.txt"
POLL_INTERVAL = 1
HEARTBEAT_INTERVAL = 30
WORKER_ID = "ingest"
STALE_PROCESSING_MINUTES = 15
PRIMARY_PLAYER_CLIENT = "web,web_safari"
FALLBACK_PLAYER_CLIENT = "android,web"


async def _run_with_client(
    client: str,
    timeout: int,
    *args: str,
    use_cookies: bool = True,
) -> tuple[int, bytes, bytes]:
    auth_args = ("--cookies", str(COOKIE_FILE)) if use_cookies and COOKIE_FILE.is_file() else ()
    proc = await asyncio.create_subprocess_exec(
        "yt-dlp",
        "--extractor-args", f"youtube:player_client={client}",
        "--remote-components", "ejs:github",
        *auth_args,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    return proc.returncode or 0, stdout, stderr


async def _run(timeout: int, *args: str) -> tuple[int, bytes, bytes]:
    # Web Safari currently exposes the 1080p H.264/AAC stream without a PO token.
    use_cookies = True
    rc, stdout, stderr = await _run_with_client(
        PRIMARY_PLAYER_CLIENT,
        timeout,
        *args,
    )
    if rc != 0:
        err = stderr.decode(errors="replace")
        if "cookies are no longer valid" in err.lower():
            use_cookies = False
            rc, stdout, stderr = await _run_with_client(
                PRIMARY_PLAYER_CLIENT,
                timeout,
                *args,
                use_cookies=False,
            )
            err = stderr.decode(errors="replace")
        # tv_embedded player skips YouTube's age-gate — retry only for that error.
        if any(k in err for k in ("age-restricted", "age restricted", "confirm your age", "Sign in to confirm")):
            rc, stdout, stderr = await _run_with_client(
                "tv_embedded",
                timeout,
                *args,
                use_cookies=False,
            )
        elif rc != 0:
            # Keep import usable when YouTube temporarily withholds adaptive formats.
            rc, stdout, stderr = await _run_with_client(
                FALLBACK_PLAYER_CLIENT,
                timeout,
                *args,
                use_cookies=use_cookies,
            )
    return rc, stdout, stderr


async def probe_video_height(path: Path) -> int:
    if not path.is_file():
        return 0
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=height",
        "-of", "csv=p=0",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    if proc.returncode != 0:
        return 0
    try:
        return int(stdout.decode().strip())
    except ValueError:
        return 0


def classify_ytdlp_error(stderr: str, stage: str) -> str:
    err = stderr[:1000]
    lowered = stderr.lower()

    if "cookies are no longer valid" in lowered:
        return (
            f"{stage} 실패: YouTube 로그인 쿠키가 만료되었습니다. "
            "workers/ingest/cookies.txt를 새로 내보낸 쿠키로 교체해주세요."
        )

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


def source_object_key(owner_uid: str, video_id: str) -> str:
    if not owner_uid:
        raise RuntimeError("Project owner_uid is required for R2 source isolation")
    return f"{owner_uid}/sources/preview/{video_id}.mp4"


def local_source_path(owner_uid: str, video_id: str) -> Path:
    return STORAGE_ROOT / source_object_key(owner_uid, video_id)


def publish_source(local_path: Path, key: str) -> str:
    uploaded_key = upload_source(local_path, key)
    local_path.unlink(missing_ok=True)
    return uploaded_key


def utc_timestamp(now: datetime | None = None) -> str:
    return (now or datetime.now(timezone.utc)).isoformat()


def claim_project(supabase, project_id: str, now: datetime | None = None) -> bool:
    claim = (
        supabase.table("projects")
        .update({
            "import_status": "processing",
            "processing_started_at": utc_timestamp(now),
            "import_error": None,
        })
        .eq("id", project_id)
        .eq("import_status", "pending")
        .execute()
    )
    return bool(claim.data)


def heartbeat(supabase, now: datetime | None = None) -> None:
    supabase.table("worker_health").upsert(
        {
            "worker_id": WORKER_ID,
            "last_beat_at": utc_timestamp(now),
            "note": "polling",
        },
        on_conflict="worker_id",
    ).execute()


async def maintain_heartbeat(supabase) -> None:
    while True:
        try:
            heartbeat(supabase)
        except Exception as exc:
            print(f"[HEARTBEAT ERR] {exc}")
        await asyncio.sleep(HEARTBEAT_INTERVAL)


def reap_stale_processing(supabase, now: datetime | None = None) -> int:
    cutoff = (now or datetime.now(timezone.utc)) - timedelta(minutes=STALE_PROCESSING_MINUTES)
    result = (
        supabase.table("projects")
        .update({
            "import_status": "failed",
            "import_error": "timeout: worker did not finish within 15min",
        })
        .eq("import_status", "processing")
        .lt("processing_started_at", cutoff.isoformat())
        .execute()
    )
    return len(result.data or [])


async def process(supabase, project_id: str, source_url: str, owner_uid: str | None) -> None:
    # Claim the job atomically — only update if still pending (guard against duplicates)
    if not claim_project(supabase, project_id):
        return  # Already claimed by another instance

    try:
        if not owner_uid:
            raise RuntimeError("Project owner_uid is required for R2 source isolation")

        # Fetch metadata
        rc, stdout, stderr = await _run(60, "--dump-json", "--no-playlist", source_url)
        if rc != 0:
            raise RuntimeError(classify_ytdlp_error(stderr.decode(errors="replace"), "메타데이터 조회"))

        info = json.loads(stdout.decode())
        video_id: str = info["id"]
        title: str = info.get("title", "")
        duration_sec: int = int(info.get("duration") or 0)
        thumbnail_url: str = info.get("thumbnail", "")

        output_path = local_source_path(owner_uid, video_id)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cached_height = await probe_video_height(output_path)
        if output_path.is_file() and cached_height < 720:
            print(f"[SOURCE] upgrading cached {cached_height}p file to 1080p")
            output_path.unlink()

        download_template = output_path.with_suffix(".%(ext)s")
        download_args = [
            "-f",
            "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]",
            "--merge-output-format", "mp4",
            "--concurrent-fragments", "8",
            "--no-playlist",
            "--no-overwrites",
            "-o", str(download_template),
        ]
        if shutil.which("aria2c"):
            download_args.extend([
                "--external-downloader", "aria2c",
                "--external-downloader-args", "aria2c:-x8 -k1M -s8",
            ])

        rc2, _, stderr2 = await _run(300, *download_args, source_url)
        if rc2 != 0:
            raise RuntimeError(classify_ytdlp_error(stderr2.decode(errors="replace"), "preview 다운로드"))
        candidates = sorted(output_path.parent.glob(f"{video_id}.*"))
        downloaded_path = output_path if output_path.is_file() else next(
            (candidate for candidate in candidates if candidate.is_file()),
            None,
        )
        if downloaded_path is None:
            raise RuntimeError("Download produced no output file")
        if downloaded_path != output_path:
            downloaded_path.replace(output_path)

        storage_path = source_object_key(owner_uid, video_id)
        publish_source(output_path, storage_path)

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
        raise SystemExit(
            "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set "
            "for the ingest worker"
        )

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)

    reaped = reap_stale_processing(supabase)
    if reaped:
        print(f"[SELF-HEAL] marked {reaped} stale ingest job(s) as failed")

    asyncio.create_task(maintain_heartbeat(supabase))
    print(f"galaxymap ingest worker — polling every {POLL_INTERVAL}s, storage={STORAGE_ROOT}")
    while True:
        try:
            try:
                result = (
                    supabase.table("projects")
                    .select("id, source_url, owner_uid")
                    .eq("import_status", "pending")
                    .order("created_at")
                    .limit(1)
                    .execute()
                )
            except Exception as exc:
                if "owner_uid" not in str(exc):
                    raise
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
                await process(supabase, job["id"], job["source_url"], job.get("owner_uid"))
        except Exception as exc:
            print(f"[POLL ERR] {exc}")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(main())
