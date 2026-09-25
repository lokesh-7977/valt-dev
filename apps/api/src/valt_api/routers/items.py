from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from valt_api.core.errors import NotFoundError
from valt_api.core.responses import ERROR_RESPONSES, ApiResponse, PageMeta, ok
from valt_api.db.repositories import items as repo
from valt_api.db.session import SessionDep
from valt_api.schemas import Item, ItemCreate, ItemUpdate

router = APIRouter(prefix="/items", tags=["items"], responses=ERROR_RESPONSES)


@router.get("", response_model=ApiResponse[list[Item]])
async def list_items(
    session: SessionDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[
        int | None, Query(ge=1, description="next_cursor from a previous page")
    ] = None,
) -> ApiResponse[list[Item]]:
    rows = await repo.list_items(session, before_id=cursor, limit=limit + 1)
    page, more = rows[:limit], len(rows) > limit
    next_cursor = str(page[-1].id) if more and page else None
    return ok(
        [Item.model_validate(r) for r in page], PageMeta(limit=limit, next_cursor=next_cursor)
    )


@router.post("", response_model=ApiResponse[Item], status_code=status.HTTP_201_CREATED)
async def create_item(payload: ItemCreate, session: SessionDep) -> ApiResponse[Item]:
    row = await repo.create_item(session, name=payload.name, description=payload.description)
    await session.commit()
    return ok(Item.model_validate(row))


@router.get("/{item_id}", response_model=ApiResponse[Item])
async def get_item(item_id: int, session: SessionDep) -> ApiResponse[Item]:
    row = await repo.get_item(session, item_id)
    if row is None:
        raise NotFoundError("item")
    return ok(Item.model_validate(row))


@router.patch("/{item_id}", response_model=ApiResponse[Item])
async def update_item(item_id: int, payload: ItemUpdate, session: SessionDep) -> ApiResponse[Item]:
    row = await repo.get_item(session, item_id)
    if row is None:
        raise NotFoundError("item")
    row = await repo.update_item(
        session, row, name=payload.name, description=payload.description
    )
    await session.commit()
    return ok(Item.model_validate(row))


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: int, session: SessionDep) -> Response:
    row = await repo.get_item(session, item_id)
    if row is None:
        raise NotFoundError("item")
    await repo.delete_item(session, row)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
