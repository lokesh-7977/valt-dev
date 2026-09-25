---
name: gcp-deploy
description: Deploy or change the deployment of VALT's FastAPI service on GCP — Cloud Run, Cloud SQL Postgres, Artifact Registry, Secret Manager, Cloud Run migration job, and the GitHub Actions one-click workflow with Workload Identity Federation. Use when the user says deploy, release, push to GCP/Cloud Run, roll back, rotate a secret, add an env var or secret to production, or when infra/gcp/ or .github/workflows/deploy-api.yml needs to change.
---

# GCP Deploy

Decision: `docs/adr/0012-deploy-api-to-gcp-cloud-run.md`. Operator guide: `infra/gcp/README.md`.

```
infra/gcp/
  config.env.example   all knobs (copy to config.env — gitignored)
  lib.sh               config loading, naming, helpers
  bootstrap.sh         idempotent one-time setup (APIs, AR, SAs+IAM, Cloud SQL, secrets, WIF)
  deploy.sh            build → migrate job → deploy → smoke test → print rollback
  cloudbuild.yaml      Cloud Build config (user-managed builder SA)
.github/workflows/deploy-api.yml   test → deploy (workflow_dispatch + push to main)
apps/api/Dockerfile, .dockerignore, .gcloudignore
```

## Deploying

Deploying is outward-facing and costs money. Only do it when the user asked for a deploy in this
conversation, and confirm the project ID and region before the first run.

1. Check `infra/gcp/config.env` exists (else offer to create it from the example — ask for the
   project ID and region, don't guess).
2. `gcloud auth list` shows an active account. If not: tell the user to run `! gcloud auth login`.
3. Run `pnpm gcp:deploy` (or `SKIP_BOOTSTRAP=1 pnpm gcp:deploy` after the first time), in the
   background if long. Stream the output. Report the URL, image, smoke-test result, and the
   rollback command it printed.
4. On failure, quote the exact gcloud error, map it to "Failure recovery" below, and fix the script
   or config — never work around by hand-running ad hoc gcloud commands that the scripts don't know
   about (the next deploy would undo or conflict with them).

## Changing the deployment

- **New non-secret env var** → add to the env-vars file block in `deploy.sh`, to
  `config.env.example`, and (if CI sets it) to `deploy-api.yml` `env:` + a repo variable.
- **New secret** → create + IAM-bind in `bootstrap.sh` (same pattern as `LLM_KEY_SECRET`: value from
  an env var, piped via `--data-file=-`, never echoed), and append to `SECRETS` in `deploy.sh`.
- **New GCP API or role** → `bootstrap.sh`, least privilege, on the specific SA that needs it.
- **Runtime sizing** (CPU, memory, instances, timeout) → `config.env.example` + `lib.sh` defaults.
- Keep every step idempotent: `describe` before `create`, `add-iam-policy-binding` with
  `--condition=None`, `retry` for IAM propagation after creating a service account.
- Keep secrets out of logs, argv where avoidable, config files, and the repo.
- After editing scripts: `bash -n infra/gcp/*.sh`, and a stubbed dry run (put a fake `gcloud` that
  logs its args first on `PATH`) before any real run.

## Rules

- Service stays private (`ALLOW_UNAUTHENTICATED=false`) unless the user explicitly asks and auth +
  rate limits exist. Say why when they ask.
- Migrations run as the Cloud Run Job before the new revision takes traffic; a failed migration
  stops the deploy. Migrations must be backward-compatible with the running revision (see the
  `postgres-sqlalchemy` skill).
- Never delete Cloud SQL instances, databases, secrets, or revisions without explicit confirmation.
- CI deploys the commit SHA; don't deploy `-dirty` images to production from a laptop without saying so.

## Failure recovery

- **`PERMISSION_DENIED` on `builds submit`** → builder SA lacks a role or the caller lacks
  `iam.serviceAccountUser` on it; re-run bootstrap; check org policy on user-managed build SAs.
- **Cloud Run revision fails to start** → `gcloud run services logs read valt-api --region R`;
  usually a missing env var/secret, import error, or not listening on `$PORT`.
- **`connection refused`/`No such file` for `/cloudsql/...`** → `--set-cloudsql-instances` missing or
  wrong connection name, or runtime SA lacks `roles/cloudsql.client`.
- **Secret access denied at startup** → runtime SA not bound on that secret; re-run bootstrap.
- **Migration job fails** → `gcloud run jobs executions list --job valt-api-migrate`, then logs of the
  failed execution; fix the migration, redeploy.
- **Public access fails with org policy error** → Domain Restricted Sharing blocks `allUsers`; keep
  private and front with IAP/API Gateway, or get a policy exception.
- **GitHub deploy: `unauthorized_client` / `Permission 'iam.serviceAccounts.getAccessToken' denied`**
  → `GITHUB_REPO` in bootstrap doesn't match the repo, or the `workloadIdentityUser` binding is
  missing; re-run bootstrap with the right `GITHUB_REPO`.
- **SSE stream cut off** → request exceeded `REQUEST_TIMEOUT` (max 3600s); move long runs to a job.
