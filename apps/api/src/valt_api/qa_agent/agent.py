"""The Computer Use loop: screenshot -> model action -> guards -> execute -> screenshot -> repeat.

A plain async loop, not a graph (ADR 0016): one model, one tool, a linear path, and "stop" means
cancel the task. Every step is emitted as it happens, so the UI shows the browser live. The first
event is always `run_started` with a screenshot, sent before the first (slow) model call.

Ends when the model answers without a tool call (its VERDICT report), or on a stop condition:
step cap / run timeout -> inconclusive, secret typing -> blocked, require_confirmation -> interrupt.
"""

import asyncio
import base64
import logging
import re
import time
from collections.abc import Callable
from typing import Any, Protocol

from pydantic import BaseModel

from valt_api.core.errors import AppError
from valt_api.core.responses import ErrorDetail
from valt_api.qa_agent.guards import Guards
from valt_api.qa_agent.scenarios import SYSTEM_PROMPT, Scenario
from valt_api.schemas import (
    QADoneEvent,
    QAInterruptEvent,
    QARunInfo,
    QARunStatus,
    QAStepEvent,
    QAVerdict,
    Usage,
)
from valt_api.services.ai.types import ActionCall, ActionOutcome, ComputerUseProvider
from valt_api.services.ai.types import Usage as ModelUsage

logger = logging.getLogger(__name__)

MAX_SUMMARY_CHARS = 500

# emit(event_name, payload): event names are the SSE vocabulary (step, interrupt, done, error).
Emit = Callable[[str, BaseModel], None]


class RunPageLike(Protocol):
    """What the loop needs from a browser page (browser.RunPage, or a fake in tests)."""

    async def goto(self, url: str) -> None: ...
    async def snapshot(self) -> tuple[str, bytes]: ...
    async def execute(self, call: ActionCall) -> dict[str, Any]: ...


def parse_report(text: str | None) -> tuple[QARunStatus, QAVerdict, str, list[str]]:
    """Parse the model's final `VERDICT / SUMMARY / FINDINGS` answer."""
    text = (text or "").strip()
    verdict_m = re.search(r"VERDICT:\s*\**\s*(BUG|PASS)", text, re.IGNORECASE)
    summary_m = re.search(r"SUMMARY:\s*(.+)", text, re.IGNORECASE)
    findings_block = re.split(r"FINDINGS:\s*", text, maxsplit=1, flags=re.IGNORECASE)
    findings = (
        [ln.strip().lstrip("-*• ").strip() for ln in findings_block[1].splitlines()]
        if len(findings_block) == 2
        else []
    )
    findings = [f for f in findings if f][:10]
    summary = (summary_m.group(1).strip() if summary_m else text)[:MAX_SUMMARY_CHARS]
    if verdict_m is None:
        return "inconclusive", "inconclusive", summary or "The agent ended without a verdict.", []
    if verdict_m.group(1).upper() == "BUG":
        return "bug_found", "bug", summary, findings
    return "passed", "pass", summary, findings


def _b64(png: bytes | None) -> str | None:
    return base64.b64encode(png).decode("ascii") if png else None


class _UsageTotal:
    def __init__(self) -> None:
        self.input = self.output = self.total = 0
        self.seen = False

    def add(self, u: ModelUsage | None) -> None:
        if u is None:
            return
        self.seen = True
        self.input += u.input_tokens or 0
        self.output += u.output_tokens or 0
        self.total += u.total_tokens or 0

    def model(self) -> Usage | None:
        if not self.seen:
            return None
        return Usage(input_tokens=self.input, output_tokens=self.output, total_tokens=self.total)


