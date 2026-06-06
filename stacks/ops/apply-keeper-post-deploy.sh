#!/usr/bin/env bash
# Post-deploy on keeper: host hardening + OpenBao audit (run as root on the VPS).
set -euo pipefail

CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
OPS_DIR="${CLONE_DIR}/stacks/ops"

log() { printf '==> %s\n' "$*"; }

[[ "${EUID:-$(id -u)}" -eq 0 ]] || {
  echo "run as root on keeper" >&2
  exit 1
}

[[ -d "${CLONE_DIR}" ]] || {
  echo "missing clone: ${CLONE_DIR}" >&2
  exit 1
}

log "host hardening"
chmod +x "${OPS_DIR}/harden-host.sh"
DOCKER_RESTART="${DOCKER_RESTART:-0}" bash "${OPS_DIR}/harden-host.sh"

BAO_TOKEN_FILE="${BAO_TOKEN_FILE:-/opt/stack-secrets/bao-admin.token}"
if [[ -z "${BAO_TOKEN:-}" && -f "${BAO_TOKEN_FILE}" ]]; then
  BAO_TOKEN="$(tr -d '[:space:]' < "${BAO_TOKEN_FILE}")"
  export BAO_TOKEN
fi

if [[ -n "${BAO_TOKEN:-}" ]]; then
  log "OpenBao file audit"
  chmod +x "${CLONE_DIR}/bao/enable-audit.sh"
  CONFIG="${CLONE_DIR}/bao/config.env" \
    BAO_TOKEN_FILE="${BAO_TOKEN_FILE}" \
    bash "${CLONE_DIR}/bao/enable-audit.sh"
else
  log "skip OpenBao file audit (set BAO_TOKEN or ${BAO_TOKEN_FILE})"
fi

log "host auditd"
systemctl is-active auditd >/dev/null && log "auditd active" || log "auditd not active"

log "done"
