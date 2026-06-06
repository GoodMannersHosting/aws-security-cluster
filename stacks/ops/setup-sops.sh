#!/usr/bin/env bash
# Age key + encrypted backups of /opt/stacks/*.env (host only, never commit).
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-/opt/stack-secrets}"
AGE_KEY="${SECRETS_DIR}/sops_age_key.txt"
AGE_PUB="${SECRETS_DIR}/age.pub"
STACKS="${STACKS:-/opt/stacks}"
DOCO_DIR="${DOCO_DIR:-/opt/hcloud-security-cluster/stacks/doco-cd}"

log() { printf '==> %s\n' "$*"; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1" >&2; exit 1; }; }

need_cmd age-keygen
need_cmd sops

mkdir -p "${SECRETS_DIR}"
chmod 700 "${SECRETS_DIR}"

if [[ ! -f "${AGE_KEY}" ]]; then
  log "Generating age key at ${AGE_KEY}"
  age-keygen -o "${AGE_KEY}"
  chmod 600 "${AGE_KEY}"
fi

age-keygen -y "${AGE_KEY}" >"${AGE_PUB}"
chmod 644 "${AGE_PUB}"

install -m 600 "${AGE_KEY}" "${DOCO_DIR}/sops_age_key.txt"

encrypt_env() {
  local stack="$1"
  local plain="${STACKS}/${stack}/.env"
  local enc="${SECRETS_DIR}/${stack}.env.enc"
  [[ -f "${plain}" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  grep -Ev '^[[:space:]]*(#|$)' "${plain}" >"${tmp}" || true
  if ! sops encrypt --input-type dotenv --output-type dotenv \
    --age "$(cat "${AGE_PUB}")" "${tmp}" >"${enc}" 2>/dev/null; then
    rm -f "${tmp}"
    log "Skip encrypt ${plain} (dotenv parse failed)"
    return 0
  fi
  rm -f "${tmp}"
  chmod 600 "${enc}"
  log "Encrypted ${plain} -> ${enc}"
}

for stack in traefik authentik openbao doco-cd; do
  encrypt_env "${stack}"
done

log "Public age recipient (for .sops.yaml): $(cat "${AGE_PUB}")"
