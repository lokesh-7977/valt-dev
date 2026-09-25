"""Uploads on local disk: <root>/<id>.bin plus <id>.json metadata."""

import asyncio
import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

from valt_api.core.errors import NotFoundError
from valt_api.services.storage.base import StoredFile

# Ids are uuid4 hex — checked before touching the filesystem, so no path traversal.
_ID = re.compile(r"^[0-9a-f]{32}$")


class LocalFileStorage:
    def __init__(self, root: Path) -> None:
        self._root = root
        self._root.mkdir(parents=True, exist_ok=True)

    async def save(self, data: bytes, *, filename: str, content_type: str) -> StoredFile:
        meta = StoredFile(
            id=uuid.uuid4().hex,
            filename=filename,
            content_type=content_type,
            size_bytes=len(data),
            created_at=datetime.now(UTC),
        )
        await asyncio.to_thread(self._write, meta, data)
        return meta

    async def read(self, file_id: str) -> tuple[StoredFile, bytes]:
        if not _ID.match(file_id):
            raise NotFoundError("file")
        try:
            return await asyncio.to_thread(self._read, file_id)
        except FileNotFoundError as exc:
            raise NotFoundError("file") from exc

    async def delete(self, file_id: str) -> None:
        if not _ID.match(file_id):
            return
        for suffix in (".bin", ".json"):
            (self._root / f"{file_id}{suffix}").unlink(missing_ok=True)

    def _write(self, meta: StoredFile, data: bytes) -> None:
        (self._root / f"{meta.id}.bin").write_bytes(data)
        (self._root / f"{meta.id}.json").write_text(
            json.dumps(
                {
                    "filename": meta.filename,
                    "content_type": meta.content_type,
                    "size_bytes": meta.size_bytes,
                    "created_at": meta.created_at.isoformat(),
                }
            )
        )

    def _read(self, file_id: str) -> tuple[StoredFile, bytes]:
        raw = json.loads((self._root / f"{file_id}.json").read_text())
        data = (self._root / f"{file_id}.bin").read_bytes()
        meta = StoredFile(
            id=file_id,
            filename=raw["filename"],
            content_type=raw["content_type"],
            size_bytes=raw["size_bytes"],
            created_at=datetime.fromisoformat(raw["created_at"]),
        )
        return meta, data
