import tempfile
import unittest
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import worker


class WorkerPathTests(unittest.TestCase):
    def test_local_source_path_uses_owner_prefix(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(worker, "STORAGE_ROOT", Path(tmpdir)):
                path = worker.local_source_path("user-123", "video-456")

        self.assertEqual(
            path,
            Path(tmpdir) / "user-123" / "sources" / "preview" / "video-456.mp4",
        )

    def test_local_source_path_marks_legacy_rows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(worker, "STORAGE_ROOT", Path(tmpdir)):
                path = worker.local_source_path(None, "video-456")

        self.assertEqual(
            path,
            Path(tmpdir) / "legacy" / "sources" / "preview" / "video-456.mp4",
        )


class WorkerErrorTests(unittest.TestCase):
    def test_expired_cookie_error_is_specific(self):
        message = worker.classify_ytdlp_error(
            "The provided YouTube account cookies are no longer valid.",
            "metadata",
        )

        self.assertIn("쿠키가 만료", message)

    def test_probe_video_height_returns_zero_for_missing_file(self):
        self.assertEqual(
            asyncio.run(worker.probe_video_height(Path("/tmp/does-not-exist.mp4"))),
            0,
        )


class PlayerClientTests(unittest.TestCase):
    def test_1080p_capable_web_client_is_primary(self):
        self.assertEqual(worker.PRIMARY_PLAYER_CLIENT, "web,web_safari")
        self.assertEqual(worker.FALLBACK_PLAYER_CLIENT, "android,web")


class WorkerReliabilityTests(unittest.TestCase):
    def setUp(self):
        self.supabase = Mock()
        self.query = Mock()
        self.supabase.table.return_value = self.query
        self.query.update.return_value = self.query
        self.query.upsert.return_value = self.query
        self.query.eq.return_value = self.query
        self.query.lt.return_value = self.query
        self.now = datetime(2026, 6, 8, 12, 0, tzinfo=timezone.utc)

    def test_claim_records_processing_started_at(self):
        self.query.execute.return_value = SimpleNamespace(data=[{"id": "project-1"}])

        claimed = worker.claim_project(self.supabase, "project-1", self.now)

        self.assertTrue(claimed)
        self.query.update.assert_called_once_with({
            "import_status": "processing",
            "processing_started_at": self.now.isoformat(),
            "import_error": None,
        })
        self.query.eq.assert_any_call("id", "project-1")
        self.query.eq.assert_any_call("import_status", "pending")

    def test_heartbeat_upserts_ingest_worker(self):
        self.query.execute.return_value = SimpleNamespace(data=[])

        worker.heartbeat(self.supabase, self.now)

        self.query.upsert.assert_called_once_with(
            {
                "worker_id": "ingest",
                "last_beat_at": self.now.isoformat(),
                "note": "polling",
            },
            on_conflict="worker_id",
        )

    def test_heartbeat_runs_independently_from_job_processing(self):
        with patch.object(worker, "heartbeat") as heartbeat_mock, patch.object(
            worker.asyncio,
            "sleep",
            side_effect=asyncio.CancelledError,
        ) as sleep_mock:
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(worker.maintain_heartbeat(self.supabase))

        heartbeat_mock.assert_called_once_with(self.supabase)
        sleep_mock.assert_called_once_with(worker.HEARTBEAT_INTERVAL)

    def test_boot_self_heal_matches_server_reaper_timeout(self):
        self.query.execute.return_value = SimpleNamespace(data=[{"id": "stale-1"}])

        reaped = worker.reap_stale_processing(self.supabase, self.now)

        self.assertEqual(reaped, 1)
        self.query.update.assert_called_once_with({
            "import_status": "failed",
            "import_error": "timeout: worker did not finish within 15min",
        })
        self.query.eq.assert_called_once_with("import_status", "processing")
        self.query.lt.assert_called_once_with(
            "processing_started_at",
            "2026-06-08T11:45:00+00:00",
        )


if __name__ == "__main__":
    unittest.main()
