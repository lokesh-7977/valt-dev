import httpx
import pytest


async def test_health_envelope(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["status"] == "ok"
    assert body["meta"] is None
    assert res.headers["X-Request-ID"]


async def test_request_id_is_echoed(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/health", headers={"X-Request-ID": "abc123"})
    assert res.headers["X-Request-ID"] == "abc123"


async def test_ready_without_database_is_503(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/health/ready")
    assert res.status_code == 503
    body = res.json()
    assert body["success"] is False
    assert body["error"]["code"] == "database_unavailable"
    assert body["error"]["request_id"] == res.headers["X-Request-ID"]


async def test_items_without_database_is_503(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/items")
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "database_unavailable"


async def test_unknown_route_uses_error_envelope(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/nope")
    assert res.status_code == 404
    assert res.json() == {
        "success": False,
        "error": {
            "code": "not_found",
            "message": "Not Found",
            "details": None,
            "request_id": res.headers["X-Request-ID"],
        },
    }


@pytest.mark.db
async def test_ready_with_database(db_client: httpx.AsyncClient) -> None:
    res = await db_client.get("/api/health/ready")
    assert res.status_code == 200
    assert res.json()["data"] == {"status": "ready", "database": "ok"}
