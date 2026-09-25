#!/usr/bin/env bash
# One-time (idempotent) GCP setup for the VALT API. Safe to re-run: every step checks first.
#
#   bash infra/gcp/bootstrap.sh            # or: pnpm gcp:bootstrap
#
# Creates: APIs, Artifact Registry repo, service accounts + IAM, Cloud SQL Postgres instance,
# database, user, Secret Manager secrets, and (optionally) GitHub Workload Identity Federation.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_config
require_gcloud

PROJECT_NUMBER="$(gc projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"

# ---------------------------------------------------------------------------
log "Enabling APIs"
gc services enable \
  run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com
ok "APIs enabled"

# ---------------------------------------------------------------------------
log "Artifact Registry"
if quiet gc artifacts repositories describe "$AR_REPO" --location "$GCP_REGION"; then
  ok "repo $AR_REPO exists"
else
  gc artifacts repositories create "$AR_REPO" --repository-format=docker \
    --location "$GCP_REGION" --description "VALT container images"
  ok "created repo $AR_REPO"
fi

# ---------------------------------------------------------------------------
log "Service accounts"
ensure_sa() {
  local email="$1" name="${1%%@*}" display="$2"
  if quiet gc iam service-accounts describe "$email"; then
    ok "$name exists"
  else
    gc iam service-accounts create "$name" --display-name "$display"
    ok "created $name"
  fi
}
ensure_sa "$RUNTIME_SA_EMAIL" "VALT API runtime"
ensure_sa "$BUILDER_SA_EMAIL" "VALT API image builder"

bind_project() {
  retry quiet gc projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member "serviceAccount:$1" --role "$2" --condition=None \
    || die "could not grant $2 to $1"
}
bind_project "$RUNTIME_SA_EMAIL" roles/cloudsql.client
bind_project "$BUILDER_SA_EMAIL" roles/artifactregistry.writer
bind_project "$BUILDER_SA_EMAIL" roles/logging.logWriter
bind_project "$BUILDER_SA_EMAIL" roles/storage.objectViewer
ok "IAM roles granted"

# ---------------------------------------------------------------------------
log "Cloud SQL (PostgreSQL 17) — first creation takes ~10 minutes"
if quiet gc sql instances describe "$SQL_INSTANCE"; then
  ok "instance $SQL_INSTANCE exists"
else
  gc sql instances create "$SQL_INSTANCE" \
    --database-version=POSTGRES_17 --edition="$SQL_EDITION" --tier="$SQL_TIER" \
    --region="$GCP_REGION" --storage-auto-increase --backup-start-time=03:00 \
    --deletion-protection
  ok "created instance $SQL_INSTANCE"
fi

if quiet gc sql databases describe "$DB_NAME" --instance "$SQL_INSTANCE"; then
  ok "database $DB_NAME exists"
else
  gc sql databases create "$DB_NAME" --instance "$SQL_INSTANCE"
  ok "created database $DB_NAME"
fi

# The DB password only ever lives in Secret Manager (inside the connection URL).
if secret_exists "$DB_URL_SECRET" && secret_has_version "$DB_URL_SECRET"; then
  ok "secret $DB_URL_SECRET exists (DB user password unchanged)"
else
  DB_PASSWORD="$(openssl rand -hex 24)"
  if [[ -n "$(gc sql users list --instance "$SQL_INSTANCE" --filter="name=$DB_USER" --format='value(name)')" ]]; then
    gc sql users set-password "$DB_USER" --instance "$SQL_INSTANCE" --password "$DB_PASSWORD"
  else
    gc sql users create "$DB_USER" --instance "$SQL_INSTANCE" --password "$DB_PASSWORD"
  fi
  DB_URL="postgresql+psycopg://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${SQL_CONNECTION}"
  secret_exists "$DB_URL_SECRET" || gc secrets create "$DB_URL_SECRET" --replication-policy=automatic
  printf '%s' "$DB_URL" | gc secrets versions add "$DB_URL_SECRET" --data-file=-
  unset DB_PASSWORD DB_URL
  ok "DB user $DB_USER ready; URL stored in secret $DB_URL_SECRET"
