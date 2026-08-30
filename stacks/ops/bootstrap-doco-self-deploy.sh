#!/usr/bin/env bash
# One-time GitOps adoption: Doco-CD cannot recreate its own running container during
# deploy (the deploy process exits when compose stops it). Use a short-lived sibling
# container to receive the webhook and apply the labeled hcloud-doco-cd service.
set -euo pipefail

STACKS="${STACKS:-/opt/stacks}"
DOCO_ENV="${STACKS}/doco-cd/.env"
REPO_URL="${REPO_URL:-https://github.com/GoodMannersHosting/cloud-security-cluster.git}"
REPO_FULL="${REPO_FULL:-GoodMannersHosting/cloud-security-cluster}"
CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
TEMP_NAME="${TEMP_NAME:-doco-cd-bootstrap}"
TEMP_PORT="${TEMP_PORT:-8088}"
BRANCH="${BRANCH:-main}"

log() { printf '==> %s\n' "$*"; }

has_deploy_labels() {
  local sha
  sha="$(docker inspect doco-cd \
    --format '{{index .Config.Labels "cd.doco.deployment.target.sha"}}' \
    2>/dev/null || true)"
  [[ -n "${sha}" ]]
}

cleanup_temp() {
  docker rm -f "${TEMP_NAME}" >/dev/null 2>&1 || true
}

if has_deploy_labels && [[ "${FORCE_BOOTSTRAP:-0}" != "1" ]]; then
  log "doco-cd already stamped by Doco-CD deploy; skip bootstrap (FORCE_BOOTSTRAP=1 to redo)"
  exit 0
fi

if [[ ! -f "${DOCO_ENV}" ]]; then
  echo "missing ${DOCO_ENV}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${DOCO_ENV}"
[[ -n "${WEBHOOK_SECRET:-}" ]] || {
  echo "WEBHOOK_SECRET required in ${DOCO_ENV}" >&2
  exit 1
}

if ! docker ps --filter name=^doco-cd$ --filter status=running -q | grep -q .; then
  log "doco-cd not running; temp container will run the GitOps deploy"
fi

log "Start temporary Doco-CD (${TEMP_NAME}) for self-deploy webhook"
cleanup_temp

sops_mount=()
if [[ -f "${STACKS}/doco-cd/sops_age_key.txt" ]]; then
  sops_mount=(-v "${STACKS}/doco-cd/sops_age_key.txt:/run/secrets/sops_age_key:ro")
fi

docker run -d --name "${TEMP_NAME}" \
  --network traefik \
  -e HTTP_PORT="${TEMP_PORT}" \
  -e MAX_CONCURRENT_DEPLOYMENTS=1 \
  -e TZ="${TZ:-UTC}" \
  -e GIT_ACCESS_TOKEN="${GIT_ACCESS_TOKEN:-}" \
  -e WEBHOOK_SECRET="${WEBHOOK_SECRET}" \
  -e SOPS_AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-/run/secrets/sops_age_key}" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /opt/stacks:/opt/stacks:ro \
  -v doco-cd_doco_cd_data:/data \
  "${sops_mount[@]}" \
  "ghcr.io/kimdre/doco-cd:${DOCO_CD_TAG:-0.90.1}" >/dev/null

trap cleanup_temp EXIT

for _ in $(seq 1 30); do
  if docker exec "${TEMP_NAME}" /doco-cd healthcheck >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

sha="$(git -C "${CLONE_DIR}" rev-parse HEAD)"
ref="refs/heads/${BRANCH}"
payload="$(jq -nc \
  --arg ref "${ref}" \
  --arg sha "${sha}" \
  --arg url "${REPO_URL}" \
  --arg full "${REPO_FULL}" \
  '{ref: $ref, before: $sha, after: $sha,
    repository: {clone_url: $url, full_name: $full, name: ($full|split("/")|last)}}')"
sig="$(printf '%s' "${payload}" \
  | openssl dgst -sha256 -hmac "${WEBHOOK_SECRET}" \
  | awk '{print "sha256="$2}')"

ip="$(docker inspect "${TEMP_NAME}" \
  --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
log "Trigger self-deploy via ${TEMP_NAME} @ ${sha:0:7}"
curl -sf -X POST "http://${ip}:${TEMP_PORT}/v1/webhook?wait=true" \
  -H "X-GitHub-Event: push" \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: ${sig}" \
  --data "${payload}"

sleep 5
if has_deploy_labels; then
  log "doco-cd GitOps labels present"
else
  echo "bootstrap finished but cd.doco.deployment.target.sha still missing" >&2
  exit 1
fi

docker ps -aq --filter name=_doco-cd --filter status=created \
  | xargs -r docker rm -f

log "Self-deploy bootstrap complete"
