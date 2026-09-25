from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Keep in sync with packages/shared/src/index.ts.
# Every response is wrapped in the envelope from valt_api.core.responses.


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


class ReadinessResponse(BaseModel):
    status: Literal["ready"] = "ready"
    database: Literal["ok"] = "ok"


def _strip(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("must not be blank")
    return v


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)

    _name = field_validator("name")(_strip)


class ItemUpdate(BaseModel):
    """Partial update. Omitted fields are unchanged."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else _strip(v)


class Item(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
