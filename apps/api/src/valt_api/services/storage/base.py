from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class StoredFile:
    id: str
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime


class FileStorage(Protocol):
    """Blob store for uploads. LocalFileStorage now; add a GCS class with the same methods
    when files must survive restarts or be shared across instances."""

    async def save(self, data: bytes, *, filename: str, content_type: str) -> StoredFile: ...

    async def read(self, file_id: str) -> tuple[StoredFile, bytes]:
        """Raises NotFoundError for unknown ids."""
        ...

    async def delete(self, file_id: str) -> None: ...
