import mimetypes
from pathlib import PurePath

from fastapi import APIRouter, UploadFile, status

from valt_api.core.errors import AppError, PayloadTooLargeError, UnsupportedMediaError
from valt_api.core.responses import AI_ERROR_RESPONSES, ApiResponse, ok
from valt_api.deps import SettingsDep, StorageDep
from valt_api.schemas import UploadedFile
from valt_api.services.ai.types import SUPPORTED_MIME_TYPES

router = APIRouter(tags=["files"], responses=AI_ERROR_RESPONSES)


def _content_type(file: UploadFile) -> str:
    declared = (file.content_type or "").split(";")[0].strip().lower()
    if declared and declared != "application/octet-stream":
        return declared
    return mimetypes.guess_type(file.filename or "")[0] or ""


@router.post(
    "/upload", response_model=ApiResponse[UploadedFile], status_code=status.HTTP_201_CREATED
)
async def upload(
    file: UploadFile, storage: StorageDep, settings: SettingsDep
) -> ApiResponse[UploadedFile]:
    """Upload one file (multipart field `file`). Returns an id to pass as `file_ids`."""
    content_type = _content_type(file)
    if content_type not in SUPPORTED_MIME_TYPES:
        raise UnsupportedMediaError(content_type)

    max_bytes = settings.max_upload_mb * 1024 * 1024
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise PayloadTooLargeError(settings.max_upload_mb)
    if not data:
        raise AppError(status.HTTP_422_UNPROCESSABLE_CONTENT, "empty_file", "file is empty")

    filename = PurePath((file.filename or "").replace("\\", "/")).name[:255] or "upload"
    stored = await storage.save(data, filename=filename, content_type=content_type)
    return ok(UploadedFile.model_validate(stored))
