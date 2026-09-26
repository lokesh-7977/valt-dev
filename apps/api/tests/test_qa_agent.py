import asyncio
from datetime import UTC, datetime

import pytest
from fakes import FakeComputerUse, FakeRunPage, action, reply
from pydantic import BaseModel

from valt_api.core.errors import AIRateLimitedError
from valt_api.qa_agent.agent import parse_report, run_qa
from valt_api.qa_agent.guards import Guards
from valt_api.qa_agent.scenarios import SCENARIOS
from valt_api.schemas import QADoneEvent, QARunInfo

BUG_REPORT = (
    "VERDICT: BUG\nSUMMARY: Empty password was accepted.\nFINDINGS:\n- Shows 'Account created!'"
)


def make_run() -> QARunInfo:
    return QARunInfo(
        run_id="r1",
        scenario_id="signup_empty_password",
        trigger="manual",
        status="running",
        started_at=datetime.now(UTC),
    )


async def go(
    replies: list[object], page: FakeRunPage | None = None, max_steps: int = 15
) -> tuple[QADoneEvent, list[tuple[str, BaseModel]], FakeRunPage, FakeComputerUse]:
    events: list[tuple[str, BaseModel]] = []
    page = page or FakeRunPage()
    provider = FakeComputerUse(replies=replies)
    done = await run_qa(
        scenario=SCENARIOS["signup_empty_password"],
        provider=provider,
        run_page=page,
        guards=Guards(["localhost:8001"], max_steps=max_steps),
        run=make_run(),
        emit=lambda name, data: events.append((name, data)),
        model="fake",
    )
    return done, events, page, provider


def names(events: list[tuple[str, BaseModel]]) -> list[str]:
    return [n for n, _ in events]


async def test_bug_verdict() -> None:
    done, events, page, provider = await go(
        [
            reply(action("type", x=500, y=300, text="qa.tester@example.com")),
            reply(action("click", x=500, y=600)),
            reply(text=BUG_REPORT),
        ]
    )
    assert done.run.status == "bug_found"
    assert done.verdict == "bug"
    assert done.summary == "Empty password was accepted."
    assert done.findings == ["Shows 'Account created!'"]
    assert done.steps == 2
    assert done.usage is not None and done.usage.total_tokens == 36
    assert names(events) == ["step", "step", "step", "done"]
    first = events[0][1]
    assert first.kind == "run_started" and first.screenshot_png_b64  # type: ignore[attr-defined]
    assert [c.name for c in page.executed] == ["type", "click"]
    # each outcome carries the new screenshot back to the model
    sent = provider.sessions[0].received
    assert sent[0] == [] and sent[1][0].screenshot_png is not None


async def test_pass_verdict() -> None:
    done, _, _, _ = await go([reply(text="VERDICT: PASS\nSUMMARY: Validation shown.")])
    assert done.run.status == "passed" and done.verdict == "pass"


async def test_off_allowlist_navigate_is_blocked_and_run_continues() -> None:
    done, events, page, provider = await go(
        [reply(action("navigate", url="http://evil.example")), reply(text=BUG_REPORT)]
    )
    assert done.run.status == "bug_found"
    assert page.executed == []
    blocked = [d for n, d in events if n == "step" and d.kind == "blocked"]  # type: ignore[attr-defined]
    assert len(blocked) == 1
    outcome = provider.sessions[0].received[1][0]
    assert outcome.result["error"] == "blocked_by_policy"


async def test_secret_typing_stops_run() -> None:
    done, _, page, _ = await go([reply(action("type", text="AKIAABCDEFGHIJKLMNOP"))])
    assert done.run.status == "blocked"
    assert page.executed == []


async def test_require_confirmation_interrupts() -> None:
    safety = {"decision": "require_confirmation", "explanation": "About to submit payment"}
    done, events, page, _ = await go([reply(action("click", x=1, y=1), safety=safety)])
    assert done.run.status == "needs_confirmation"
    assert names(events)[-2:] == ["interrupt", "done"]
    assert page.executed == []


async def test_step_cap() -> None:
    done, _, page, _ = await go([reply(action("click", x=1, y=1)) for _ in range(16)])
    assert done.run.status == "inconclusive"
    assert done.steps == 15
    assert len(page.executed) == 15


async def test_cancellation_emits_stopped() -> None:
    events: list[tuple[str, BaseModel]] = []
    page = FakeRunPage(delay_s=10)
    task = asyncio.create_task(
        run_qa(
            scenario=SCENARIOS["signup_empty_password"],
            provider=FakeComputerUse(replies=[reply(action("click", x=1, y=1))]),
            run_page=page,
            guards=Guards(["localhost:8001"], max_steps=15),
            run=make_run(),
            emit=lambda n, d: events.append((n, d)),
            model="fake",
        )
    )
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert events[-1][0] == "done"
    assert events[-1][1].run.status == "stopped"  # type: ignore[attr-defined]


async def test_provider_error_emits_error_event() -> None:
    done, events, _, _ = await go([AIRateLimitedError()])
    assert done.run.status == "error"
    assert names(events) == ["step", "error", "done"]
    assert events[1][1].code == "ai_rate_limited"  # type: ignore[attr-defined]


def test_parse_report_without_verdict() -> None:
    status, verdict, summary, findings = parse_report("I could not find the form.")
    assert (status, verdict) == ("inconclusive", "inconclusive")
    assert summary == "I could not find the form."
    assert findings == []
