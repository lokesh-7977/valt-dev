"""Item queries. Repositories flush; the endpoint that owns the unit of work commits."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from valt_api.db.models.items import ItemRow


async def list_items(session: AsyncSession, *, before_id: int | None, limit: int) -> list[ItemRow]:
    """Newest first, keyset-paginated on id."""
    stmt = select(ItemRow).order_by(ItemRow.id.desc()).limit(limit)
    if before_id is not None:
        stmt = stmt.where(ItemRow.id < before_id)
    return list(await session.scalars(stmt))


async def get_item(session: AsyncSession, item_id: int) -> ItemRow | None:
    return await session.get(ItemRow, item_id)


async def create_item(session: AsyncSession, *, name: str, description: str | None) -> ItemRow:
    row = ItemRow(name=name, description=description)
    session.add(row)
    await session.flush()
    await session.refresh(row)  # load server defaults (id, timestamps)
    return row


async def update_item(
    session: AsyncSession, row: ItemRow, *, name: str | None, description: str | None
) -> ItemRow:
    if name is not None:
        row.name = name
    if description is not None:
        row.description = description
    await session.flush()
    await session.refresh(row)
    return row


async def delete_item(session: AsyncSession, row: ItemRow) -> None:
    await session.delete(row)
    await session.flush()
