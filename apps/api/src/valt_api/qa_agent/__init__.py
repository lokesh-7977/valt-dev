"""Live QA agent (ADR 0015): Gemini Computer Use drives a sandboxed Playwright browser.

agent.py     the screenshot -> model action -> execute -> screenshot loop
executor.py  model actions -> Playwright calls
browser.py   Playwright on its own thread + event loop
guards.py    host allowlist, step cap, risky-action checks
scenarios.py predefined QA goals and the system prompt
manager.py   one run at a time, save-hook debounce, SSE fan-out
routes.py    /api/v1/qa/*
"""
