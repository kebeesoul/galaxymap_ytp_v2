from pathlib import Path


def publish_source(local_path: Path, key: str) -> str:
    if not local_path.is_file():
        raise RuntimeError(f"Local source file does not exist: {local_path}")
    return key


def local_source_file(storage_root: Path, key: str) -> Path:
    parts = key.split("/")
    if len(parts) != 4 or parts[1] != "sources" or parts[2] != "preview":
        raise RuntimeError("Invalid local source key")
    if any(part in {"", ".", ".."} or "/" in part or "\\" in part for part in parts):
        raise RuntimeError("Invalid local source key")
    return storage_root / "ingest" / Path(*parts)
