import tempfile
import unittest
import asyncio
from pathlib import Path
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
