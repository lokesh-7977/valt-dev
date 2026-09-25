#!/usr/bin/env bash
# Build → migrate → deploy → smoke-test the VALT API on Cloud Run.
#
#   bash infra/gcp/deploy.sh           # or: pnpm gcp:deploy   (runs bootstrap first)
#
# Env knobs:
#   SKIP_BOOTSTRAP=1   skip infra/gcp/bootstrap.sh (CI sets this)
#   BUILDER=cloudbuild (default, no local Docker needed) | docker
#   IMAGE_TAG=...      override the image tag (default: <git sha>-<timestamp>)
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load_config

if [[ "${SKIP_BOOTSTRAP:-0}" != "1" ]]; then
  bash "$GCP_DIR/bootstrap.sh"
else
  require_gcloud
fi

# ---------------------------------------------------------------------------
log "Build image"
SHA="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo nogit)"
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain -- apps/api 2>/dev/null)" ]]; then SHA="${SHA}-dirty"; fi
IMAGE="${IMAGE_BASE}:${IMAGE_TAG:-${SHA}-$(date +%Y%m%d%H%M%S)}"

case "${BUILDER:-cloudbuild}" in
  docker)
    gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
    docker build -t "$IMAGE" "$ROOT_DIR/apps/api"
    docker push "$IMAGE"
    ;;
  cloudbuild)
    gc builds submit "$ROOT_DIR/apps/api" \
      --config "$GCP_DIR/cloudbuild.yaml" \
      --substitutions "_IMAGE=${IMAGE}" \
      --service-account "projects/${GCP_PROJECT_ID}/serviceAccounts/${BUILDER_SA_EMAIL}" \
      --region "$GCP_REGION"
    ;;
  *) die "BUILDER must be cloudbuild or docker" ;;
esac
ok "image $IMAGE"

# ---------------------------------------------------------------------------
# Runtime configuration (non-secret) as an env-vars file: safe for JSON values with commas.
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
{
  echo "API_ENV: \"production\""
  echo "API_CORS_ORIGINS: '${CORS_ORIGINS}'"
  echo "CREWAI_DISABLE_TELEMETRY: \"true\""
  if [[ -n "$LLM_PROVIDER" ]]; then echo "API_LLM_PROVIDER: \"${LLM_PROVIDER}\""; fi
  if [[ -n "$LLM_MODEL" ]]; then echo "API_LLM_MODEL: \"${LLM_MODEL}\""; fi
} > "$ENV_FILE"

SECRETS="API_DATABASE_URL=${DB_URL_SECRET}:latest"
if secret_exists "$LLM_KEY_SECRET" && secret_has_version "$LLM_KEY_SECRET"; then
  SECRETS="${SECRETS},API_LLM_API_KEY=${LLM_KEY_SECRET}:latest"
fi

# ---------------------------------------------------------------------------
if [[ -f "$ROOT_DIR/apps/api/alembic.ini" ]]; then
  log "Run database migrations (Cloud Run Job $MIGRATE_JOB)"
  gc run jobs deploy "$MIGRATE_JOB" \
    --image "$IMAGE" --region "$GCP_REGION" \
    --service-account "$RUNTIME_SA_EMAIL" \
    --set-cloudsql-instances "$SQL_CONNECTION" \
    --set-secrets "$SECRETS" --env-vars-file "$ENV_FILE" \
    --command alembic --args upgrade,head \
    --max-retries 0 --task-timeout 900
  gc run jobs execute "$MIGRATE_JOB" --region "$GCP_REGION" --wait
  ok "migrations applied"
else
  warn "apps/api/alembic.ini not found — skipping migrations (no database layer yet)"
fi

# ---------------------------------------------------------------------------
log "Deploy Cloud Run service $SERVICE_NAME"
if is_true "$ALLOW_UNAUTHENTICATED"; then AUTH_FLAG=--allow-unauthenticated; else AUTH_FLAG=--no-allow-unauthenticated; fi

gc run deploy "$SERVICE_NAME" \
  --image "$IMAGE" --region "$GCP_REGION" \
  --service-account "$RUNTIME_SA_EMAIL" \
  --set-cloudsql-instances "$SQL_CONNECTION" \
  --set-secrets "$SECRETS" --env-vars-file "$ENV_FILE" \
  --port 8000 --cpu "$CPU" --memory "$MEMORY" \
  --min-instances "$MIN_INSTANCES" --max-instances "$MAX_INSTANCES" \
  --concurrency "$CONCURRENCY" --timeout "$REQUEST_TIMEOUT" \
  "$AUTH_FLAG"

URL="$(gc run services describe "$SERVICE_NAME" --region "$GCP_REGION" --format='value(status.url)')"
ok "deployed: $URL"

# ---------------------------------------------------------------------------
log "Smoke test ${URL}/api/health"
if is_true "$ALLOW_UNAUTHENTICATED"; then
  curl -fsS --max-time 30 "${URL}/api/health" && echo
elif [[ -z "${CI:-}" ]]; then
  curl -fsS --max-time 30 -H "Authorization: Bearer $(gcloud auth print-identity-token)" "${URL}/api/health" && echo
else
  warn "service is private and running in CI — skipping smoke test"
fi

PREV="$(gc run revisions list --service "$SERVICE_NAME" --region "$GCP_REGION" --format='value(metadata.name)' --sort-by='~metadata.creationTimestamp' --limit 2 | sed -n 2p)"
log "Done"
echo "    URL:      $URL"
echo "    Image:    $IMAGE"
if [[ -n "$PREV" ]]; then echo "    Rollback: gcloud run services update-traffic $SERVICE_NAME --region $GCP_REGION --project $GCP_PROJECT_ID --to-revisions ${PREV}=100"; fi
