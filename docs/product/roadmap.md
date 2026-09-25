# VALT — Product Spec by Phase (1–10)

**Status:** sample roadmap · **Date:** 2026-09-25

> **Assumption.** VALT's product domain hasn't been defined in the repo yet. This spec assumes VALT
> is an **AI workspace assistant**: people chat with an assistant that remembers context, answers
> from their own documents with citations, takes actions with their approval, runs multi-agent
> research, and works in teams. Replace any phase's features with your real ones and keep the
> structure. Each phase is shippable on its own and builds on the previous ones.

## How to use this document

1. Pick the next phase. Its **Exit criteria** are the definition of done.
2. Turn it into a full PRD: `/prd phase-N-<name>`. The product-manager researches it, fills in the
   AI contract, and cuts scope.
3. Plan it with `/tech-plan phase-N-<name>`, then build it with `/execute phase-N-<name>`, or run all
   three with `/superpowers`.
4. Update the phase's **Status** here when it ships.

API shapes follow [`docs/api/conventions.md`](../api/conventions.md) (envelope: `success` / `data` /
`meta` / `error`). Architecture follows [`docs/adr/`](../adr/README.md).

## Overview

| Phase | Name | Outcome | Status |
| --- | --- | --- | --- |
| 1 | Foundation | Real database, standard API, CRUD reference feature, deployable | **Built** |
| 2 | Accounts & auth | Users sign up and sign in; data is private to its owner | Planned |
| 3 | AI chat | Streaming conversations with memory | Planned |
| 4 | Documents | Upload files; they're parsed, chunked, and embedded | Planned |
| 5 | Grounded answers (RAG) | Answers from your documents with citations | Planned |
| 6 | Tools & approvals | Assistant uses tools; risky actions need your OK | Planned |
| 7 | Research crews | Multi-agent reports that run in the background | Planned |
| 8 | Workspaces & teams | Shared workspaces, roles, invitations | Planned |
| 9 | Usage, limits & billing | Metering, quotas, rate limits, subscriptions | Planned |
| 10 | Production hardening & launch | Observability, evals in CI, admin, compliance, SLOs | Planned |

```
1 ─▶ 2 ─▶ 3 ─▶ 5 ─▶ 6 ─▶ 7
          │    ▲
          └▶ 4 ┘
     2 ─▶ 8 ─▶ 9 ─▶ 10
```

---

## Phase 1 — Foundation ✅ Built

**Goal:** the product has a real backbone: persistent data, one API style, working local dev,
and a deploy path.

**Delivered**
- Postgres via async SQLAlchemy 2.0 + psycopg 3, with Alembic migrations (ADR 0011).
- Standard response envelope, error codes, and request ids (ADR 0013, `docs/api/conventions.md`).
- Health (`/api/health`) and readiness (`/api/health/ready`, which checks the DB).
- **Items**, a reference CRUD feature that shows the pattern every later feature copies:
  model → migration → repository → schema → router → tests → shared TS type.
- GCP Cloud Run deploy (ADR 0012), with migrations run as a Cloud Run Job.

**API**

| Method | Path | Success | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | 200 `HealthResponse` | liveness, no dependencies |
| GET | `/api/health/ready` | 200 `ReadinessResponse` / 503 | DB reachable |
| GET | `/api/items?limit&cursor` | 200 `Item[]` + `meta` | newest first, keyset pagination |
| POST | `/api/items` | 201 `Item` | `{name, description?}` |
| GET | `/api/items/{id}` | 200 `Item` / 404 | |
| PATCH | `/api/items/{id}` | 200 `Item` / 404 | partial |
| DELETE | `/api/items/{id}` | 204 / 404 | |

```json
POST /api/items  {"name": "Quarterly plan"}
→ 201 {"success": true, "data": {"id": 1, "name": "Quarterly plan", "description": null,
       "created_at": "2026-09-25T09:12:03Z", "updated_at": "2026-09-25T09:12:03Z"}, "meta": null}
```

