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

log "OpenBao file audit (declarative config)"
chmod +x "${CLONE_DIR}/bao/enable-audit.sh"
bash "${CLONE_DIR}/bao/enable-audit.sh"

log "host auditd"
systemctl is-active auditd >/dev/null && log "auditd active" || log "auditd not active"

log "done"
