import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import storage


R2_ENV = {
    "R2_ENDPOINT": "https://account.r2.cloudflarestorage.com",
    "R2_ACCESS_KEY_ID": "access-key",
    "R2_SECRET_ACCESS_KEY": "secret-key",
    "R2_BUCKET": "source-bucket",
}


class R2StorageTests(unittest.TestCase):
    @patch.dict(os.environ, R2_ENV, clear=False)
    @patch.object(storage.boto3, "client")
    def test_client_uses_r2_region_and_checksum_compatibility(self, client_mock):
        storage.r2_client()

        kwargs = client_mock.call_args.kwargs
        self.assertEqual(kwargs["region_name"], "auto")
        self.assertEqual(
            kwargs["config"].request_checksum_calculation,
            "when_required",
        )
        self.assertEqual(
            kwargs["config"].response_checksum_validation,
            "when_required",
        )

    @patch.dict(os.environ, R2_ENV, clear=False)
    @patch.object(storage, "r2_client")
    def test_upload_returns_relative_key(self, client_factory):
        client = Mock()
        client_factory.return_value = client
        key = "user-1/sources/preview/video.mp4"

        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = Path(tmpdir) / "video.mp4"
            local_path.write_bytes(b"video")
            result = storage.upload_source(local_path, key)

        self.assertEqual(result, key)
        client.upload_file.assert_called_once_with(
            str(local_path),
            "source-bucket",
            key,
            ExtraArgs={"ContentType": "video/mp4"},
        )

    @patch.dict(os.environ, R2_ENV, clear=False)
    @patch.object(storage, "r2_client")
    def test_download_writes_to_requested_scratch_path(self, client_factory):
        client = Mock()
        client_factory.return_value = client
        key = "user-1/sources/preview/video.mp4"

        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = Path(tmpdir) / "nested" / "video.mp4"
            result = storage.download_source(key, local_path)

        self.assertEqual(result, local_path)
        client.download_file.assert_called_once_with(
            "source-bucket",
            key,
            str(local_path),
        )


if __name__ == "__main__":
    unittest.main()
