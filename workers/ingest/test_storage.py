import tempfile
import unittest
from pathlib import Path

import storage


class LocalStorageTests(unittest.TestCase):
    def test_publish_source_returns_relative_key_without_deleting_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = Path(tmpdir) / "video.mp4"
            local_path.write_bytes(b"video")
            key = "user-1/sources/preview/video.mp4"

            result = storage.publish_source(local_path, key)

            self.assertEqual(result, key)
            self.assertTrue(local_path.exists())

    def test_publish_source_requires_existing_file(self):
        with self.assertRaisesRegex(RuntimeError, "does not exist"):
            storage.publish_source(Path("/tmp/missing-video.mp4"), "user-1/sources/preview/video.mp4")

    def test_local_source_file_resolves_under_workspace_ingest(self):
        path = storage.local_source_file(
            Path("/repo/workspace"),
            "user-1/sources/preview/video.mp4",
        )

        self.assertEqual(path, Path("/repo/workspace/ingest/user-1/sources/preview/video.mp4"))

    def test_local_source_file_rejects_path_traversal(self):
        with self.assertRaisesRegex(RuntimeError, "Invalid local source key"):
            storage.local_source_file(Path("/repo/workspace"), "../escape/sources/preview/video.mp4")


if __name__ == "__main__":
    unittest.main()
