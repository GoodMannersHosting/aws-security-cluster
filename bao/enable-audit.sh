#!/usr/bin/env bash
# Ensure OpenBao file audit via declarative server config.
# OpenBao >= 2.3.2 rejects `bao audit enable` unless
# unsafe_allow_api_audit_creation is set — use audit {} in openbao.hcl instead.
set -euo pipefail

OPENBAO_CONFIG="${OPENBAO_CONFIG:-/opt/stacks/openbao/config/openbao.hcl}"
RESTART="${RESTART:-1}"
HEALTH_URL="${HEALTH_URL:-https://keeper.goodmanners.services/v1/sys/health}"

die() { echo "error: $*" >&2; exit 1; }
log() { printf '==> %s\n' "$*"; }

audit_in_config() {
  [[ -f "${OPENBAO_CONFIG}" ]] || return 1
  grep -q 'audit "file"' "${OPENBAO_CONFIG}"
}

append_audit_stanza() {
  cat >>"${OPENBAO_CONFIG}" <<'EOF'

audit "file" "keeper-data" {
  description = "Request audit log on persistent data volume"
  options {
    file_path     = "/openbao/data/audit.log"
    log_raw       = "false"
    hmac_accessor = "true"
    mode          = "0600"
  }
}
EOF
}

prepare_audit_log() {
  local host_data="${OPENBAO_DATA_DIR:-/mnt/data/openbao}"
  local log_file="${host_data}/audit.log"
  install -d -m 0750 "${host_data}"
  if [[ ! -f "${log_file}" ]]; then
    install -m 0600 /dev/null "${log_file}"
  fi
  # openbao UBI image runs as uid 100, gid 1000
  chown 100:1000 "${host_data}" "${log_file}" 2>/dev/null || \
    chown 100:100 "${log_file}" 2>/dev/null || true
  chmod 0750 "${host_data}"
  chmod 0600 "${log_file}"
}

ensure_audit_config() {
  [[ -f "${OPENBAO_CONFIG}" ]] || die "missing ${OPENBAO_CONFIG}"
  if audit_in_config; then
    log "file audit stanza already in ${OPENBAO_CONFIG}"
    return 1
  fi
  log "adding file audit stanza to ${OPENBAO_CONFIG}"
  cp -a "${OPENBAO_CONFIG}" \
    "${OPENBAO_CONFIG}.bak.$(date +%Y%m%d%H%M%S)"
  append_audit_stanza
  return 0
}

reload_openbao() {
  command -v docker >/dev/null 2>&1 || die "missing docker"
  log "restarting openbao to apply audit config"
  docker restart openbao
  local i
  for i in $(seq 1 30); do
    if curl -fsS "${HEALTH_URL}" >/dev/null 2>&1; then
      log "openbao healthy"
      return 0
    fi
    sleep 2
  done
  die "openbao did not become healthy after restart"
}

health_ok() {
  curl -fsS "${HEALTH_URL}" >/dev/null 2>&1
}

main() {
  prepare_audit_log
  local changed=0
  ensure_audit_config && changed=1 || true
  if [[ "${RESTART}" != "1" ]]; then
    log "done (RESTART=0)"
    return 0
  fi
  if [[ "${changed}" -eq 1 ]] || ! health_ok; then
    reload_openbao
  else
    log "openbao healthy; no restart needed"
  fi
  log "done"
}

main "$@"
