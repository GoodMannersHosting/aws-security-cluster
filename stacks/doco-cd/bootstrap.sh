#!/usr/bin/env bash
# Bootstrap Traefik + Doco-CD on a fresh Hetzner VPS. Run as root or with sudo.
# Usage: sudo ./bootstrap.sh [/path/to/hcloud-security-cluster]
set -euo pipefail

REPO_DIR="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
STACK_ENV_DIR="${STACK_ENV_DIR:-/opt/stack-env}"
DOCO_DIR="${REPO_DIR}/stacks/doco-cd"

log() { printf '==> %s\n' "$*"; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }

need_cmd docker
docker compose version >/dev/null 2>&1 || { echo "need Docker Compose v2" >&2; exit 1; }

log "Creating Docker networks (idempotent)"
docker network create traefik 2>/dev/null || true
docker network create data 2>/dev/null || true

log "Creating host data directories"
mkdir -p /mnt/data/postgres \
  /mnt/data/authentik/{postgres,data,media,certs,custom-templates} \
  /mnt/data/openbao/{config,logs} \
  /var/log/traefik
touch /var/log/traefik/access.log

log "Installing stack env files under ${STACK_ENV_DIR}"
mkdir -p "${STACK_ENV_DIR}"
install_env() {
  local name="$1" example="$2" dest="${STACK_ENV_DIR}/${name}.env"
  if [[ -f "${dest}" ]]; then
    log "Keeping existing ${dest}"
    return
  fi
  cp "${example}" "${dest}"
  chmod 600 "${dest}"
  log "Created ${dest} — edit secrets before production use"
}
install_env traefik "${REPO_DIR}/stacks/traefik/.env.example"
install_env postgres "${REPO_DIR}/stacks/postgres/.env.example"
install_env authentik "${REPO_DIR}/stacks/authentik/.env.example"
install_env openbao "${REPO_DIR}/stacks/openbao/.env.example"
install_env doco-cd "${REPO_DIR}/stacks/doco-cd/.env.example"

if [[ -x "${DOCO_DIR}/generate-secrets.sh" ]]; then
  STACK_ENV_DIR="${STACK_ENV_DIR}" "${DOCO_DIR}/generate-secrets.sh"
fi

TRAEFIK_ENV="${STACK_ENV_DIR}/traefik.env"
if grep -q 'you@example.com' "${TRAEFIK_ENV}" 2>/dev/null; then
  log "Set ACME_EMAIL in ${TRAEFIK_ENV}"
fi

ACME_PATH="${REPO_DIR}/stacks/traefik/acme.json"
if [[ ! -f "${ACME_PATH}" ]]; then
  printf '{}\n' >"${ACME_PATH}"
  chmod 600 "${ACME_PATH}"
fi

log "Starting Traefik (manual once — Doco-CD manages it after webhooks)"
(
  cd "${REPO_DIR}/stacks/traefik"
  set -a
  # shellcheck disable=SC1090
  source "${STACK_ENV_DIR}/traefik.env"
  set +a
  docker compose --env-file "${STACK_ENV_DIR}/traefik.env" up -d
)

DOCO_ENV="${DOCO_DIR}/.env"
if [[ ! -f "${DOCO_ENV}" ]]; then
  ln -sf "${STACK_ENV_DIR}/doco-cd.env" "${DOCO_ENV}" 2>/dev/null || \
    cp "${STACK_ENV_DIR}/doco-cd.env" "${DOCO_ENV}"
  log "Linked ${DOCO_ENV} -> ${STACK_ENV_DIR}/doco-cd.env"
fi

if [[ ! -f "${DOCO_ENV}" ]] && [[ ! -L "${DOCO_ENV}" ]]; then
  cp "${DOCO_DIR}/.env.example" "${DOCO_ENV}"
  if command -v openssl >/dev/null 2>&1; then
    sed -i.bak "s/^WEBHOOK_SECRET=.*/WEBHOOK_SECRET=$(openssl rand -base64 40)/" "${DOCO_ENV}"
    rm -f "${DOCO_ENV}.bak"
  fi
  chmod 600 "${DOCO_ENV}"
  log "Created ${DOCO_ENV} — set DOCO_CD_HOSTNAME and GIT_ACCESS_TOKEN"
fi

log "Starting Doco-CD"
(
  cd "${DOCO_DIR}"
  docker compose --env-file "${STACK_ENV_DIR}/doco-cd.env" -f compose.yaml up -d
)

# shellcheck disable=SC1090
source "${STACK_ENV_DIR}/doco-cd.env"
HOST="${DOCO_CD_HOSTNAME:-doco-cd.example.com}"
SECRET="${WEBHOOK_SECRET:-<set in /opt/stack-env/doco-cd.env>}"

cat <<EOF

Bootstrap done.

1. Edit stack secrets:
   ${STACK_ENV_DIR}/traefik.env   (ACME_EMAIL)
   ${STACK_ENV_DIR}/authentik.env (AUTHENTIK_HOSTNAME, AUTHENTIK_SECRET_KEY, PG_PASS)
   ${STACK_ENV_DIR}/openbao.env   (OPENBAO_HOSTNAME=keeper.goodmanners.services)
   ${STACK_ENV_DIR}/postgres.env  (if using shared Postgres for OpenBao)

2. Edit Doco-CD: ${STACK_ENV_DIR}/doco-cd.env
   GIT_ACCESS_TOKEN=<GitHub PAT with repo read>

3. Add your user to Authentik group platform-admin (for Doco-CD UI via forward auth).
   Blueprints auto-apply from authentik/blueprints/ on worker start.

4. DNS: A/AAAA for Traefik hostnames + ${HOST} -> this server

5. GitHub webhook (repo GoodMannersHosting/hcloud-security-cluster):
   URL:     https://${HOST}/v1/webhook
   Secret:  ${SECRET}
   Content: application/json
   Events:  Just the push event

6. After push to main, Doco-CD applies stacks in .doco-cd.yml order.
   Logs: docker logs -f doco-cd

7. Re-apply OpenBao OIDC after Authentik blueprint creates the keeper app:
   cd bao && ./setup.sh

EOF