**Data:** `items(id bigint identity pk, name varchar(200) not null check non-blank, description
text, created_at, updated_at)`.

**Exit criteria (met):** migrations run up and down; DB tests pass against real Postgres; lint and
mypy strict are clean; web build passes with the new client.

---

## Phase 2 — Accounts & auth

**Goal:** people have accounts, and everything they create is private to them.

**User stories**
- As a visitor, I can sign up with email + password or Google, so that my work is saved to me.
- As a user, I can sign in, stay signed in across visits, and sign out.
- As a user, I only ever see my own items (and later threads and documents).
- As a user, I can reset a forgotten password.

**Decision needed (ADR 0014):** a managed identity provider (**recommended: Google Identity
Platform / Firebase Auth**, which is GCP-native and handles password reset, OAuth, and MFA; the API
verifies ID tokens) vs self-hosted auth (argon2 + JWT in FastAPI). Managed wins on security and
effort unless there's a hard requirement against it.

**API**

| Method | Path | Success |
| --- | --- | --- |
| GET | `/api/me` | 200 `User` |
| PATCH | `/api/me` | 200 `User` (display name, avatar) |
| DELETE | `/api/me` | 204 (account deletion, which cascades) |

All existing endpoints require `Authorization: Bearer <token>` and return `401 unauthorized`
without it. A resource owned by someone else returns `404 not_found`, never `403`, so that IDs
don't leak.

**Data:** `users(id uuid pk, auth_provider_id unique, email unique, display_name, created_at…)`;
add `owner_id → users.id` to `items`. Existing rows get a backfill owner, done as an
expand → backfill → NOT NULL migration.

**UI:** sign-in/up pages, account menu in the nav, protected routes.

**Owners:** database-engineer (users, owner_id), backend-engineer (auth dependency, `/me`),
frontend-engineer (auth screens), devops-engineer (identity provider config and secrets),
security-reviewer (pass before ship).

**Exit criteria:** every repository query filters by owner; a test proves user A can't read,
update, or delete user B's item; tokens are verified server-side; security-reviewer finds no
high-severity issues.

---

## Phase 3 — AI chat

**Goal:** a user can have streaming conversations with an assistant that remembers the thread.

**User stories**
- As a user, I can start a new chat, see the reply stream in word by word, and stop it.
- As a user, I can return to past chats (a list with titles) and continue them with context intact.
- As a user, I can rename or delete a chat.

**AI contract (fill in via `/prd`):**
- **Quality bar:** helpful, concise, and admits uncertainty. Seed 20+ eval cases.
- **Budgets:** time to first token ≤ 2s at p50; cost per message ≤ an agreed $ ceiling.
- **Failure behaviour:** provider down → inline error with retry, and the thread stays intact.

**Architecture:** LangGraph chat graph (ADR 0005) with the Postgres checkpointer on the same
database. Models come from `ai/llm.py` (ADR 0004), and responses stream over SSE (ADR 0007). Chat
titles are generated by a cheap model after the first exchange. This phase adds the `[ai]` extra to
the Docker image.

**API**

| Method | Path | Success |
| --- | --- | --- |
| GET | `/api/threads?limit&cursor` | 200 `Thread[]` + meta |
| POST | `/api/threads` | 201 `Thread` |
| GET | `/api/threads/{id}` | 200 `ThreadDetail` (messages) |
| PATCH | `/api/threads/{id}` | 200 `Thread` (title) |
| DELETE | `/api/threads/{id}` | 204 |
| POST | `/api/threads/{id}/runs` | 200 `text/event-stream`: `token`, `step`, `done`, `error` |

**Data:** `threads(id uuid pk, owner_id, title, created_at, updated_at, last_message_at)`.
Messages live in LangGraph checkpoints. Add a `messages` table only if search or analytics needs it.

**UI:** chat layout (sidebar thread list + conversation), streaming message, stop button, and a
composer per MASTER §7.

