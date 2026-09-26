import asyncio
import json
from collections.abc import AsyncIterator

import httpx
import pytest
from fakes import FakeComputerUse, action, reply

from valt_api.main import app
from valt_api.qa_agent.manager import QAManager


@pytest.fixture
async def qa_client(client: httpx.AsyncClient) -> AsyncIterator[httpx.AsyncClient]:
    # Each run: two clicks (the fake page sleeps 50 ms per action), then a BUG report.
    app.state.computer_use = FakeComputerUse(
        replies=[
            reply(action("click", x=1, y=1)),
            reply(action("click", x=2, y=2)),
            reply(text="VERDICT: BUG\nSUMMARY: Empty password accepted."),
        ]
    )
    yield client


def manager() -> QAManager:
    m: QAManager = app.state.qa_manager
    return m


async def collect(
    m: QAManager, until_done: int = 1, timeout: float = 3.0
) -> list[tuple[str, dict]]:
    """Read SSE frames from the manager until `until_done` done events arrive."""
    out: list[tuple[str, dict]] = []
    sub = m.subscribe()

    async def read() -> None:
        async for frame in sub:
            if frame.startswith(":"):
                continue
            head, data = frame.strip().split("\n", 1)
            out.append((head.removeprefix("event: "), json.loads(data.removeprefix("data: "))))
            if sum(1 for n, _ in out if n == "done") >= until_done:
                return

    try:
        await asyncio.wait_for(read(), timeout)
    finally:
        await sub.aclose()  # type: ignore[attr-defined]
    return out


async def test_scenarios(client: httpx.AsyncClient) -> None:
    res = await client.get("/api/v1/qa/scenarios")
    assert res.status_code == 200
    ids = [s["id"] for s in res.json()["data"]]
    assert "signup_empty_password" in ids


async def test_start_without_ai_is_503(client: httpx.AsyncClient) -> None:
    res = await client.post("/api/v1/qa/runs", json={})
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "ai_unavailable"


async def test_start_run_streams_events(qa_client: httpx.AsyncClient) -> None:
    res = await qa_client.post("/api/v1/qa/runs", json={"scenario_id": "signup_empty_password"})
    assert res.status_code == 202
    run = res.json()["data"]
    assert run["status"] == "running" and run["trigger"] == "manual"

    events = await collect(manager())
    assert events[0][0] == "step" and events[0][1]["kind"] == "run_started"
    assert events[-1][0] == "done"
    assert events[-1][1]["run"]["run_id"] == run["run_id"]
    assert events[-1][1]["run"]["status"] == "bug_found"


async def test_second_start_cancels_first(qa_client: httpx.AsyncClient) -> None:
    first = (await qa_client.post("/api/v1/qa/runs", json={})).json()["data"]
    await asyncio.sleep(0.02)
    second = (await qa_client.post("/api/v1/qa/runs", json={})).json()["data"]
    # The first run's stopped event is in the stream before the second starts (replay is cleared
    # on start), so subscribe first and look at the second run only.
    events = await collect(manager())
    done = [d for n, d in events if n == "done"]
    assert done[-1]["run"]["run_id"] == second["run_id"]
    assert first["run_id"] != second["run_id"]


async def test_first_run_reports_stopped_when_replaced(qa_client: httpx.AsyncClient) -> None:
    m = manager()
    sub_task = asyncio.create_task(collect(m, until_done=2))
    await asyncio.sleep(0.01)
    await qa_client.post("/api/v1/qa/runs", json={})
    await asyncio.sleep(0.02)
    await qa_client.post("/api/v1/qa/runs", json={})
    events = await sub_task
    statuses = [d["run"]["status"] for n, d in events if n == "done"]
    assert statuses == ["stopped", "bug_found"]


async def test_save_hooks_are_debounced(qa_client: httpx.AsyncClient) -> None:
    m = manager()
    started: list[str] = []
    original = m.start

    async def spy(*args, **kwargs):  # type: ignore[no-untyped-def]
        info = await original(*args, **kwargs)
        started.append(info.trigger)
        return info

    m.start = spy  # type: ignore[method-assign]
    for _ in range(3):
        res = await qa_client.post("/api/v1/qa/save-hook", json={"path": "app.js"})
        assert res.status_code == 202
        assert res.json()["data"] == {"scheduled": True, "debounce_ms": 100}
        await asyncio.sleep(0.02)
    assert started == []
    await asyncio.sleep(0.2)
    assert started == ["save"]


async def test_stop(qa_client: httpx.AsyncClient) -> None:
    run = (await qa_client.post("/api/v1/qa/runs", json={})).json()["data"]
    res = await qa_client.post("/api/v1/qa/runs/stop")
    assert res.json()["data"] == {"stopped": True, "run_id": run["run_id"]}
    res = await qa_client.post("/api/v1/qa/runs/stop")
    assert res.json()["data"] == {"stopped": False, "run_id": None}


async def test_unknown_scenario_is_404(qa_client: httpx.AsyncClient) -> None:
    res = await qa_client.post("/api/v1/qa/runs", json={"scenario_id": "nope"})
    assert res.status_code == 404
    res = await qa_client.post("/api/v1/qa/save-hook", json={"scenario_id": "nope"})
    assert res.status_code == 404
