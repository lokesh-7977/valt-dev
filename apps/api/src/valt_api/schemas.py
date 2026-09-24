from typing import Literal

from pydantic import BaseModel, Field

# Keep in sync with packages/shared/src/index.ts.


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class Item(ItemCreate):
    id: int