**Owners:** ai-engineer (graph, prompts, evals), database-engineer (threads + checkpointer
setup), backend-engineer (thread CRUD), frontend-engineer (`useRun`, chat UI), devops-engineer
(LLM secret, AI image).

**Exit criteria:** evals meet the launch threshold; streaming works through `/api/py`;
reloading shows full history; a stopped run leaves the thread consistent; rate limit of 10
runs/min per user.

---

## Phase 4 — Documents

**Goal:** users can upload their files, and VALT turns them into searchable knowledge.

**User stories**
- As a user, I can upload PDF, DOCX, Markdown, and TXT files (up to 25 MB each) and see processing
  status.
- As a user, I can list, rename, and delete my documents. Deleting also removes their embeddings.

**Architecture:** files go to **Cloud Storage** (signed upload URLs; the API never proxies large
bodies). Ingestion runs as a background job (Cloud Tasks → a Cloud Run endpoint, or a Run Job):
parse → chunk by structure → embed → `document_chunks` with **pgvector** (HNSW index). Status
moves through `uploaded → processing → ready | failed`.

**API**

| Method | Path | Success |
| --- | --- | --- |
| POST | `/api/documents` | 201 `{document, upload_url}` (signed URL) |
| POST | `/api/documents/{id}/complete` | 202 `Document` (starts ingestion) |
| GET | `/api/documents?limit&cursor` | 200 `Document[]` + meta |
| GET | `/api/documents/{id}` | 200 `Document` (status, pages, error) |
| DELETE | `/api/documents/{id}` | 204 |

**Data:** `documents(id uuid, owner_id, filename, mime, size_bytes, storage_path, status, error,
page_count, created_at…)`, `document_chunks(id, document_id fk cascade, ordinal, content,
embedding vector(N), token_count, metadata jsonb)`.

**Owners:** database-engineer (tables, pgvector migration), ai-engineer (chunking, embedding),
backend-engineer (upload flow, status), devops-engineer (bucket, CORS, Cloud Tasks),
frontend-engineer (upload UI with progress).

**Exit criteria:** a 100-page PDF reaches `ready` in ≤ 2 min; bad files fail with a clear reason;
delete removes the file, rows, and vectors; uploads are type- and size-checked server-side.

---

## Phase 5 — Grounded answers (RAG)

**Goal:** the assistant answers from the user's own documents and shows where each claim came from.

**User stories**
- As a user, when I ask about my documents, the answer cites the passages it used, and I can open them.
- As a user, I can limit a chat to specific documents.
- As a user, when the documents don't contain the answer, the assistant says so instead of guessing.

**AI contract:**
- **Quality bar:** answers must be supported by the retrieved text; cite ≥ 1 source per claim;
  "I don't know" when retrieval finds nothing.
- **Evals:** retrieval hit@5 ≥ 0.85 on the eval set, and a faithfulness pass rate ≥ the agreed
  threshold.
- **Injection:** text inside documents is treated as data. Instructions in documents never change
  tool use.

**Architecture:** retrieval is a LangChain tool in the chat graph (the graph decides when to
search), using hybrid search (vector + Postgres full-text) scoped to the owner's documents. Citations
are returned in `step` / `done` events.

**API:** `POST /api/threads/{id}/runs` accepts `document_ids?: uuid[]`. The `done` event includes
`citations: [{document_id, chunk_id, page, snippet}]`. `GET /api/documents/{id}/chunks/{chunk_id}`
returns the passage for the citation viewer.

**Owners:** ai-engineer (retrieval, prompts, evals), frontend-engineer (citation chips + viewer),
database-engineer (full-text index).

**Exit criteria:** eval thresholds are met and recorded; every answer about documents has
clickable citations; no cross-user retrieval (tested).

---

## Phase 6 — Tools & approvals

**Goal:** the assistant can *do* things, and nothing risky happens without the user's OK.

**User stories**
- As a user, the assistant can search the web for current information and cite it.
- As a user, before the assistant sends, creates, or changes anything outside VALT, I see exactly
  what it will do and approve or reject it.
