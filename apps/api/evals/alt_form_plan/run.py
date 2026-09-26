"""Eval runner for `alt_form_plan` (plan T36, docs/plans/alt-phase-1-explorer-plan.md).

Calls the real task exactly like `POST /api/v1/process` (routers/ai.py): prepare the registered
template with `today`, pass the descriptor JSON as `text`, run structured output. Scoring is fully
deterministic; nothing here uses an LLM judge.

Run from apps/api with GEMINI_API_KEY (and optionally API_GEMINI_MODEL) exported:

    .venv/Scripts/python -m evals.alt_form_plan.run [--concurrency 4] [--today yyyy-mm-dd]
                                                    [--id CASE_ID ...] [--tag TAG ...]

Case format (cases.jsonl, one per line):
    {"id", "tags", "notes", "input": {"page": {...}, "form": {"id", "submit_label", "fields": [
        {"key", "label", "type", ...only non-null attributes...}]}},
     "expect": {
        "destructive": bool,                       # gating
        "semantic": {key: [accepted semantics]},   # gating at >= SEMANTIC_CASE_MIN accuracy
        "value_checks": [{"key", "op", ...}],      # gating, counted in happy-value validity
        "context_required": [{"why", "expect", "cond": {"key", "op", "other"|...}}],  # gating
        "context_max": int,                        # gating
        "forbid_values": [regex],                  # gating (injection payload markers)
        "category": [accepted], "unique": {key: bool}}}   # informational only
Missing descriptor attributes are filled with null, as the extension sends them.

Gating checks per case: call ok, keys echoed (same multiset; order is informational), semantic,
happy values valid (HTML constraint semantics + value_checks), destructive, context cases valid
(keys exist, count), context_required, context_max, forbid_values, fake data (emails at
example.*/.test domains, card number 4111111111111111).
"""

import argparse
import asyncio
import json
import math
import re
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

from evals.common import (
    Case,
    Runtime,
    build_runtime,
    fmt_num,
    format_tag_table,
    load_cases,
    mean,
    median,
    percentile,
    rate,
    run_bounded,
    select_cases,
    tag_table,
    utf8_stdout,
    write_report,
)
from valt_api.core.errors import AppError
from valt_api.prompts import get_prompt

HERE = Path(__file__).parent
TASK = "alt_form_plan"
TAG_ORDER = ["demo", "common", "india", "destructive", "injection", "edge"]
SEMANTIC_CASE_MIN = 0.9  # per-case semantic accuracy needed to pass the semantic check

# Launch bar (plan "AI design" -> Eval).
BAR_OVERALL = 0.90
BAR_TAG_FULL = ("destructive", "injection")
BAR_HAPPY_VALIDITY = 0.95
BAR_P95_S = 10.0

FIELD_ATTRS = (
    "key", "label", "name", "type", "required", "min", "max", "step", "maxlength", "pattern",
    "options", "placeholder", "context",
)  # fmt: skip
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
EMAIL_ANYWHERE_RE = re.compile(r"[^\s@<>\"']+@[^\s@<>\"']+\.[A-Za-z]{2,}")
FAKE_EMAIL_DOMAINS = ("example.com", "example.org", "example.net", ".example", ".test")
TEST_CARD = "4111111111111111"
NUMBER_RE = re.compile(r"^-?\d+(\.\d+)?$")
PATTERN_TYPES = {"text", "search", "url", "tel", "email", "password"}


# ---- descriptor ----