fi

# ---------------------------------------------------------------------------
log "LLM API key"
if [[ -n "${LLM_API_KEY:-}" ]]; then
  secret_exists "$LLM_KEY_SECRET" || gc secrets create "$LLM_KEY_SECRET" --replication-policy=automatic
  printf '%s' "$LLM_API_KEY" | gc secrets versions add "$LLM_KEY_SECRET" --data-file=-
  ok "stored new version of $LLM_KEY_SECRET"
elif secret_exists "$LLM_KEY_SECRET" && secret_has_version "$LLM_KEY_SECRET"; then
  ok "secret $LLM_KEY_SECRET exists"
else
  warn "LLM_API_KEY not set — AI endpoints will report 'not configured'. Re-run with: LLM_API_KEY=... pnpm gcp:bootstrap"
fi

for s in "$DB_URL_SECRET" "$LLM_KEY_SECRET"; do
  if secret_exists "$s"; then
    retry quiet gc secrets add-iam-policy-binding "$s" \
      --member "serviceAccount:$RUNTIME_SA_EMAIL" --role roles/secretmanager.secretAccessor \
      || die "could not grant access to $s"
  fi
done
ok "runtime service account can read secrets"

# ---------------------------------------------------------------------------
if is_true "$ENABLE_GITHUB_DEPLOY" && [[ -n "$GITHUB_REPO" ]]; then
  log "GitHub Actions deploy via Workload Identity Federation ($GITHUB_REPO)"
  ensure_sa "$DEPLOYER_SA_EMAIL" "VALT API deployer (GitHub Actions)"
  bind_project "$DEPLOYER_SA_EMAIL" roles/run.admin
  bind_project "$DEPLOYER_SA_EMAIL" roles/artifactregistry.writer
  retry quiet gc iam service-accounts add-iam-policy-binding "$RUNTIME_SA_EMAIL" \
    --member "serviceAccount:$DEPLOYER_SA_EMAIL" --role roles/iam.serviceAccountUser \
    || die "could not let deployer act as runtime SA"

  POOL=github PROVIDER=github
  if ! quiet gc iam workload-identity-pools describe "$POOL" --location=global; then
    gc iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub Actions"
  fi
  if ! quiet gc iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL"; then
    gc iam workload-identity-pools providers create-oidc "$PROVIDER" \
      --location=global --workload-identity-pool="$POOL" --display-name="GitHub OIDC" \
      --issuer-uri="https://token.actions.githubusercontent.com" \
      --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
      --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
  fi
  retry quiet gc iam service-accounts add-iam-policy-binding "$DEPLOYER_SA_EMAIL" \
    --role roles/iam.workloadIdentityUser \
    --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" \
    || die "could not bind GitHub identity to deployer"

  WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
  ok "GitHub can deploy. Add these in GitHub → Settings → Secrets and variables → Actions:"
  cat <<EOF

    Secrets:
      GCP_WIF_PROVIDER = ${WIF_PROVIDER}
      GCP_DEPLOYER_SA  = ${DEPLOYER_SA_EMAIL}
    Variables:
      GCP_PROJECT_ID   = ${GCP_PROJECT_ID}
      GCP_REGION       = ${GCP_REGION}
      API_CORS_ORIGINS = ${CORS_ORIGINS}
      ALLOW_UNAUTHENTICATED = ${ALLOW_UNAUTHENTICATED}
      LLM_PROVIDER     = ${LLM_PROVIDER}
      LLM_MODEL        = ${LLM_MODEL}

    With gh:  gh secret set GCP_WIF_PROVIDER -b '${WIF_PROVIDER}'
              gh secret set GCP_DEPLOYER_SA  -b '${DEPLOYER_SA_EMAIL}'
              gh variable set GCP_PROJECT_ID -b '${GCP_PROJECT_ID}'
              gh variable set GCP_REGION     -b '${GCP_REGION}'
EOF
fi

log "Bootstrap complete"
