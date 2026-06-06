#!/usr/bin/env bash
# age key on keeper + encrypt stack secrets into the git clone for commit.
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-/opt/stack-secrets}"
AGE_KEY="${AGE_KEY:-${SECRETS_DIR}/sops_age_key.txt}"
STACKS="${STACKS:-/opt/stacks}"
REPO_ROOT="${REPO_ROOT:-/opt/hcloud-security-cluster}"
DOCO_KEY="${STACKS}/doco-cd/sops_age_key.txt"
ENCRYPT_SCRIPT="${REPO_ROOT}/stacks/ops/encrypt-stack-secrets.sh"

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

install -d -m 0700 "${STACKS}/doco-cd"
install -m 600 "${AGE_KEY}" "${DOCO_KEY}"
log "Installed Doco-CD age key at ${DOCO_KEY}"

if [[ -x "${ENCRYPT_SCRIPT}" ]]; then
  REPO_ROOT="${REPO_ROOT}" STACKS="${STACKS}" "${ENCRYPT_SCRIPT}"
else
  log "Skip encrypt (run ${ENCRYPT_SCRIPT} after repo update)"
fi

log "Public age recipient: $(age-keygen -y "${AGE_KEY}")"
