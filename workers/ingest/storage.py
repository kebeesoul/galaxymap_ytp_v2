import os
from pathlib import Path

import boto3
from botocore.config import Config


REQUIRED_R2_ENV = (
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
)


def r2_settings() -> dict[str, str]:
    missing = [name for name in REQUIRED_R2_ENV if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"Missing R2 environment variables: {', '.join(missing)}")
    return {name: os.environ[name] for name in REQUIRED_R2_ENV}


def r2_client():
    settings = r2_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings["R2_ENDPOINT"],
        aws_access_key_id=settings["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=settings["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )


def upload_source(local_path: Path, key: str) -> str:
    settings = r2_settings()
    r2_client().upload_file(
        str(local_path),
        settings["R2_BUCKET"],
        key,
        ExtraArgs={"ContentType": "video/mp4"},
    )
    return key


def download_source(key: str, local_path: Path) -> Path:
    settings = r2_settings()
    local_path.parent.mkdir(parents=True, exist_ok=True)
    r2_client().download_file(settings["R2_BUCKET"], key, str(local_path))
    return local_path
