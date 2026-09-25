#!/usr/bin/env bash
# Shared helpers for infra/gcp scripts. Sourced, not executed.
set -euo pipefail

GCP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$GCP_DIR/../.." && pwd)"

log()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '    \033[33m!\033[0m %s\n' "$*" >&2; }
die()  { printf '\n\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

load_config() {
  local cfg="${GCP_CONFIG:-$GCP_DIR/config.env}"
  if [[ -f "$cfg" ]]; then
    # Environment variables already set win over the file.
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
      local key="${line%%=*}" val="${line#*=}"
      key="${key//[[:space:]]/}"
      val="${val%%#*}"                                   # strip trailing comment
      val="$(printf '%s' "$val" | sed -e 's/[[:space:]]*$//' -e "s/^'\(.*\)'$/\1/" -e 's/^"\(.*\)"$/\1/')"
      if [[ -z "${!key:-}" ]]; then export "$key=$val"; fi
    done < "$cfg"
  fi

  : "${GCP_PROJECT_ID:?set GCP_PROJECT_ID (infra/gcp/config.env or env)}"
  : "${GCP_REGION:?set GCP_REGION (infra/gcp/config.env or env)}"
  : "${SERVICE_NAME:=valt-api}"
  : "${AR_REPO:=valt}"
  : "${ALLOW_UNAUTHENTICATED:=false}"
  : "${MIN_INSTANCES:=0}"
  : "${MAX_INSTANCES:=5}"
  : "${CPU:=1}"
  : "${MEMORY:=1Gi}"
  : "${REQUEST_TIMEOUT:=3600}"
  : "${CONCURRENCY:=80}"
  : "${CORS_ORIGINS:=[\"http://localhost:3000\"]}"
  : "${SQL_INSTANCE:=valt-pg}"
  : "${SQL_TIER:=db-f1-micro}"
  : "${SQL_EDITION:=enterprise}"
  : "${DB_NAME:=valt}"
  : "${DB_USER:=valt}"
  : "${LLM_PROVIDER:=}"
  : "${LLM_MODEL:=}"
  : "${GITHUB_REPO:=}"
  : "${ENABLE_GITHUB_DEPLOY:=false}"

  RUNTIME_SA_EMAIL="${SERVICE_NAME}-runtime@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  BUILDER_SA_EMAIL="${SERVICE_NAME}-builder@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  DEPLOYER_SA_EMAIL="${SERVICE_NAME}-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
  SQL_CONNECTION="${GCP_PROJECT_ID}:${GCP_REGION}:${SQL_INSTANCE}"
  IMAGE_BASE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${AR_REPO}/${SERVICE_NAME}"
  DB_URL_SECRET="${SERVICE_NAME}-database-url"
  LLM_KEY_SECRET="${SERVICE_NAME}-llm-api-key"
  MIGRATE_JOB="${SERVICE_NAME}-migrate"
  export RUNTIME_SA_EMAIL BUILDER_SA_EMAIL DEPLOYER_SA_EMAIL SQL_CONNECTION IMAGE_BASE \
         DB_URL_SECRET LLM_KEY_SECRET MIGRATE_JOB
}

gc() { gcloud --project "$GCP_PROJECT_ID" --quiet "$@"; }

quiet() { "$@" >/dev/null 2>&1; }

require_gcloud() {
  command -v gcloud >/dev/null || die "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
  local acct
  acct="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1)"
  [[ -n "$acct" ]] || die "Not logged in. Run: gcloud auth login"
  ok "gcloud as $acct, project $GCP_PROJECT_ID, region $GCP_REGION"
}

# Retry a command a few times (IAM propagation after creating service accounts).
retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    [[ $n -ge 5 ]] && return 1
    sleep $((n * 5))
  done
}

secret_exists()       { quiet gc secrets describe "$1"; }
secret_has_version()  { [[ -n "$(gc secrets versions list "$1" --filter='state=ENABLED' --limit=1 --format='value(name)' 2>/dev/null)" ]]; }

is_true() {
  local v
  v="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
  [[ "$v" == "true" || "$v" == "1" || "$v" == "yes" ]]
}
