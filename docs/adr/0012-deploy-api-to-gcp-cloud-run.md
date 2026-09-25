# 0012. Deploy the API to GCP Cloud Run with Cloud SQL

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** VALT team

## Context

The FastAPI service (ADR 0003) needs a production home. It is a stateless container that streams
long SSE responses (ADR 0007), needs Postgres with pgvector (ADR 0011), and holds LLM and database
secrets. The team is small, so deploys must be one command locally and one click in CI, with no
servers or clusters to operate.

## Decision

We deploy `apps/api` to **Google Cloud Platform**:

| Concern | Service |
| --- | --- |
| Runtime | **Cloud Run** service `valt-api` (container from `apps/api/Dockerfile`) |
| Images | **Artifact Registry** (Docker repo in the deploy region) |
| Build | **Cloud Build** from a laptop (no local Docker needed); `docker build` in GitHub Actions |
| Database | **Cloud SQL for PostgreSQL 17** (pgvector available), connected via the Cloud Run Cloud SQL socket |
| Secrets | **Secret Manager** → injected as env vars (`API_DATABASE_URL`, `API_LLM_API_KEY`) |
| Migrations | **Cloud Run Job** `valt-api-migrate` running `alembic upgrade head` with the same image, before traffic shifts |
| CI/CD | **GitHub Actions** `deploy-api.yml` (manual "Run workflow" button + push to `main`), authenticated with **Workload Identity Federation** — no JSON keys |
| Identity | Separate service accounts: runtime (`cloudsql.client`, secret access), builder (push images), deployer (CI) |

Everything is scripted in `infra/gcp/`: `bootstrap.sh` (idempotent one-time setup) and `deploy.sh`
(build → migrate → deploy → smoke test). `pnpm gcp:deploy` runs both.

Cloud Run settings: request timeout 3600s (long SSE runs), concurrency 80, min instances 0 by
default (configurable), service **private by default** — `ALLOW_UNAUTHENTICATED=true` makes it
public once auth and rate limits exist.

## Alternatives considered

- **GKE** — full control, but a cluster to run and pay for with no current need.
- **App Engine Flexible** — slower deploys, less control over streaming and concurrency.
- **Compute Engine VM** — patching, scaling, and TLS become our job.
- **Terraform for all resources** — better for multi-env drift control; heavier to start. Revisit
  when we add a second environment (staging).
- **AlloyDB** — faster Postgres, much higher floor cost.

## Consequences

### Positive

- One command / one click from clean project to running API; re-runs are idempotent.
- Scales to zero; pay per request while traffic is low.
- No long-lived credentials in GitHub.

### Negative / risks

- Cloud SQL runs 24/7 and is the main fixed cost (smallest tier `db-f1-micro` for dev, no SLA).
- Cold starts with min instances 0 add latency to the first request; set `MIN_INSTANCES=1` in prod.
- Cloud Run caps a request at 60 minutes — longer agent runs need a background job (ADR 0003 note).
- A public service with LLM endpoints and no auth is an open bill: keep it private until auth and
  per-user rate limits ship.
- Bash scripts rather than IaC: fine for one environment, drifts with several.

### Follow-ups

- Choose hosting for `apps/web` (Cloud Run with the same pattern, or Vercel) and set
  `API_CORS_ORIGINS` / `API_INTERNAL_URL` accordingly.
- Staging environment + Terraform when a second environment is needed.
- Custom domain + HTTPS load balancer or Cloud Run domain mapping.
