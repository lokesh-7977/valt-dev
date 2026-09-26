"""Shared eval plumbing: case loading, a metered model client, bounded concurrency, and
report printing/writing. Feature runners live in `evals/<feature>/run.py`.

Evals call the real model (key from Settings) and are never part of `pnpm test`.
"""

import asyncio
import functools
import http.server
import json
import math
import statistics
import sys
import threading
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, TypeVar

from valt_api.config import Settings
from valt_api.services.ai import (
    AIService,
    GenerationOptions,
    InputPart,
    JsonResult,
    ModelClient,
    TextResult,
    Usage,
)
from valt_api.services.gemini import GeminiClient
from valt_api.services.storage import LocalFileStorage

T = TypeVar("T")
R = TypeVar("R")

Case = dict[str, Any]


# ---- cases ----


def load_cases(path: Path) -> list[Case]:
    """One JSON object per line; blank lines and lines starting with // are skipped."""
    cases: list[Case] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        case = json.loads(stripped)
        if "id" not in case or "input" not in case:
            raise ValueError(f"{path.name}:{lineno}: case needs 'id' and 'input'")
        cases.append(case)
    ids = [c["id"] for c in cases]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        raise ValueError(f"{path.name}: duplicate case ids {dupes}")
    return cases


def select_cases(
    cases: list[Case], *, ids: Sequence[str] = (), tags: Sequence[str] = ()
) -> list[Case]:
    out = cases
    if ids:
        out = [c for c in out if c["id"] in ids]
    if tags:
        out = [c for c in out if set(tags) & set(c.get("tags", []))]
    return out


# ---- model client ----


@dataclass
class Meter:
    """Real calls and summed usage across every attempt (AIService retries once on bad JSON)."""

    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0

    def add(self, usage: Usage | None) -> None:
        self.calls += 1
        if usage is None:
            return
        self.input_tokens += usage.input_tokens or 0
        self.output_tokens += usage.output_tokens or 0
        self.total_tokens += usage.total_tokens or 0

    @property
    def thinking_tokens(self) -> int:
        # Gemini's candidates count excludes thoughts; total includes them.
        return max(0, self.total_tokens - self.input_tokens - self.output_tokens)


class MeteredClient:
    """ModelClient wrapper that counts calls and tokens. Build one per case."""

    def __init__(self, inner: ModelClient) -> None:
        self._inner = inner
        self.meter = Meter()

    @property
    def default_model(self) -> str:
        return self._inner.default_model

    async def generate_text(
        self, parts: Sequence[InputPart], options: GenerationOptions
    ) -> TextResult:
        try:
            res = await self._inner.generate_text(parts, options)
        except Exception:
            self.meter.add(None)
            raise
        self.meter.add(res.usage)
        return res

    async def generate_json(
        self, parts: Sequence[InputPart], options: GenerationOptions, json_schema: dict[str, Any]
    ) -> JsonResult:
        try:
            res = await self._inner.generate_json(parts, options, json_schema)
        except Exception:
            self.meter.add(None)
            raise
        self.meter.add(res.usage)
        return res

    def stream_text(
        self, parts: Sequence[InputPart], options: GenerationOptions
    ) -> AsyncIterator[str]:
        self.meter.add(None)
        return self._inner.stream_text(parts, options)

    async def aclose(self) -> None:  # the shared inner client is closed by the runner
        return None


@dataclass
class Runtime:
    settings: Settings
    client: GeminiClient
    storage: LocalFileStorage

    def service(self) -> tuple[AIService, Meter]:
        """A fresh AIService over a metered view of the shared client (mirrors deps.py)."""
        metered = MeteredClient(self.client)
        return AIService(metered, self.storage), metered.meter


def build_runtime() -> Runtime | None:
    """Builds the Gemini client exactly like main.py lifespan. None when no key is configured."""
    settings = Settings()
    if settings.gemini_api_key is None:
        return None
    client = GeminiClient(
        settings.gemini_api_key.get_secret_value(),
        model=settings.gemini_model,
        timeout_s=settings.gemini_timeout_s,
        max_retries=settings.gemini_max_retries,
    )
    return Runtime(settings, client, LocalFileStorage(settings.upload_dir))


async def run_bounded(
    items: Iterable[T], fn: Callable[[T], Awaitable[R]], concurrency: int
) -> list[R]:
    """Runs fn over items with at most `concurrency` in flight; preserves input order."""
    sem = asyncio.Semaphore(concurrency)

    async def guarded(item: T) -> R:
        async with sem:
            return await fn(item)

    return list(await asyncio.gather(*(guarded(i) for i in items)))


# ---- stats and reporting ----


def percentile(values: Sequence[float], pct: float) -> float | None:
    """Nearest-rank percentile (no interpolation), None for an empty list."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(pct / 100 * len(ordered)))
    return ordered[rank - 1]


def median(values: Sequence[float]) -> float | None:
    return statistics.median(values) if values else None


def mean(values: Sequence[float]) -> float | None:
    return statistics.fmean(values) if values else None


def rate(num: int, den: int) -> str:
    return f"{num}/{den} ({100 * num / den:.1f}%)" if den else "0/0 (n/a)"


@dataclass
class TagRow:
    tag: str
    n: int = 0
    passed: int = 0
    ids_failed: list[str] = field(default_factory=list)


def tag_table(scored: Sequence[dict[str, Any]], tag_order: Sequence[str] = ()) -> list[TagRow]:
    """Overall row first, then one row per tag (given order first, then alphabetical)."""
    overall = TagRow("overall")
    rows: dict[str, TagRow] = {}
    for s in scored:
        for row in [overall, *(rows.setdefault(t, TagRow(t)) for t in s.get("tags", []))]:
            row.n += 1
            if s["passed"]:
                row.passed += 1
            else:
                row.ids_failed.append(s["id"])
    ordered = [rows[t] for t in tag_order if t in rows]
    ordered += [rows[t] for t in sorted(rows) if t not in tag_order]
    return [overall, *ordered]


def format_tag_table(rows: Sequence[TagRow]) -> str:
    lines = [f"{'tag':<14}{'n':>4}{'pass':>6}{'rate':>9}", "-" * 33]
    for r in rows:
        pct = f"{100 * r.passed / r.n:.1f}%" if r.n else "n/a"
        lines.append(f"{r.tag:<14}{r.n:>4}{r.passed:>6}{pct:>9}")
    return "\n".join(lines)


def fmt_num(value: float | None, unit: str = "", digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}{unit}"


def write_report(results_dir: Path, payload: dict[str, Any]) -> Path:
    """Writes results/<local timestamp>.json (gitignored) and returns the path."""
    results_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S%z")
    path = results_dir / f"{stamp}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def utf8_stdout() -> None:
    """Windows consoles default to cp1252; case ids and values may contain non-ASCII text."""
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8", errors="replace")


# ---- static app server (browser evals) ----


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: Any) -> None:
        pass


@contextmanager
def serve_dir(directory: Path, host: str = "127.0.0.1", port: int = 8001) -> Iterator[str]:
    """Serve `directory` over HTTP on a background thread for the duration of the block."""
    handler = functools.partial(_QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer((host, port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://{host}:{port}/"
    finally:
        server.shutdown()
        server.server_close()