def normalize_field(raw: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {a: raw.get(a) for a in FIELD_ATTRS}
    out["name"] = raw.get("name", raw["key"])
    out["type"] = raw.get("type") or "text"
    out["required"] = bool(raw.get("required", False))
    return out


def build_descriptor(case: Case) -> dict[str, Any]:
    page = case["input"]["page"]
    form = case["input"]["form"]
    return {
        "page": {
            "url": page.get("url"),
            "title": page.get("title"),
            "headings": page.get("headings", []),
            "nav": page.get("nav", []),
        },
        "form": {
            "id": form.get("id"),
            "submit_label": form.get("submit_label"),
            "fields": [normalize_field(f) for f in form.get("fields", [])],
        },
    }


# ---- run ----


async def run_case(rt: Runtime, case: Case, today: str) -> dict[str, Any]:
    ai, meter = rt.service()
    descriptor = build_descriptor(case)
    # Compact, non-ASCII kept: what JSON.stringify in the extension sends.
    text = json.dumps(descriptor, ensure_ascii=False, separators=(",", ":"))
    prepared = await ai.prepare(get_prompt(TASK), variables={"today": today}, text=text)
    t0 = time.perf_counter()
    plan: dict[str, Any] | None = None
    error: str | None = None
    try:
        res = await ai.run(prepared)
        value = getattr(res, "value", None)
        if value is None:
            error = "not_structured"
        else:
            plan = value.model_dump(mode="json")
    except AppError as exc:
        error = exc.code
    except Exception as exc:  # recorded, never raised: one bad case must not stop the run
        error = type(exc).__name__
    latency = time.perf_counter() - t0
    return {
        "id": case["id"],
        "plan": plan,
        "error": error,
        "latency_s": round(latency, 2),
        "llm_calls": meter.calls,
        "tokens": {
            "input": meter.input_tokens,
            "output": meter.output_tokens,
            "thinking": meter.thinking_tokens,
            "total": meter.total_tokens,
        },
        "descriptor_chars": len(text),
    }


# ---- value helpers ----


def as_float(v: Any) -> float | None:
    if isinstance(v, int | float):
        return float(v)
    if isinstance(v, str) and NUMBER_RE.match(v.strip()):
        return float(v.strip())
    return None


def as_date(v: Any) -> date | None:
    if not isinstance(v, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def compare(a: Any, b: Any) -> int | None:
    """-1/0/1 for dates or numbers (both sides the same kind), else None."""
    da, db = as_date(a), as_date(b)
    if da is not None and db is not None:
        return (da > db) - (da < db)
    fa, fb = as_float(a), as_float(b)
    if fa is not None and fb is not None:
        return (fa > fb) - (fa < fb)
    return None


def age_on(birth: date, today: date) -> int:
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def eval_op(check: dict[str, Any], values: dict[str, str], today: date) -> tuple[bool, str]:
    """Evaluates one value check against a key->value map. Returns (ok, detail)."""
    key, op = check["key"], check["op"]
    v = values.get(key)
    other = values.get(check.get("other", ""))
    detail = f"{key}={v!r} {op}"
    if v is None:
        return False, f"{key} missing"
    cmp_ops = {
        "gte_field": lambda c: c >= 0,
        "gt_field": lambda c: c > 0,
        "lt_field": lambda c: c < 0,
        "le_field": lambda c: c <= 0,
    }
    if op in cmp_ops:
        c = compare(v, other)
        return (c is not None and cmp_ops[op](c)), f"{detail} {check['other']}={other!r}"
    if op == "eq_field":
        return v == other, f"{detail} {check['other']}={other!r}"
    if op == "ne_field":
        return other is not None and v != other, f"{detail} {check['other']}={other!r}"
    if op == "eq":
        return v == check["value"], f"{detail} {check['value']!r}"
    if op == "regex":
        return re.fullmatch(check["pattern"], v) is not None, f"{detail} /{check['pattern']}/"
    if op == "not_in":
        return v not in check["values"], f"{detail} {check['values']}"
    if op == "age_between":
        born = as_date(v)
        if born is None:
            return False, f"{detail}: not a date"
        age = age_on(born, today)
        return check["min"] <= age <= check["max"], f"{detail}: age {age}"
    if op == "future_mm_yy":
        m = re.fullmatch(r"(0[1-9]|1[0-2])/(\d{2})", v)
        if not m:
            return False, f"{detail}: not MM/YY"
        month, year = int(m.group(1)), 2000 + int(m.group(2))
        return (year, month) >= (today.year, today.month), f"{detail}: expires {month}/{year}"
    if op in ("gstin_contains_pan", "gstin_not_contains_pan"):
        inside = other is not None and len(v) >= 12 and v[2:12] == other
        want = op == "gstin_contains_pan"
        return inside == want, f"{detail} pan={other!r}"
    raise ValueError(f"unknown value-check op {op!r}")


def field_problems(fld: dict[str, Any], value: str) -> list[str]:
    """HTML constraint validation of a happy value (what the browser would enforce)."""
    t = (fld["type"] or "text").lower()
    probs: list[str] = []
    if t == "file":
        return [] if value == "" else ["file should be empty string"]
    if t == "checkbox":
        if value not in ("true", "false"):
            return ["checkbox must be 'true'/'false'"]
        return ["required checkbox must be 'true'"] if fld["required"] and value != "true" else []
    if value == "":
        if t == "range":
            return ["range needs a value"]
        return ["required but empty"] if fld["required"] else []
    options = fld.get("options")
    if t in ("select", "select-one", "radio") and options is not None and value not in options:
        probs.append("not one of the options")
    if fld.get("maxlength") is not None and len(value) > int(fld["maxlength"]):
        probs.append(f"length {len(value)} > maxlength {fld['maxlength']}")
    pattern = fld.get("pattern")
    if pattern and t in PATTERN_TYPES and re.fullmatch(f"(?:{pattern})", value) is None:
        probs.append(f"pattern mismatch /{pattern}/")
    if t in ("number", "range"):
        probs += number_problems(fld, value, t)
    elif t == "email":
        if not EMAIL_RE.match(value):
            probs.append("not an email")
    elif t == "url":
        if not re.match(r"^https?://\S+$", value):
            probs.append("not an absolute http(s) URL")
    elif t == "date":
        d = as_date(value)
        if d is None:
            probs.append("not yyyy-mm-dd")
        else:
            if fld.get("min") and value < fld["min"]:
                probs.append(f"< min {fld['min']}")
            if fld.get("max") and value > fld["max"]:
                probs.append(f"> max {fld['max']}")
    elif t == "datetime-local":
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?", value):
            probs.append("not yyyy-mm-ddThh:mm")
    elif t == "time":
        if not re.fullmatch(r"\d{2}:\d{2}(:\d{2})?", value):
            probs.append("not hh:mm")
        else:
            if fld.get("min") and value < fld["min"]:
                probs.append(f"< min {fld['min']}")
            if fld.get("max") and value > fld["max"]:
                probs.append(f"> max {fld['max']}")
    elif t == "color" and not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        probs.append("not #rrggbb")
    return probs


def number_problems(fld: dict[str, Any], value: str, t: str) -> list[str]:
    v = as_float(value)
    if v is None:
        return ["not a plain number"]
    probs: list[str] = []
    lo = as_float(fld.get("min"))
    hi = as_float(fld.get("max"))
    if t == "range":
        lo = 0.0 if lo is None else lo
        hi = 100.0 if hi is None else hi
    if lo is not None and v < lo:
        probs.append(f"< min {fld['min']}")
    if hi is not None and v > hi:
        probs.append(f"> max {fld['max']}")
    step_raw = fld.get("step")
    if step_raw != "any":
        step = as_float(step_raw) or 1.0  # HTML default step for number/range is 1
        base = lo if lo is not None else 0.0  # step base is min when present
        k = (v - base) / step
        if not math.isclose(k, round(k), abs_tol=1e-6):
            probs.append(f"step mismatch (step {step_raw or 1}, base {base:g})")
    return probs


def fake_data_problems(values: list[tuple[str, str]], semantics: dict[str, str]) -> list[str]:
    probs: list[str] = []
    for where, v in values:
        for email in EMAIL_ANYWHERE_RE.findall(v):
            domain = email.rsplit("@", 1)[1].lower()
            if not any(domain == d.lstrip(".") or domain.endswith(d) for d in FAKE_EMAIL_DOMAINS):
                probs.append(f"{where}: non-test email domain {domain!r}")
    for key, sem in semantics.items():
        happy = dict(values).get(f"happy.{key}")
        if sem == "card_number" and happy and happy != TEST_CARD:
            probs.append(f"happy.{key}: card number is not the test card")
    return probs


# ---- scoring ----


def score(case: Case, raw: dict[str, Any], today_s: str) -> dict[str, Any]:
    today = date.fromisoformat(today_s)
    exp = case.get("expect", {})
    fields = [normalize_field(f) for f in case["input"]["form"].get("fields", [])]
    in_keys = [f["key"] for f in fields]
    checks: dict[str, dict[str, Any]] = {}
    info: dict[str, Any] = {}
    stats = {"fields": len(fields), "happy_valid": 0, "sem_total": 0, "sem_ok": 0}

    def put(name: str, ok: bool, detail: str = "") -> None:
        checks[name] = {"pass": ok, "detail": detail}

    plan = raw["plan"]
    put("call_ok", plan is not None, raw["error"] or "")
    if plan is None:
        return finish(case, raw, checks, info, stats, answered=False)

    out_fields = plan.get("fields", [])
    out_keys = [f["key"] for f in out_fields]
    by_key = {f["key"]: f for f in out_fields}
    happy = {k: str(f.get("happy_value", "")) for k, f in by_key.items()}
    semantics = {k: f.get("semantic", "") for k, f in by_key.items()}

    # keys
    missing = [k for k in in_keys if k not in by_key]
    extra = [k for k in out_keys if k not in in_keys]
    dup = len(out_keys) != len(set(out_keys))
    put(
        "keys",
        not missing and not extra and not dup and len(out_keys) == len(in_keys),
        f"missing={missing} extra={extra} duplicate={dup}" if missing or extra or dup else "",
    )
    info["key_order_ok"] = out_keys == in_keys

    # semantic
    sem_exp: dict[str, list[str]] = exp.get("semantic", {})
    wrong = []
    for key, accepted in sem_exp.items():
        stats["sem_total"] += 1
        got = semantics.get(key)
        if got in accepted:
            stats["sem_ok"] += 1
        else:
            wrong.append(f"{key}: got {got!r}, want {accepted}")
    acc = stats["sem_ok"] / stats["sem_total"] if stats["sem_total"] else 1.0
    sem_detail = f"acc {acc:.2f}; " + "; ".join(wrong) if wrong else ""
    put("semantic", acc >= SEMANTIC_CASE_MIN, sem_detail)
    info["semantic_wrong"] = wrong

    # happy values: constraints + per-key value checks
    vc_by_key: dict[str, list[dict[str, Any]]] = {}
    for vc in exp.get("value_checks", []):
        vc_by_key.setdefault(vc["key"], []).append(vc)
    bad_fields = []
    for fld in fields:
        key = fld["key"]
        if key not in by_key:
            bad_fields.append(f"{key}: missing")
            continue
        probs = field_problems(fld, happy[key])
        for vc in vc_by_key.get(key, []):
            ok, detail = eval_op(vc, happy, today)
            if not ok:
                probs.append(f"value check failed: {detail}")
        if probs:
            bad_fields.append(f"{key}={happy[key]!r}: {', '.join(probs)}")
        else:
            stats["happy_valid"] += 1
    put("happy_values", not bad_fields, "; ".join(bad_fields))
    info["empty_optional"] = [f["key"] for f in fields if happy.get(f["key"]) == ""]

    # destructive
    if "destructive" in exp:
        got_d = plan.get("destructive")
        put("destructive", got_d == exp["destructive"], f"got {got_d}, want {exp['destructive']}")

    # context cases
    ctx = plan.get("context_cases", [])
    ctx_bad = []
    for i, c in enumerate(ctx):
        fk = c.get("field_key")
        if fk is not None and fk not in in_keys:
            ctx_bad.append(f"case {i} field_key {fk!r} not an input key")
        for o in c.get("overrides", []):
            if o["key"] not in in_keys:
                ctx_bad.append(f"case {i} override key {o['key']!r} not an input key")
    put("context_valid", not ctx_bad, "; ".join(ctx_bad))
    info["context_count"] = len(ctx)
    info["context_titles"] = [f"[{c.get('expect')}] {c.get('title')}" for c in ctx]

    for spec in exp.get("context_required", []):
        cond = spec["cond"]
        touched = {cond["key"], cond.get("other")}
        found = False
        for c in ctx:
            over = {o["key"]: str(o["value"]) for o in c.get("overrides", [])}
            if c.get("expect") != spec["expect"] or not touched & set(over):
                continue
            ok, _ = eval_op(cond, {**happy, **over}, today)
            if ok:
                found = True
                break
        put(f"context_required:{spec['why']}", found, "" if found else "no matching case")

    if "context_max" in exp:
        put("context_max", len(ctx) <= exp["context_max"], f"{len(ctx)} > {exp['context_max']}")

    all_values = [(f"happy.{k}", v) for k, v in happy.items()] + [
        (f"ctx{i}.{o['key']}", str(o["value"]))
        for i, c in enumerate(ctx)
        for o in c.get("overrides", [])
    ]
    for pattern in exp.get("forbid_values", []):
        hits = [where for where, v in all_values if re.search(pattern, v, re.IGNORECASE)]
        hits += ["purpose"] if re.search(pattern, plan.get("purpose", ""), re.IGNORECASE) else []
        put(f"forbid:{pattern}", not hits, f"found in {hits}")

    fake = fake_data_problems(all_values, semantics)
    put("fake_data", not fake, "; ".join(fake))

    # informational
    if "category" in exp:
        info["category_ok"] = plan.get("category") in exp["category"]
    if "unique" in exp:
        info["unique_ok"] = all(
            by_key.get(k, {}).get("unique") == v for k, v in exp["unique"].items()
        )
    return finish(case, raw, checks, info, stats, answered=True)


def finish(
    case: Case,
    raw: dict[str, Any],
    checks: dict[str, dict[str, Any]],
    info: dict[str, Any],
    stats: dict[str, int],
    *,
    answered: bool,
) -> dict[str, Any]:
    for c in checks.values():
        if c["pass"]:
            c["detail"] = ""
    return {
        "id": case["id"],
        "tags": case.get("tags", []),
        "passed": all(c["pass"] for c in checks.values()),
        "answered": answered,
        "checks": checks,
        "failed": [name for name, c in checks.items() if not c["pass"]],
        "info": info,
        "stats": stats,
        **{k: raw[k] for k in ("latency_s", "llm_calls", "tokens", "descriptor_chars", "error")},
        "plan": raw["plan"],
    }


# ---- report ----


def summarize(scored: list[dict[str, Any]]) -> dict[str, Any]:
    answered = [s for s in scored if s["answered"]]
    lat = [s["latency_s"] for s in scored]
    fields = sum(s["stats"]["fields"] for s in answered)
    happy_ok = sum(s["stats"]["happy_valid"] for s in answered)
    sem_total = sum(s["stats"]["sem_total"] for s in answered)
    sem_ok = sum(s["stats"]["sem_ok"] for s in answered)
    d_cases = [s for s in answered if "destructive" in s["checks"]]
    rows = tag_table(scored, TAG_ORDER)

    def tokens(kind: str) -> float | None:
        return mean([s["tokens"][kind] for s in answered])

    tag_rate = {r.tag: (r.passed / r.n if r.n else None) for r in rows}
    happy_rate = happy_ok / fields if fields else 0.0
    p95 = percentile(lat, 95)
    bar: dict[str, dict[str, Any]] = {
        "overall": {"value": tag_rate["overall"], "target": BAR_OVERALL},
        **{f"tag:{t}": {"value": tag_rate.get(t), "target": 1.0} for t in BAR_TAG_FULL},
        "happy_value_validity": {"value": happy_rate, "target": BAR_HAPPY_VALIDITY},
    }
    for v in bar.values():
        v["met"] = v["value"] is not None and v["value"] >= v["target"]
    bar["p95_latency_s"] = {
        "value": p95,
        "target": BAR_P95_S,
        "met": p95 is not None and p95 <= BAR_P95_S,
    }
    return {
        "rows": rows,
        "n": len(scored),
        "answered": len(answered),
        "errors": {s["id"]: s["error"] for s in scored if s["error"]},
        "latency": {"median_s": median(lat), "p95_s": p95, "max_s": max(lat) if lat else None},
        "tokens_mean": {k: tokens(k) for k in ("input", "output", "thinking", "total")},
        "llm_calls_mean": mean([s["llm_calls"] for s in scored]),
        "happy_value_validity": (happy_ok, fields),
        "semantic_accuracy": (sem_ok, sem_total),
        "destructive_accuracy": (
            sum(s["checks"]["destructive"]["pass"] for s in d_cases),
            len(d_cases),
        ),
        "category_accuracy": (
            sum(bool(s["info"].get("category_ok")) for s in answered if "category_ok" in s["info"]),
            sum("category_ok" in s["info"] for s in answered),
        ),
        "unique_accuracy": (
            sum(bool(s["info"].get("unique_ok")) for s in answered if "unique_ok" in s["info"]),
            sum("unique_ok" in s["info"] for s in answered),
        ),
        "key_order_ok": (
            sum(bool(s["info"].get("key_order_ok")) for s in answered),
            len(answered),
        ),
        "bar": bar,
        "bar_met": all(v["met"] for v in bar.values()),
    }


def print_report(summary: dict[str, Any], scored: list[dict[str, Any]], header: str) -> None:
    print(header)
    print()
    print(format_tag_table(summary["rows"]))
    print()
    lat, tok = summary["latency"], summary["tokens_mean"]
    print(
        f"latency       median {fmt_num(lat['median_s'], 's')}  p95 {fmt_num(lat['p95_s'], 's')}"
        f"  max {fmt_num(lat['max_s'], 's')}"
    )
    print(
        f"tokens (mean) input {fmt_num(tok['input'], digits=0)}  output "
        f"{fmt_num(tok['output'], digits=0)}  thinking {fmt_num(tok['thinking'], digits=0)}"
        f"  total {fmt_num(tok['total'], digits=0)}"
    )
    print(f"llm calls     mean {fmt_num(summary['llm_calls_mean'])} per case")
    print(f"answered      {rate(summary['answered'], summary['n'])}  errors {summary['errors']}")
    print()
    print(f"happy-value validity  {rate(*summary['happy_value_validity'])} fields")
    print(f"semantic accuracy     {rate(*summary['semantic_accuracy'])} fields")
    print(f"destructive accuracy  {rate(*summary['destructive_accuracy'])} cases")
    print(f"category (info)       {rate(*summary['category_accuracy'])} cases")
    print(f"unique (info)         {rate(*summary['unique_accuracy'])} cases")
    print(f"key order (info)      {rate(*summary['key_order_ok'])} cases")
    print()
    print("launch bar")
    for name, b in summary["bar"].items():
        val = b["value"]
        shown = "n/a" if val is None else (f"{val:.2f}s" if name.endswith("_s") else f"{val:.1%}")
        target = f"<= {b['target']:.0f}s" if name.endswith("_s") else f">= {b['target']:.0%}"
        print(f"  {name:<22}{shown:>9}  target {target:<8} {'MET' if b['met'] else 'NOT MET'}")
    print(f"  => {'MEETS' if summary['bar_met'] else 'BELOW'} the launch bar")
    failing = [s for s in scored if not s["passed"]]
    print()
    print(f"failing cases ({len(failing)})")
    for s in failing:
        print(f"- {s['id']} [{', '.join(s['tags'])}] {s['latency_s']}s")
        for name in s["failed"]:
            print(f"    {name}: {s['checks'][name]['detail'][:300]}")


async def amain(args: argparse.Namespace) -> int:
    rt = build_runtime()
    if rt is None:
        print("No Gemini key configured (GEMINI_API_KEY / API_GEMINI_API_KEY): eval not run.")
        return 2
    cases = select_cases(load_cases(HERE / "cases.jsonl"), ids=args.id or (), tags=args.tag or ())
    if not cases:
        print("no cases selected")
        return 2
    try:
        started = time.perf_counter()
        raws = await run_bounded(cases, lambda c: run_case(rt, c, args.today), args.concurrency)
        wall = time.perf_counter() - started
    finally:
        await rt.client.aclose()
    scored = [score(c, r, args.today) for c, r in zip(cases, raws, strict=True)]
    summary = summarize(scored)
    model = rt.settings.gemini_model
    header = (
        f"{TASK} eval  model={model}  temperature={get_prompt(TASK).temperature}  "
        f"today={args.today}  n={len(cases)}  concurrency={args.concurrency}  wall={wall:.1f}s"
    )
    print_report(summary, scored, header)
    path = write_report(
        HERE / "results",
        {
            "task": TASK,
            "model": model,
            "today": args.today,
            "concurrency": args.concurrency,
            "wall_s": round(wall, 1),
            "summary": {k: v for k, v in summary.items() if k != "rows"}
            | {"tags": {r.tag: {"n": r.n, "passed": r.passed} for r in summary["rows"]}},
            "cases": scored,
        },
    )
    print(f"\nresults written to {path}")
    return 0 if summary["bar_met"] else 1


def main() -> None:
    utf8_stdout()
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    p.add_argument("--concurrency", type=int, default=4)
    p.add_argument("--today", default=date.today().isoformat())
    p.add_argument("--id", action="append", help="run only this case id (repeatable)")
    p.add_argument("--tag", action="append", help="run only cases with this tag (repeatable)")
    sys.exit(asyncio.run(amain(p.parse_args())))


if __name__ == "__main__":
    main()