- As a user, I can see a history of actions taken on my behalf.

**Architecture:** tool registry in `ai/tools/`, with read-only tools (web search, fetch URL with an
allow-list) and side-effect tools (e.g. draft and send an email, create a calendar event) that always
go through LangGraph `interrupt()` (ADR 0005). The UI shows the approval card (streaming reference),
and the run resumes with `Command(resume=…)`.

**API:** run stream gains `interrupt` events. `POST /api/threads/{id}/runs` with `{resume: "approve"
| "reject", edits?}` resumes. `GET /api/actions?limit&cursor` lists the audit log.

**Data:** `actions(id, owner_id, thread_id, tool, arguments jsonb, status
pending|approved|rejected|executed|failed, result jsonb, created_at, decided_at)`.

**Owners:** ai-engineer (tools, interrupts, evals for tool choice), backend-engineer
(integrations and OAuth tokens storage), security-reviewer (tool privilege and injection review, which
is mandatory), frontend-engineer (approval UI, action history).

**Exit criteria:** no side-effect tool runs without a recorded approval (tested); injected
instructions in web pages or docs can't trigger tools (adversarial eval cases pass); every action is
in the audit log.

---

## Phase 7 — Research crews

**Goal:** users can ask for a deep, multi-source report that several specialist agents produce
together, without waiting on screen.

**User stories**
- As a user, I can request a research report on a topic (optionally scoped to my documents), leave,
  and get notified when it's ready.
- As a user, I can watch progress (which agent is doing what) and cancel it.
- As a user, I can read the report with citations and export it as Markdown or PDF.

