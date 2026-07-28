#!/usr/bin/env bash
# Idempotent host hardening for keeper.goodmanners.services.
# Steps: unattended upgrades, secret permissions, Docker daemon, sysctl, auditd.
# Run as root: sudo bash stacks/ops/harden-host.sh
set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILES_DIR="${OPS_DIR}/files"
STACKS="${STACKS:-/opt/stacks}"
BACKUPS="${BACKUPS:-/opt/backups/keeper}"
DOCKER_RESTART="${DOCKER_RESTART:-0}"

log() { printf '==> %s\n' "$*"; }
need_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || {
    echo "run as root" >&2
    exit 1
  }
}

install_unattended_upgrades() {
  log "unattended security upgrades"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq unattended-upgrades apt-listchanges
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  cat >/etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
    "${distro_id}ESM:${distro_codename}-infra-security";
};
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
  systemctl enable unattended-upgrades
  systemctl restart unattended-upgrades
}

fix_secret_permissions() {
  log "secret and stack file permissions"
  mkdir -p "${STACKS}"/{traefik,authentik,openbao,powerdns,alloy,doco-cd} \
    /opt/stack-secrets "${BACKUPS}"
  chmod 700 /opt/stack-secrets "${BACKUPS}" 2>/dev/null || true
  for env in traefik authentik openbao powerdns alloy doco-cd; do
    [[ -f "${STACKS}/${env}/.env" ]] && chmod 600 "${STACKS}/${env}/.env"
  done
  if [[ -d "${STACKS}/openbao/aws" ]]; then
    find "${STACKS}/openbao/aws" -type f -exec chmod 600 {} +
  fi
  if [[ -d "${OPS_DIR}/aws" ]]; then
    find "${OPS_DIR}/aws" -type f -exec chmod 600 {} +
    signing_helper="${OPS_DIR}/aws/aws_signing_helper"
    [[ -f "${signing_helper}" ]] && chmod 700 "${signing_helper}"
  fi
  [[ -f "${OPS_DIR}/backup.env" ]] && chmod 600 "${OPS_DIR}/backup.env"
  [[ -f "${STACKS}/doco-cd/sops_age_key.txt" ]] && \
    chmod 600 "${STACKS}/doco-cd/sops_age_key.txt"
  [[ -f /opt/stack-secrets/bao-admin.token ]] && \
    chmod 600 /opt/stack-secrets/bao-admin.token
  if [[ -d /opt/stack-secrets/alloy-approle ]]; then
    chmod 700 /opt/stack-secrets/alloy-approle
    chmod 600 /opt/stack-secrets/alloy-approle/* 2>/dev/null || true
  fi
  for acme in \
    "${STACKS}/traefik/acme/acme.json" \
    "${STACKS}/traefik/acme.json"; do
    [[ -f "${acme}" ]] && chmod 600 "${acme}"
  done
  chown -R root:root "${STACKS}" /opt/stack-secrets 2>/dev/null || true
}

configure_docker_daemon() {
  log "Docker daemon hardening"
  need_cmd docker
  install -d -m 0755 /etc/docker
  if [[ -f /etc/docker/daemon.json ]] && ! cmp -s \
    "${FILES_DIR}/docker-daemon.json" /etc/docker/daemon.json; then
    cp -a /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%Y%m%d)"
  fi
  install -m 0644 "${FILES_DIR}/docker-daemon.json" /etc/docker/daemon.json
  if [[ "${DOCKER_RESTART}" == "1" ]]; then
    log "restarting Docker (DOCKER_RESTART=1)"
    systemctl restart docker
  else
    log "Docker config written; restart manually during a window:"
    log "  systemctl restart docker"
  fi
  log "checking for unexpected published ports"
  if docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null \
    | grep -E '0\.0\.0\.0:[0-9]+->' \
    | grep -vE '0\.0\.0\.0:(80|443)->'; then
    echo "warning: non-HTTP ports bound on 0.0.0.0 (see above)" >&2
  fi
}

apply_sysctl() {
  log "kernel sysctl hardening"
  install -m 0644 "${FILES_DIR}/99-hardening.sysctl.conf" \
    /etc/sysctl.d/99-hardening.conf
  sysctl --system >/dev/null
}

configure_auditd() {
  log "auditd rules for sensitive paths"
  apt-get install -y -qq auditd audispd-plugins
  install -m 0640 "${FILES_DIR}/keeper-audit.rules" \
    /etc/audit/rules.d/keeper.rules
  augenrules --load >/dev/null 2>&1 || true
  systemctl enable auditd
  systemctl restart auditd
}

verify_app_secrets() {
  log "app-layer secret checks"
  local doco_env="${STACKS}/doco-cd/.env" secret_len
  if [[ -f "${doco_env}" ]]; then
    # shellcheck disable=SC1090
    source "${doco_env}"
    secret_len="${#WEBHOOK_SECRET}"
    if (( secret_len < 32 )); then
      echo "warning: WEBHOOK_SECRET shorter than 32 chars" >&2
    fi
  fi
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "missing: $1" >&2
    exit 1
  }
}

main() {
  need_root
  install_unattended_upgrades
  fix_secret_permissions
  configure_docker_daemon
  apply_sysctl
  configure_auditd
  verify_app_secrets
  log "done"
}

main "$@"
