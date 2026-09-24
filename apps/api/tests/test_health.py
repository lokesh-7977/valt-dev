import httpx
import pytest
from httpx import ASGITransport

from valt_api.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_health(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


async def test_item_roundtrip(client: httpx.AsyncClient) -> None:
    created = await client.post("/api/items", json={"name": "first"})
    assert created.status_code == 201
    item_id = created.json()["id"]

    fetched = await client.get(f"/api/items/{item_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "first"


async def test_missing_item(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/items/99999")
    assert res.status_code == 404
