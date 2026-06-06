#!/usr/bin/env bash
# Align keeper with GitOps: host clone, traefik bind paths, retire manual compose.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/GoodMannersHosting/aws-security-cluster.git}"
REPO_FULL="${REPO_FULL:-GoodMannersHosting/aws-security-cluster}"
CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
STACKS="${STACKS:-/opt/stacks}"
DOCO_ENV="${STACKS}/doco-cd/.env"
BRANCH="${BRANCH:-main}"
OPS_DIR="${CLONE_DIR}/stacks/ops"

log() { printf '==> %s\n' "$*"; }

archive_if_exists() {
  local path="$1"
  [[ -f "${path}" ]] || return 0
  local backup="${path}.legacy-manual.$(date +%Y%m%d%H%M%S).bak"
  mv "${path}" "${backup}"
  log "archived ${path} -> ${backup}"
}

ensure_traefik_env() {
  local env_file="${STACKS}/traefik/.env"
  touch "${env_file}"
  chmod 600 "${env_file}"
  grep -q '^ACME_EMAIL=' "${env_file}" || \
    echo 'ACME_EMAIL=admin@goodmanners.services' >>"${env_file}"
  grep -q '^TRAEFIK_DASHBOARD_HOSTNAME=' "${env_file}" || \
    echo 'TRAEFIK_DASHBOARD_HOSTNAME=traefik.goodmanners.services' >>"${env_file}"
  grep -q '^TRAEFIK_CONFIG_PATH=' "${env_file}" || \
    echo 'TRAEFIK_CONFIG_PATH=/opt/stacks/traefik/traefik.yml' >>"${env_file}"
  grep -q '^TRAEFIK_DYNAMIC_PATH=' "${env_file}" || \
    echo 'TRAEFIK_DYNAMIC_PATH=/opt/stacks/traefik/dynamic' >>"${env_file}"
  grep -q '^TRAEFIK_ACME_DIR=' "${env_file}" || \
    echo 'TRAEFIK_ACME_DIR=/opt/stacks/traefik/acme' >>"${env_file}"
  grep -q '^TRAEFIK_LOG_DIR=' "${env_file}" || \
    echo 'TRAEFIK_LOG_DIR=/var/log/traefik' >>"${env_file}"
}

sync_traefik_from_git() {
  install -d -m 0755 "${STACKS}/traefik/dynamic"
  install -m 644 "${CLONE_DIR}/stacks/traefik/traefik.yml" \
    "${STACKS}/traefik/traefik.yml"
  install -m 644 "${CLONE_DIR}/stacks/traefik/dynamic/"*.yml \
    "${STACKS}/traefik/dynamic/" 2>/dev/null || true
  install -m 644 "${CLONE_DIR}/stacks/traefik/dynamic/"*.yaml \
    "${STACKS}/traefik/dynamic/" 2>/dev/null || true
}

trigger_main_webhook() {
  # shellcheck disable=SC1090
  source "${DOCO_ENV}"
  [[ -n "${WEBHOOK_SECRET:-}" ]] || { log "skip webhook (no WEBHOOK_SECRET)"; return 0; }
  command -v jq >/dev/null 2>&1 || { log "skip webhook (jq missing)"; return 0; }
  local host="${DOCO_CD_HOSTNAME:-doco-cd.goodmanners.services}"
  local sha ref="refs/heads/${BRANCH}"
  sha="$(git -C "${CLONE_DIR}" rev-parse HEAD)"
  local payload sig
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
  log "trigger Doco-CD deploy for ${ref} @ ${sha:0:7}"
  if ! curl -sf -X POST "https://${host}/v1/webhook?wait=true" \
    -H "X-GitHub-Event: push" \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: ${sig}" \
    --data "${payload}" >/dev/null; then
    log "webhook deploy returned non-success (check: docker logs doco-cd)"
  fi
}

log "Update host clone ${CLONE_DIR}"
git -C "${CLONE_DIR}" fetch origin "${BRANCH}"
git -C "${CLONE_DIR}" checkout "${BRANCH}"
git -C "${CLONE_DIR}" pull --ff-only origin "${BRANCH}"

log "Symlink host secrets into clone"
for stack in traefik authentik openbao; do
  ln -sf "${STACKS}/${stack}/.env" "${CLONE_DIR}/stacks/${stack}/.env"
done

ensure_traefik_env
sync_traefik_from_git

log "Retire manual compose under /opt/stacks (Doco-CD uses git clone)"
archive_if_exists "${STACKS}/traefik/docker-compose.yaml"
archive_if_exists "${STACKS}/authentik/compose.yaml"

trigger_main_webhook

if [[ -x "${OPS_DIR}/verify-gitops.sh" ]]; then
  log "Verify GitOps"
  "${OPS_DIR}/verify-gitops.sh"
fi
