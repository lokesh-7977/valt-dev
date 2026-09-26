# AI backend playbook (hackathon)

This is a generic Gemini backend. When the problem statement arrives, add domain logic to it.
Don't restructure it. Decision: [ADR 0014](../adr/0014-gemini-direct-behind-ai-service.md).

## Run it

```bash
cd apps/api
cp .env.example .env                  # set GEMINI_API_KEY (https://aistudio.google.com/apikey)
pnpm install:deps                     # or: python -m venv .venv && pip install -e ".[dev]"
pnpm dev                              # http://localhost:8000/docs
GEMINI_API_KEY=... pytest tests/test_gemini.py -k live   # 10-second check that the key works
```

Docker: `docker compose up api postgres`. Compose reads `GEMINI_API_KEY` from your shell or a root
`.env`. The database is optional. Without `API_DATABASE_URL`, only the `/items` and
`/health/ready` endpoints return 503.

## Flow

```
Client ─► FastAPI router (Pydantic validation)
          │  routers/ai.py, routers/files.py, your routers/<domain>.py
          ▼
       AIService (services/ai)  ── prompts/ (PromptTemplate + output model)
          │                     ── services/storage (uploaded files → Media parts)
          ▼
       ModelClient protocol ─► GeminiClient (services/gemini, the only SDK import)
          ▼
   {success, data} envelope  or  SSE token/done/error
```

| Path | What lives there |
| --- | --- |
| `config.py` | Every setting, read from env (`API_*`, plus `GEMINI_API_KEY`) |
| `core/` | error envelope + error codes, logging (request id on every line), SSE helpers |
| `deps.py` | `AIServiceDep`, `StorageDep`, `SettingsDep` for routers |
| `services/gemini/` | SDK calls, multimodal parts, maps SDK errors to `ai_*` codes |
| `services/ai/` | `AIService`: `text`, `structured`, `json`, `stream`, `prepare`, `run` |
| `services/storage/` | `FileStorage` protocol + local disk implementation |
| `db/` | SQLAlchemy models, repositories, sessions (the "database service") |
| `prompts/` | Task registry. `library.py` has the generic tasks |
| `routers/` | HTTP only. All mounted under `/api/v1` in `main.py` |

## Endpoints (`/api/v1`)

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | none | `{status, service, version, ai}` |
| POST | `/upload` | multipart `file` (image/audio/PDF/text/video, ≤20 MB) | `{id, filename, content_type, size_bytes}` |
| POST | `/analyze` | `{text?, file_ids?, instructions?, output_schema?}` | `{result, model, usage}`: structured JSON |
| POST | `/generate` | `{prompt \| template, variables?, text?, file_ids?, system?, temperature?}` | `{text, model, usage}` |
| POST | `/generate/stream` | same as `/generate` | SSE `token*` then `done` or `error` |
| POST | `/process` | `{task, variables?, text?, file_ids?}` | `{task, output, model, usage}` |
| GET | `/tasks` | none | registered tasks + variables + output schema |

```bash
ID=$(curl -s -F "file=@receipt.jpg" localhost:8000/api/v1/upload | jq -r .data.id)
curl -s localhost:8000/api/v1/analyze -H 'content-type: application/json' \
  -d "{\"file_ids\":[\"$ID\"],\"instructions\":\"focus on totals\"}"
curl -s localhost:8000/api/v1/process -H 'content-type: application/json' \
  -d "{\"task\":\"extract\",\"file_ids\":[\"$ID\"],\"variables\":{\"fields\":\"merchant, date, total\"}}"
curl -N localhost:8000/api/v1/generate/stream -H 'content-type: application/json' -d '{"prompt":"Hi"}'
```

Frontend: `apps/web/src/lib/api.ts` has `uploadFile`, `analyze`, `processTask`, `generate`,
`generateStream` (an async generator over SSE events), and `listTasks`. Types are in
`@valt/shared`.

## When the problem statement arrives

**Level 1: prompt only (about 10 min).** Add a task and the frontend calls `/process`.

```python
# prompts/domain.py  (then add `from valt_api.prompts import domain` in prompts/__init__.py)
class Triage(BaseModel):
    severity: Literal["low", "medium", "high"]
    actions: list[str] = Field(description="Concrete next steps, max 5")

register(PromptTemplate(
    name="triage",
    description="Triage an incident report + photos.",
    system="You are an incident triage expert. ...",
    instruction="Triage this report for a {audience} audience.",
    output_model=Triage,
    defaults={"audience": "field technician"},
))
```

**Level 2: a domain endpoint (about 30 min).** Use this when you need custom request fields,
persistence, or several model calls.

