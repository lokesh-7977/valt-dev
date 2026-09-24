from fastapi import APIRouter, HTTPException, status

from valt_api.schemas import Item, ItemCreate

router = APIRouter(prefix="/items", tags=["items"])

# Placeholder store — swap for a real database layer.
_items: dict[int, Item] = {}
_next_id = 1


@router.get("", response_model=list[Item])
async def list_items() -> list[Item]:
    return list(_items.values())


@router.post("", response_model=Item, status_code=status.HTTP_201_CREATED)
async def create_item(payload: ItemCreate) -> Item:
    global _next_id
    item = Item(id=_next_id, **payload.model_dump())
    _items[item.id] = item
    _next_id += 1
    return item


@router.get("/{item_id}", response_model=Item)
async def get_item(item_id: int) -> Item:
    item = _items.get(item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="item not found")
    return item