**Architecture:** a CrewAI crew (researcher → analyst → writer) runs as a node in a LangGraph graph
(ADR 0006). Runs longer than a request execute as background jobs (Cloud Run Jobs / Cloud Tasks,
per ADR 0003's note), with progress persisted and streamed to the UI by polling or SSE resume.

**API:** `POST /api/reports` → 202 `Report(status=queued)`; `GET /api/reports/{id}` returns
status, progress, and the result; `GET /api/reports?…`; `POST /api/reports/{id}/cancel`;
`GET /api/reports/{id}/export?format=md|pdf`.

**Data:** `reports(id uuid, owner_id, topic, scope jsonb, status, progress jsonb, result_md,
citations jsonb, cost_usd, started_at, finished_at)`.

**AI contract:** report quality rubric (coverage, accuracy, citation validity), a cost cap per
report enforced mid-run, and timeout behaviour.

**Owners:** ai-engineer (crew, evals, cost cap), backend-engineer (jobs, export),
devops-engineer (job infra), frontend-engineer (progress + report reader).

**Exit criteria:** reports finish within the time and cost caps on the eval topics; cancel stops
spending within 30 seconds; citations resolve.

---

## Phase 8 — Workspaces & teams

**Goal:** teams share documents, chats, and reports inside a workspace, with roles.

**User stories**
- As a user, I can create a workspace and invite teammates by email.
- As an owner/admin, I can set roles (owner, admin, member, viewer) and remove people.
- As a member, I can share a chat or document with the workspace or keep it private.

**Architecture:** tenancy moves from `owner_id` to `workspace_id` + `created_by`, with permission
checks in one authorization module (not scattered through routers). Every repository query is scoped
by workspace membership. Personal workspaces are created automatically, so Phase 2–7 data migrates
cleanly.

**API:** `/api/workspaces` (CRUD), `/api/workspaces/{id}/members` (list, invite, change role,
remove), `/api/invitations/{token}/accept`. Resources gain `?workspace_id=`, and responses include
`visibility`.

**Data:** `workspaces`, `workspace_members(workspace_id, user_id, role)`, `invitations(token hash,
email, role, expires_at)`, and `workspace_id` + `visibility` on items, threads, documents, and reports
(expand → backfill → contract).

**Owners:** database-engineer (tenancy migration, the riskiest step), backend-engineer (authz
module), frontend-engineer (workspace switcher, members UI), security-reviewer.

**Exit criteria:** an authorization test matrix (role × action × resource) passes; no query path
without workspace scoping (reviewed); RAG retrieval respects visibility.

---

## Phase 9 — Usage, limits & billing

**Goal:** VALT is sustainable: usage is measured, limits protect cost, and paid plans work.

**User stories**
- As a user, I can see my usage this month (messages, tokens, documents, reports) against my plan.
- As a user, I get a clear message (not an error page) when I hit a limit, with an upgrade path.
- As a workspace owner, I can subscribe, change plan, and manage billing in a customer portal.

**Architecture:** every LLM call records `usage_events` (model, tokens in/out, cost, feature,
workspace). Quotas are enforced before runs start, and per-user/per-IP rate limits apply to run
endpoints (`429 rate_limited` + `Retry-After`). Stripe handles Checkout, the Customer Portal, and
webhooks (signature-verified, idempotent).

**API:** `GET /api/usage?period=`, `GET /api/billing/plan`, `POST /api/billing/checkout` →
`{url}`, `POST /api/billing/portal` → `{url}`, `POST /api/webhooks/stripe`.

**Data:** `usage_events` (append-only, partitioned by month), `plans`,
`subscriptions(workspace_id, stripe_customer_id, stripe_subscription_id, plan, status, period_end)`.

**Owners:** backend-engineer (Stripe, quotas), ai-engineer (usage capture in the model factory),
database-engineer (partitioned events), frontend-engineer (usage page, upgrade prompts),
devops-engineer (webhook secret, alerts on cost spikes).

**Exit criteria:** usage totals match provider invoices within 2%; quotas block over-limit runs
before any LLM call; webhook replay is idempotent; a test-mode purchase flow works end to end.

---

## Phase 10 — Production hardening & launch

**Goal:** VALT is safe to put in front of paying customers at scale.

**Scope**
- **Observability:**
  - structured logs with request_id / thread_id
  - Cloud Monitoring dashboards for latency, error rate, LLM latency and cost, and queue depth
  - uptime checks and alert routing
- **SLOs:** API availability 99.9%; p95 non-AI latency < 300 ms; time to first token < 2.5s at p95.
  Every SLO has an alert and a runbook in `docs/runbooks/`.
- **Quality gates:** `ai-eval` suites run nightly and on PRs that touch prompts, models, or
  retrieval, and a regression blocks merge.
- **Environments:** a staging project mirrors production. Terraform replaces the bootstrap scripts
  (ADR 0012 follow-up). Blue/green traffic splits on Cloud Run.
- **Security & compliance:**
  - full security review and dependency audit in CI
  - data export and account deletion (GDPR/DPDP)
  - retention policies
  - a provider data-processing review, with audit logs for admin actions
- **Admin console:** look up users and workspaces, see usage, suspend abuse. Access is restricted
  and audited.
- **Performance:** load test at 10× expected traffic, then tune the DB pool, indexes, and Cloud Run
  concurrency and min instances.
- **Launch:** landing page, docs, status page, and support channel.

**Owners:** devops-engineer (lead), security-reviewer, qa-engineer (E2E suites on critical flows),
ai-engineer (eval CI), database-engineer (index and partition review), frontend-engineer (landing,
admin).

**Exit criteria:** all SLOs are measured and alerting; a restore from backup is tested; the load
test passes; the security review has no high or critical findings; runbooks exist for the top 10
alerts.

---

## Cross-cutting rules (all phases)

- Each phase starts with `/prd` and ends with the exit criteria verified, not just the code merged.
- New framework or infrastructure → ADR first (`/adr`).
- Schema change → migration + database-engineer review. API change → `/sync-contract`.
- AI feature → AI contract in the PRD + eval set + budget math in the plan.
- UI → `design-system/valt/MASTER.md` and its §9 checklist.
- Ship through `/ship`; deploy through `pnpm gcp:deploy` or the GitHub workflow.
