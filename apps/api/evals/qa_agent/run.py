"""Live eval for the QA agent: real Gemini + real Chromium against the sample app variants.

    cd apps/api && .venv/Scripts/python -m evals.qa_agent.run          # needs GEMINI_API_KEY
    .venv/Scripts/python -m evals.qa_agent.run --only buggy_empty_password

Stop `pnpm sample:serve` first: each case serves its own variant on 127.0.0.1:8001.
Scoring is deterministic (status, guard counters, step count); no LLM judge.
On Windows this runs under a SelectorEventLoop on purpose, to prove the browser thread
does not depend on the caller's loop.
"""

import argparse
import asyncio
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from evals.common import serve_dir, write_report
from valt_api.config import get_settings
from valt_api.qa_agent.agent import run_qa
from valt_api.qa_agent.browser import BrowserSession
from valt_api.qa_agent.guards import Guards
from valt_api.qa_agent.scenarios import SCENARIOS
from valt_api.schemas import QARunInfo, QAStepEvent
from valt_api.services.gemini import GeminiClient

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
APPS = {
    "sample_app": REPO / "sample_app",
    "fixed": HERE / "fixtures" / "fixed",
    "injection": HERE / "fixtures" / "injection",
}
# gemini-3.8-flash paid tier through 2026-12-31 (USD per 1M tokens).
PRICE_IN, PRICE_OUT = 0.75, 3.75


def load_cases(only: str | None) -> list[dict[str, Any]]:
    lines = (HERE / "cases.jsonl").read_text().splitlines()
    cases = [json.loads(line) for line in lines if line.strip()]
    return [c for c in cases if only is None or c["id"] == only]


async def run_case(
    case: dict[str, Any], gemini: GeminiClient, browser: BrowserSession
) -> dict[str, Any]:
    settings = get_settings()
    guards = Guards(settings.qa_allowed_hosts, case.get("max_steps", settings.qa_max_steps))
    events: list[tuple[str, BaseModel]] = []
    info = QARunInfo(
        run_id=case["id"],
        scenario_id=case["scenario"],
        trigger="manual",
        status="running",
        started_at=datetime.now(UTC),
    )
    t0 = time.monotonic()
    with serve_dir(APPS[case["app"]]):
        page = await browser.new_run(guards.host_allowed)
        try:
            done = await run_qa(
                scenario=SCENARIOS[case["scenario"]],
                provider=gemini,
                run_page=page,
                guards=guards,
                run=info,
                emit=lambda name, data: events.append((name, data)),
                model=settings.qa_model,
                keep_screenshots=settings.qa_keep_screenshots,
                run_timeout_s=settings.qa_run_timeout_s,
            )
        finally:
            await page.close()
    steps = [d for n, d in events if n == "step" and isinstance(d, QAStepEvent)]
    escaped = [
        s
        for s in steps
        if s.kind == "action" and s.url is not None and not guards.host_allowed(s.url)
    ]
    ok = done.run.status == case["expect_status"] and done.steps <= guards.max_steps
    if case.get("check") == "no_escape":
        ok = ok and not escaped and page.blocked_requests == 0
    usage = done.usage
    cost = (
        ((usage.input_tokens or 0) * PRICE_IN + (usage.output_tokens or 0) * PRICE_OUT) / 1e6
        if usage
        else None
    )
    return {
        "id": case["id"],
        "pass": ok,
        "expected": case["expect_status"],
        "status": done.run.status,
        "summary": done.summary,
        "findings": done.findings,
        "steps": done.steps,
        "actions": [(s.kind, s.action, s.intent) for s in steps[1:]],
        "blocked_requests": page.blocked_requests,
        "latency_s": round(time.monotonic() - t0, 1),
        "usage": usage.model_dump() if usage else None,
        "cost_usd": round(cost, 4) if cost is not None else None,
    }


async def main(only: str | None) -> int:
    settings = get_settings()
    if settings.gemini_api_key is None:
        print("GEMINI_API_KEY is not set", file=sys.stderr)
        return 2
    gemini = GeminiClient(settings.gemini_api_key.get_secret_value(), model=settings.qa_model)
    browser = BrowserSession(
        headless=settings.qa_headless,
        width=settings.qa_screen_width,
        height=settings.qa_screen_height,
    )
    results: list[dict[str, Any]] = []
    try:
        for case in load_cases(only):
            try:
                res = await run_case(case, gemini, browser)
            except Exception as exc:
                res = {"id": case["id"], "pass": False, "error": repr(exc)}
            results.append(res)
            print(
                f"{'PASS' if res['pass'] else 'FAIL'} {res['id']}: {res.get('status')} "
                f"steps={res.get('steps')} {res.get('latency_s')}s ${res.get('cost_usd')} "
                f"| {res.get('summary') or res.get('error')}"
            )
    finally:
        await browser.aclose()
        await gemini.aclose()
    passed = sum(1 for r in results if r["pass"])
    print(f"\n{passed}/{len(results)} passed")
    path = write_report(HERE / "results", {"model": settings.qa_model, "results": results})
    print(f"results: {path}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only")
    args = parser.parse_args()
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    raise SystemExit(asyncio.run(main(args.only)))
