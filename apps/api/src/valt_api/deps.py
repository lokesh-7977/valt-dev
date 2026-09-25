"""FastAPI dependencies for app-wide services. Clients live on app.state (built in lifespan),
so tests swap them by assigning app.state.model_client / app.state.storage."""

from typing import Annotated

from fastapi import Depends, Request, status

from valt_api.config import Settings, get_settings
from valt_api.core.errors import AIUnavailableError, AppError
from valt_api.services.ai import AIService, ModelClient
from valt_api.services.storage import FileStorage

SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_model_client(request: Request) -> ModelClient:
    client: ModelClient | None = getattr(request.app.state, "model_client", None)
    if client is None:
        raise AIUnavailableError()
    return client


def get_storage(request: Request) -> FileStorage:
    storage: FileStorage | None = getattr(request.app.state, "storage", None)
    if storage is None:
        raise AppError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "storage_unavailable", "file storage unavailable"
        )
    return storage


StorageDep = Annotated[FileStorage, Depends(get_storage)]


def get_ai_service(
    client: Annotated[ModelClient, Depends(get_model_client)], storage: StorageDep
) -> AIService:
    return AIService(client, storage)


AIServiceDep = Annotated[AIService, Depends(get_ai_service)]
