---
name: ai-eval
description: Create or run an evaluation set for an AI feature in apps/api (LLM call, LangGraph workflow, CrewAI crew, or RAG) and report scores before/after a prompt, model, retrieval, or graph change. Use when the user says eval, evaluate, benchmark the agent, compare prompts/models, check answer quality, or before changing a prompt or model in production code.
---

# AI Eval

Quality of AI output is measured, not eyeballed. Evals live next to the API, run against real models,
and are **never** part of `pnpm test` (cost, flakiness, keys).

## Layout

```
apps/api/evals/
  common.py                 scoring helpers, runner, report printing
  <feature>/
    cases.jsonl             one case per line
    run.py                  calls the real feature, scores each case
    results/                gitignored; timestamped JSON outputs
```

Add `apps/api/evals/**/results/` to `.gitignore`.

## Case format (`cases.jsonl`)

```json
{"id": "refund-01", "input": {"message": "I was charged twice"}, "expect": {"category": "billing"}, "tags": ["billing", "easy"]}
{"id": "rag-07", "input": {"message": "What is the upload limit?"}, "expect": {"contains": ["25 MB"], "sources": ["docs/limits.md"]}, "rubric": "Answer states the limit and cites the limits doc.", "tags": ["rag"]}
```

- 20–50 cases to start; include easy, hard, adversarial (prompt injection in the input or in a
  retrieved doc), and out-of-scope cases (expected: refuses / says it doesn't know).
- Cases come from real usage when possible. Never put secrets or real user PII in cases.

## Scoring — cheapest reliable method first

1. **Exact / schema match** for structured output (`with_structured_output`, crew `output_pydantic`).
2. **Deterministic checks**: `contains`, regex, cited `sources` ⊆ retrieved sources, tool called /
   not called, step count ≤ N.
3. **Retrieval metrics** for RAG, scored separately: hit@k (expected source in top-k).
4. **LLM-as-judge** only for open-ended text: a fixed rubric, a pass/fail (or 1–5) output via
   structured output, temperature 0, and a different model from the one under test when possible.
   Spot-check ~10% of judge verdicts by hand the first time.

Also record per case: latency, input/output tokens, number of LLM calls.

## Runner shape (`run.py`)

```python
import asyncio, json, time
from pathlib import Path

from langgraph.checkpoint.memory import InMemorySaver
from valt_api.ai.graphs.chat import build_graph
from evals.common import load_cases, score, write_report

HERE = Path(__file__).parent


async def run_case(graph, case):
    config = {"configurable": {"thread_id": f"eval-{case['id']}"}, "recursion_limit": 25}
    t0 = time.perf_counter()
    out = await graph.ainvoke({"messages": [("human", case["input"]["message"])]}, config)
    return {"id": case["id"], "output": out["messages"][-1].content,
            "latency_s": round(time.perf_counter() - t0, 2)}


async def main() -> None:
    graph = build_graph(InMemorySaver())   # real model from settings
    cases = load_cases(HERE / "cases.jsonl")
    sem = asyncio.Semaphore(4)              # respect provider rate limits
    async def guarded(c):
        async with sem:
            return await run_case(graph, c)
    results = await asyncio.gather(*(guarded(c) for c in cases))
    write_report(HERE / "results", [score(c, r) for c, r in zip(cases, results)])

if __name__ == "__main__":
    asyncio.run(main())
```

Run from `apps/api` with the venv active and `API_LLM_*` set:
`python -m evals.<feature>.run`

## Procedure

1. **New feature** → create the folder, 20+ cases, runner, and a baseline run. Commit cases and
   runner (not results).
2. **Change to prompt / model / retrieval / graph** → run baseline on `main` code (or the stored
   baseline), make the change, run again, compare.
3. **Report** a table: overall pass rate, per-tag pass rate, median/p95 latency, mean tokens and
   LLM calls per case — before vs after — plus the cases that flipped (pass→fail first).
4. A change that lowers pass rate on any tag, or raises cost/latency >20%, needs an explicit
   justification in the report.

## Rules

- Say which model and settings were used, and the number of cases. No score without a denominator.
- If no API key is configured, stop and say so — don't substitute fake-model results for an eval.
- Keep judge rubrics in the case file or runner, versioned with the code.
