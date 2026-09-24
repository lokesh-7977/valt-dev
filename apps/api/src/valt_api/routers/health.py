from typing import Annotated

from fastapi import APIRouter, Depends

from valt_api import __version__
from valt_api.config import Settings, get_settings
from valt_api.schemas import HealthResponse

router = APIRouter(tags=["health"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/health", response_model=HealthResponse)
async def health(settings: SettingsDep) -> HealthResponse:
    return HealthResponse(service=settings.service_name, version=__version__)
