# Deploy the API to GCP (Cloud Run + Cloud SQL)

Decision and trade-offs: [ADR 0012](../../docs/adr/0012-deploy-api-to-gcp-cloud-run.md).

```
GitHub "Run workflow" ─┐                         ┌─ Secret Manager (DB URL, LLM key)
pnpm gcp:deploy ───────┴─▶ build image ─▶ Artifact Registry
                                   │
                                   ├─▶ Cloud Run Job  valt-api-migrate  (alembic upgrade head)
                                   └─▶ Cloud Run      valt-api  ──unix socket──▶ Cloud SQL Postgres 17
```

## One-time prerequisites

1. A GCP project with billing enabled, and the `gcloud` CLI installed.
2. `gcloud auth login` as a project Owner (bootstrap creates IAM, SQL, and secrets).
3. `bash` on your PATH (Git Bash on Windows) and `openssl` (ships with Git Bash).

## First deploy: one command

```bash
cp infra/gcp/config.env.example infra/gcp/config.env   # set GCP_PROJECT_ID, GCP_REGION, LLM_*
export LLM_API_KEY=...                                 # optional; stored in Secret Manager
pnpm gcp:deploy
```

`gcp:deploy` runs `bootstrap.sh` (idempotent: APIs, Artifact Registry, service accounts, Cloud SQL
instance + DB + user, secrets, GitHub WIF), then builds with Cloud Build (no local Docker needed),
runs migrations when `apps/api/alembic.ini` exists, deploys, and hits `/api/health`.
The first run takes ~15 minutes (Cloud SQL creation). Later runs take ~3 minutes.

## After that: one click

Bootstrap prints the GitHub secrets and variables to set (`GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`,
`GCP_PROJECT_ID`, `GCP_REGION`, …). Once they're set:

- **GitHub → Actions → "Deploy API (GCP Cloud Run)" → Run workflow**, or
- push to `main` touching `apps/api/**` or `infra/gcp/**`.

The workflow runs ruff, mypy, and pytest, then deploys the exact commit (`IMAGE_TAG = git sha`).
Authentication uses Workload Identity Federation, so there are no JSON keys. Until
`GCP_PROJECT_ID` is set as a repo variable, the deploy job is skipped.

## Everyday commands

| Task | Command |
| --- | --- |
| Deploy from laptop | `pnpm gcp:deploy` |
| Deploy, skipping setup checks | `SKIP_BOOTSTRAP=1 pnpm gcp:deploy` |
| Rotate LLM key | `LLM_API_KEY=... pnpm gcp:bootstrap` then deploy |
| Logs | `gcloud run services logs tail valt-api --region <region>` |
| Roll back | printed at the end of every deploy (`update-traffic --to-revisions <prev>=100`) |
| Call a private service | `curl -H "Authorization: Bearer $(gcloud auth print-identity-token)" <url>/api/health` |
| Connect to the DB | `gcloud sql connect valt-pg --user=valt --database=valt` (password: in secret `valt-api-database-url`) |

## Configuration

All values are in `config.env.example`. Also:

- **Private by default.** `ALLOW_UNAUTHENTICATED=false` requires IAM to call the service. Set it to
  `true` only once auth and per-user rate limits exist. Otherwise LLM endpoints are an open bill.
  Some organizations block public services by policy.
- **Streaming:** request timeout 3600s. Cloud Run streams SSE without extra config.
- **Cost:** Cloud SQL is always on. `db-f1-micro` is the cheapest option but has no SLA. For
  production, use a dedicated-core tier, `MIN_INSTANCES=1`, and consider `--availability-type=regional`.
- **pgvector:** enable it from a migration (`CREATE EXTENSION IF NOT EXISTS vector`). The app user
  has `cloudsqlsuperuser`, which allows this.

## Not covered yet

- Hosting `apps/web`. When it's decided, set `CORS_ORIGINS` to its origin and point
  `API_INTERNAL_URL` at the Cloud Run URL.
- Custom domain, staging environment, and Terraform (see ADR 0012 follow-ups).
- Tearing down. The instance has deletion protection. Delete it deliberately with
  `gcloud sql instances patch valt-pg --no-deletion-protection` and then `delete`.
