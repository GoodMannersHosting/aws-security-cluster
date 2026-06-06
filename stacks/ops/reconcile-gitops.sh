#!/usr/bin/env bash
# Align keeper with GitOps: host clone, traefik bind paths, retire manual compose.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/GoodMannersHosting/aws-security-cluster.git}"
REPO_FULL="${REPO_FULL:-GoodMannersHosting/aws-security-cluster}"
CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
DOCO_CLONE="${DOCO_CLONE:-/var/lib/docker/volumes/doco-cd_doco_cd_data/_data/github.com/${REPO_FULL}}"
STACKS="${STACKS:-/opt/stacks}"
DOCO_ENV="${STACKS}/doco-cd/.env"
BRANCH="${BRANCH:-main}"
OPS_DIR="${CLONE_DIR}/stacks/ops"

log() { printf '==> %s\n' "$*"; }

doco_compose_dir() {
  if [[ -f "${DOCO_CLONE}/stacks/doco-cd/compose.yaml" ]]; then
    printf '%s/stacks/doco-cd' "${DOCO_CLONE}"
  else
    printf '%s/stacks/doco-cd' "${CLONE_DIR}"
  fi
}

doco_compose_args() {
  local args=(-f compose.yaml)
  [[ -f "${STACKS}/doco-cd/sops_age_key.txt" ]] && args+=(-f compose.sops.yaml)
  printf '%s\n' "${args[@]}"
}

ensure_doco_from_gitops_clone() {
  local dir env_file
  dir="$(doco_compose_dir)"
  env_file="${STACKS}/doco-cd/.env"
  [[ -f "${dir}/compose.yaml" ]] || return 0
  docker volume inspect doco-cd_doco_cd_data >/dev/null 2>&1 \
    || docker volume create doco-cd_doco_cd_data >/dev/null
  log "ensure doco-cd from ${dir} (same path GitOps uses)"
  mapfile -t args < <(doco_compose_args)
  docker ps -aq --filter name=_doco-cd --filter status=created \
    | xargs -r docker rm -f
  (
    cd "${dir}"
    docker compose -p hcloud-doco-cd --env-file "${env_file}" \
      "${args[@]}" up -d
  )
  sleep 2
}

ensure_host_clone_remote() {
  local current
  current="$(git -C "${CLONE_DIR}" remote get-url origin 2>/dev/null || true)"
  if [[ "${current}" != "${REPO_URL}" ]]; then
    log "set host clone origin -> ${REPO_URL} (was: ${current})"
    git -C "${CLONE_DIR}" remote set-url origin "${REPO_URL}"
  fi
}

migrate_legacy_doco_project() {
  local dir env_file vol="doco-cd_doco_cd_data"
  local has_legacy has_gitops
  has_legacy="$(docker compose ls --format json 2>/dev/null \
    | jq -r '.[] | select(.Name=="doco-cd") | .Name' 2>/dev/null || true)"
  has_gitops="$(docker compose ls --format json 2>/dev/null \
    | jq -r '.[] | select(.Name=="hcloud-doco-cd") | .Name' 2>/dev/null || true)"
  [[ -n "${has_legacy}" && -z "${has_gitops}" ]] || return 0
  dir="$(doco_compose_dir)"
  env_file="${STACKS}/doco-cd/.env"
  log "migrate compose project doco-cd -> hcloud-doco-cd (preserve data volume)"
  docker volume inspect "${vol}" >/dev/null 2>&1 || docker volume create "${vol}" >/dev/null
  mapfile -t args < <(doco_compose_args)
  (
    cd "${dir}"
    docker compose -p doco-cd --env-file "${env_file}" "${args[@]}" \
      down --remove-orphans --timeout 30
    docker compose -p hcloud-doco-cd --env-file "${env_file}" "${args[@]}" up -d
  )
  sleep 3
}

reset_doco_clone_to_main() {
  [[ -d "${DOCO_CLONE}/.git" ]] || {
    log "Doco-CD deploy clone not present yet (created on first deploy)"
    return 0
  }
  log "reset Doco-CD deploy clone to origin/${BRANCH}"
  git -C "${DOCO_CLONE}" fetch origin "${BRANCH}"
  git -C "${DOCO_CLONE}" checkout "${BRANCH}"
  git -C "${DOCO_CLONE}" reset --hard "origin/${BRANCH}"
}

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
  local ip
  ip="$(docker inspect doco-cd --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || true)"
  local url="https://${host}/v1/webhook?wait=true"
  [[ -n "${ip}" ]] && url="http://${ip}/v1/webhook?wait=true"
  if ! curl -sf -X POST "${url}" \
    -H "X-GitHub-Event: push" \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: ${sig}" \
    --data "${payload}" >/dev/null; then
    log "webhook deploy returned non-success (check: docker logs doco-cd)"
  fi
}

log "Update host clone ${CLONE_DIR}"
ensure_host_clone_remote
git -C "${CLONE_DIR}" fetch origin "${BRANCH}"
git -C "${CLONE_DIR}" checkout "${BRANCH}"
git -C "${CLONE_DIR}" pull --ff-only origin "${BRANCH}"

migrate_legacy_doco_project
reset_doco_clone_to_main

install_sops_age_key() {
  local src="${CLONE_DIR}/stacks/doco-cd/sops_age_key.txt"
  local dest="${STACKS}/doco-cd/sops_age_key.txt"
  [[ -f "${src}" ]] || return 0
  install -d -m 0700 "${STACKS}/doco-cd"
  install -m 600 "${src}" "${dest}"
  log "installed SOPS age key at ${dest}"
}

install_sops_age_key
ensure_traefik_env
sync_traefik_from_git

log "Retire manual compose under /opt/stacks (Doco-CD uses git clone)"
archive_if_exists "${STACKS}/traefik/docker-compose.yaml"
archive_if_exists "${STACKS}/authentik/compose.yaml"
archive_if_exists "${STACKS}/openbao/compose.yaml"

ensure_doco_from_gitops_clone
trigger_main_webhook
ensure_doco_from_gitops_clone

if [[ -x "${OPS_DIR}/verify-gitops.sh" ]]; then
  log "Verify GitOps"
  "${OPS_DIR}/verify-gitops.sh"
fi