```python
# routers/triage.py  (then v1.include_router(triage.router) in main.py)
router = APIRouter(prefix="/triage", tags=["triage"], responses=AI_ERROR_RESPONSES)

@router.post("", response_model=ApiResponse[Triage])
async def triage(payload: TriageRequest, ai: AIServiceDep) -> ApiResponse[Triage]:
    prepared = await ai.prepare(get_prompt("triage"), text=payload.report, file_ids=payload.photo_ids)
    out = await ai.structured(prepared.parts, Triage, prepared.options)
    return ok(out.value)
```

Add request and response models to `schemas.py` and mirror them in
`packages/shared/src/index.ts` (`/sync-contract`).

**Level 3: persistence.** Add a model in `db/models/`, a repository, and run
`pnpm db:revision "add x"`. `routers/items.py` is the pattern to copy.

**RAG, tools, multi-step.** Use the `ai` extra (LangGraph/LangChain). Graph nodes call `AIService`.

## ALT: alt_form_plan task

Code: `prompts/alt_explorer.py`. The ALT Chrome extension discovers forms itself. It calls
Gemini only to add meaning: semantic field types, realistic happy-path values, and a few
business-context cases that its heuristics can't derive. That is one Flash call per form, and the
extension caches the result, for example by page URL, form id, and field keys.

```bash
curl -s localhost:8000/api/v1/process -H 'content-type: application/json' -d '{
  "task": "alt_form_plan", "variables": {"today": "2026-09-26"},
  "text": "{\"page\":{\"url\":\"...\",\"title\":\"...\",\"headings\":[],\"nav\":[]},\"form\":{...}}"}'
```

**Input.** `variables.today` (`yyyy-mm-dd`, required; a missing value returns 422
`missing_variables`). `text` is the form descriptor as a JSON string:

```json
{"page": {"url": "...", "title": "...", "headings": ["..."], "nav": ["Dashboard", "Invoices"]},
 "form": {"id": "invoice-form", "submit_label": "Save invoice", "fields": [
   {"key": "quantity", "label": "Quantity", "name": "quantity", "type": "number", "required": true,
    "min": "1", "max": "1000", "step": "1", "maxlength": null, "pattern": null,
    "options": null, "placeholder": null, "context": "nearby text"}]}}
```

The descriptor is untrusted page content. It reaches the model only inside `<user_input>` tags,
and the system prompt treats it as data.

**Output** (`data.output`, a `FormPlan`):

| Field | Shape |
| --- | --- |
| `purpose`, `category` | e.g. `"Create invoice"`, `create \| edit \| search \| filter \| login \| signup \| settings \| payment \| contact \| invite \| other` |
| `destructive` | `true` if submitting deletes data, moves money, sends messages, or is irreversible |
| `fields[]` | `{key, semantic, happy_value, unique}`: one per input field, keys echoed |
| `context_cases[]` | 0–5 × `{title, rationale, expect: accept\|reject, field_key \| null, overrides: [{key, value}]}` |

`semantic` is a fixed enum (`email`, `phone`, `date`, `currency_amount`, `gstin`, `pan`, `ifsc`,
`select_entity`, ..., `unknown`). All values are strings. Dates are `yyyy-mm-dd`, checkboxes are
`"true"`/`"false"`, and select values are always one of the given options. Data is fake: `example.com`
or `acme.test` emails, and the test card `4111111111111111`. Indian formats (GSTIN, PAN, IFSC, +91,
PIN) are used when the page suggests INR or GST.

**How the extension uses it.** Merge by `key`, not by position. Any field the model omits or marks
`unknown` keeps the heuristic value. Build a context case as happy values + `overrides`. Treat
`destructive: true` as "don't auto-submit without approval". `unique: true` means the extension
should add a run suffix before reusing the value. Errors use the normal envelope. On
`ai_rate_limited`, `ai_timeout`, or `ai_invalid_output`, fall back to heuristics only.

Measured on 2026-09-26 with `gemini-3.8-flash` and an 8-field invoice form: about 1.4k input
tokens, 0.6–0.8k output tokens, and 0.4–1k thinking tokens, at 4.8–6.2 s end to end. The same
prompt with `thinking_level=LOW` took 3.3–3.6 s. `GenerationOptions` can't set that yet, and
`MINIMAL` is rejected by this model.

## Demo-stability checklist

- `GET /api/v1/health` shows `"ai": "configured"`. Run the live smoke test with the demo key.
- Pin `API_GEMINI_MODEL` to the model you tested with.
- Cloud Run: uploads live on local disk per instance. Deploy with `--max-instances=1` for the
  demo, or add a GCS `FileStorage`.
- Every failure comes back as `{success:false, error:{code, message, request_id}}`. The UI should
  show `message` and branch on `code`: `ai_rate_limited` → retry button, `ai_blocked` →
  "try different input".
- Logs: to debug a failure, search for its `request_id`. Production logs are JSON (`API_LOG_JSON=true`).
- Structured outputs retry once when the model's JSON doesn't fit the schema. Keep output models
  small, and write field `description`s, which steer the model.
