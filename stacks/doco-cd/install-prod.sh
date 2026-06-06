#!/usr/bin/env bash
# Install Doco-CD on keeper.goodmanners.services (existing /opt/stacks layout).
# Run on the VPS as root after pushing stack changes to main.
#
# Usage: curl -fsSL ... | bash   OR   sudo ./install-prod.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/GoodMannersHosting/hcloud-security-cluster.git}"
CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
STACKS="${STACKS:-/opt/stacks}"
DOCO_ENV="${STACKS}/doco-cd/.env"
BRANCH="${BRANCH:-main}"

log() { printf '==> %s\n' "$*"; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }

need_cmd docker
need_cmd git
docker compose version >/dev/null 2>&1 || { echo "need Docker Compose v2" >&2; exit 1; }

if [[ ! -d "${STACKS}/traefik" ]]; then
  echo "expected ${STACKS}/traefik — is this keeper?" >&2
  exit 1
fi

log "Clone or update ${CLONE_DIR}"
if [[ -d "${CLONE_DIR}/.git" ]]; then
  git -C "${CLONE_DIR}" fetch origin "${BRANCH}"
  git -C "${CLONE_DIR}" checkout "${BRANCH}"
  git -C "${CLONE_DIR}" pull --ff-only origin "${BRANCH}" || true
else
  git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${CLONE_DIR}"
fi

log "Ensure Traefik host env for Doco-CD (idempotent)"
TRAEFIK_ENV="${STACKS}/traefik/.env"
if [[ ! -f "${TRAEFIK_ENV}" ]]; then
  cp "${CLONE_DIR}/stacks/traefik/.env.example" "${TRAEFIK_ENV}"
  chmod 600 "${TRAEFIK_ENV}"
  log "Created ${TRAEFIK_ENV} — set ACME_EMAIL if you use git-managed traefik.yml"
fi

log "Ensure Authentik env keys for blueprints + Doco-CD outpost"
AUTH_ENV="${STACKS}/authentik/.env"
touch "${AUTH_ENV}"
chmod 600 "${AUTH_ENV}"
grep -q '^DOCO_CD_HOSTNAME=' "${AUTH_ENV}" || \
  echo 'DOCO_CD_HOSTNAME=doco-cd.goodmanners.services' >>"${AUTH_ENV}"
grep -q '^AUTHENTIK_BLUEPRINTS_PATH=' "${AUTH_ENV}" || \
  echo "AUTHENTIK_BLUEPRINTS_PATH=${CLONE_DIR}/authentik/blueprints" >>"${AUTH_ENV}"

log "Ensure OpenBao host paths for Doco-CD deploys"
OPENBAO_ENV="${STACKS}/openbao/.env"
touch "${OPENBAO_ENV}"
chmod 600 "${OPENBAO_ENV}"
grep -q '^OPENBAO_CONFIG_DIR=' "${OPENBAO_ENV}" || \
  echo 'OPENBAO_CONFIG_DIR=/opt/stacks/openbao/config' >>"${OPENBAO_ENV}"
grep -q '^OPENBAO_AWS_CREDS_DIR=' "${OPENBAO_ENV}" || \
  echo 'OPENBAO_AWS_CREDS_DIR=/opt/stacks/openbao/aws' >>"${OPENBAO_ENV}"

log "Symlink host .env into clone (Compose env_file: .env)"
for stack in traefik authentik openbao; do
  ln -sf "${STACKS}/${stack}/.env" "${CLONE_DIR}/stacks/${stack}/.env"
done

mkdir -p "${STACKS}/doco-cd"
if [[ ! -f "${DOCO_ENV}" ]]; then
  cp "${CLONE_DIR}/stacks/doco-cd/.env.example" "${DOCO_ENV}"
  if command -v openssl >/dev/null 2>&1; then
    sed -i "s/^WEBHOOK_SECRET=.*/WEBHOOK_SECRET=$(openssl rand -base64 40)/" "${DOCO_ENV}"
  fi
  chmod 600 "${DOCO_ENV}"
  log "Created ${DOCO_ENV} — add GIT_ACCESS_TOKEN if the repo becomes private"
fi

log "Sync Traefik dynamic config (forward-auth for Doco-CD)"
install -m 644 "${CLONE_DIR}/stacks/traefik/dynamic/middlewares.yml" \
  "${STACKS}/traefik/dynamic/middlewares.yml"

log "Starting Doco-CD"
(
  cd "${CLONE_DIR}/stacks/doco-cd"
  docker compose --env-file "${DOCO_ENV}" -f compose.yaml up -d
)

# shellcheck disable=SC1090
source "${DOCO_ENV}"
HOST="${DOCO_CD_HOSTNAME:-doco-cd.goodmanners.services}"
SECRET="${WEBHOOK_SECRET:-<see ${DOCO_ENV}>}"

cat <<EOF

Doco-CD is running.

1. DNS: ${HOST} -> this server
2. GitHub webhook (GoodMannersHosting/hcloud-security-cluster):
   URL:     https://${HOST}/v1/webhook
   Secret:  ${SECRET}
   Content: application/json
   Events:  push (branch main)
3. Assign your Authentik user to group platform-admin (forward auth).
4. Redeploy Authentik once so worker picks up blueprints:
   docker compose -f ${STACKS}/authentik/compose.yaml up -d
   (or push to main and let Doco-CD apply)
5. After Keeper blueprint exists: cd ${CLONE_DIR}/bao && ./setup.sh

Logs: docker logs -f doco-cd

EOF
