import httpx
import pytest

pytestmark = pytest.mark.db


async def test_create_and_get(db_client: httpx.AsyncClient) -> None:
    created = await db_client.post("/api/v1/items", json={"name": "  first  ", "description": "d"})
    assert created.status_code == 201
    item = created.json()["data"]
    assert item["name"] == "first"  # trimmed
    assert item["description"] == "d"
    assert item["id"] > 0
    assert item["created_at"].endswith(("Z", "+00:00"))  # UTC
    assert item["updated_at"].endswith(("Z", "+00:00"))

    fetched = await db_client.get(f"/api/v1/items/{item['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["data"] == item


async def test_list_is_newest_first_with_cursor_pagination(db_client: httpx.AsyncClient) -> None:
    ids = []
    for n in range(5):
        res = await db_client.post("/api/v1/items", json={"name": f"item {n}"})
        ids.append(res.json()["data"]["id"])

    page1 = (await db_client.get("/api/v1/items", params={"limit": 2})).json()
    assert [i["id"] for i in page1["data"]] == ids[::-1][:2]
    assert page1["meta"]["limit"] == 2
    cursor = page1["meta"]["next_cursor"]
    assert cursor is not None

    page2 = (await db_client.get("/api/v1/items", params={"limit": 2, "cursor": cursor})).json()
    assert [i["id"] for i in page2["data"]] == ids[::-1][2:4]

    last = (await db_client.get("/api/v1/items", params={"limit": 100})).json()
    assert last["meta"]["next_cursor"] is None


async def test_patch_updates_only_given_fields(db_client: httpx.AsyncClient) -> None:
    item = (
        await db_client.post("/api/v1/items", json={"name": "a", "description": "keep"})
    ).json()["data"]
    res = await db_client.patch(f"/api/v1/items/{item['id']}", json={"name": "b"})
    assert res.status_code == 200
    data = res.json()["data"]
    assert data["name"] == "b"
    assert data["description"] == "keep"


async def test_delete_then_404(db_client: httpx.AsyncClient) -> None:
    item = (await db_client.post("/api/v1/items", json={"name": "gone"})).json()["data"]
    assert (await db_client.delete(f"/api/v1/items/{item['id']}")).status_code == 204
    res = await db_client.get(f"/api/v1/items/{item['id']}")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"
    assert res.json()["error"]["message"] == "item not found"


async def test_blank_name_is_validation_error(db_client: httpx.AsyncClient) -> None:
    res = await db_client.post("/api/v1/items", json={"name": "   "})
    assert res.status_code == 422
    err = res.json()["error"]
    assert err["code"] == "validation_error"
    assert err["details"][0]["loc"] == ["body", "name"]
    assert "input" not in err["details"][0]  # submitted values are never echoed


async def test_limit_is_capped(db_client: httpx.AsyncClient) -> None:
    res = await db_client.get("/api/v1/items", params={"limit": 1000})
    assert res.status_code == 422