async def run_qa(
    *,
    scenario: Scenario,
    provider: ComputerUseProvider,
    run_page: RunPageLike,
    guards: Guards,
    run: QARunInfo,
    emit: Emit,
    model: str,
    keep_screenshots: int = 3,
    run_timeout_s: float = 120.0,
) -> QADoneEvent:
    started = time.monotonic()
    steps = 0
    usage = _UsageTotal()
    rid = run.run_id

    def finish(
        status: QARunStatus, verdict: QAVerdict, summary: str, findings: list[str] | None = None
    ) -> QADoneEvent:
        run.status = status
        done = QADoneEvent(
            run=run.model_copy(),
            verdict=verdict,
            summary=summary,
            findings=findings or [],
            steps=steps,
            duration_ms=int((time.monotonic() - started) * 1000),
            usage=usage.model(),
        )
        emit("done", done)
        logger.info("qa run %s finished: %s after %d steps", rid, status, steps)
        return done

    try:
        async with asyncio.timeout(run_timeout_s):
            await run_page.goto(scenario.start_url)
            url, png = await run_page.snapshot()
            emit(
                "step",
                QAStepEvent(
                    run_id=rid,
                    index=0,
                    kind="run_started",
                    url=url,
                    screenshot_png_b64=_b64(png),
                    note=scenario.title,
                    run=run.model_copy(),
                ),
            )
            session = provider.computer_use_session(
                system=SYSTEM_PROMPT,
                goal=scenario.goal,
                screenshot_png=png,
                url=url,
                model=model,
                keep_screenshots=keep_screenshots,
            )

            outcomes: list[ActionOutcome] = []
            while True:
                reply = await session.next(outcomes)
                usage.add(reply.usage)

                if guards.needs_confirmation(reply.safety):
                    explanation = str((reply.safety or {}).get("explanation", ""))[:500]
                    emit("interrupt", QAInterruptEvent(run_id=rid, explanation=explanation))
                    return finish(
                        "needs_confirmation",
                        "inconclusive",
                        "The agent stopped: the model asked for human confirmation.",
                    )

                if not reply.calls:
                    status, verdict, summary, findings = parse_report(reply.text)
                    return finish(status, verdict, summary, findings)

                outcomes = []
                for call in reply.calls:
                    if guards.step_limit_reached(steps):
                        return finish(
                            "inconclusive",
                            "inconclusive",
                            f"Step limit ({guards.max_steps}) reached before a verdict.",
                        )
                    steps += 1
                    check = guards.check_action(call)
                    if check.decision != "allow":
                        emit(
                            "step",
                            QAStepEvent(
                                run_id=rid,
                                index=steps,
                                kind="blocked",
                                action=call.name,
                                intent=call.intent,
                                args=call.args if check.decision == "block" else None,
                                url=url,
                                note=check.reason,
                            ),
                        )
                        if check.decision == "stop":
                            return finish("blocked", "inconclusive", check.reason or "Blocked.")
                        outcomes.append(
                            ActionOutcome(
                                call_id=call.id,
                                name=call.name,
                                url=url,
                                screenshot_png=None,
                                result={"error": "blocked_by_policy", "reason": check.reason},
                            )
                        )
                        continue

                    result = await run_page.execute(call)
                    url, png = await run_page.snapshot()
                    emit(
                        "step",
                        QAStepEvent(
                            run_id=rid,
                            index=steps,
                            kind="action",
                            action=call.name,
                            intent=call.intent,
                            args=call.args,
                            url=url,
                            screenshot_png_b64=_b64(png),
                            note=result.get("error"),
                        ),
                    )
                    outcomes.append(
                        ActionOutcome(
                            call_id=call.id,
                            name=call.name,
                            url=url,
                            screenshot_png=png,
                            result=result,
                        )
                    )
    except TimeoutError:
        return finish("inconclusive", "inconclusive", f"Run timed out after {run_timeout_s:.0f}s.")
    except asyncio.CancelledError:
        finish("stopped", "inconclusive", "Stopped.")
        raise
    except AppError as exc:
        emit("error", ErrorDetail(code=exc.code, message=exc.message))
        return finish("error", "inconclusive", exc.message)
