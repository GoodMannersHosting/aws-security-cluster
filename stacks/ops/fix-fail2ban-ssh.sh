#!/usr/bin/env bash
# Restore SSH when fail2ban leaves REJECT rules or bans admin IPs.
# Run on keeper console as root:
#   ADMIN_IPS="YOUR.IP.HERE/32" bash stacks/ops/fix-fail2ban-ssh.sh
set -euo pipefail

ADMIN_IPS_FILE="${ADMIN_IPS_FILE:-/opt/stacks/ops/admin-ips.txt}"
JAIL_LOCAL="/etc/fail2ban/jail.d/keeper-ssh.local"

log() { printf '==> %s\n' "$*"; }

need_root() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || {
    echo "run as root" >&2
    exit 1
  }
}

collect_ignore_ips() {
  local ips="127.0.0.1/8 ::1"
  if [[ -n "${ADMIN_IPS:-}" ]]; then
    ips="${ips} ${ADMIN_IPS//,/ }"
  fi
  if [[ -f "${ADMIN_IPS_FILE}" ]]; then
    while read -r line; do
      [[ -z "${line}" || "${line}" =~ ^# ]] && continue
      ips="${ips} ${line}"
    done <"${ADMIN_IPS_FILE}"
  fi
  printf '%s' "${ips}"
}

unban_and_stop() {
  log "unban all jails and stop fail2ban"
  if command -v fail2ban-client >/dev/null 2>&1; then
    fail2ban-client unban --all 2>/dev/null || true
    systemctl stop fail2ban
  fi
}

flush_f2b_chains() {
  log "flush leftover f2b iptables chains"
  local chain
  while read -r chain; do
    iptables -F "${chain}" 2>/dev/null || true
    iptables -X "${chain}" 2>/dev/null || true
  done < <(iptables -S 2>/dev/null | awk '/^:f2b-/{print substr($1,2)}' | sort -u)

  while read -r jump; do
    iptables -D INPUT -j "${jump}" 2>/dev/null || true
  done < <(iptables -S INPUT 2>/dev/null | awk '/-j f2b-/{print $NF}' | sort -u)
}

write_jail_local() {
  local ignore_ips
  ignore_ips="$(collect_ignore_ips)"
  log "write ${JAIL_LOCAL} (ignoreip: ${ignore_ips})"
  install -d -m 0755 /etc/fail2ban/jail.d
  cat >"${JAIL_LOCAL}" <<EOF
# Managed by stacks/ops/fix-fail2ban-ssh.sh — keeper admin SSH access
[DEFAULT]
ignoreip = ${ignore_ips}

[sshd]
enabled = true
backend = systemd
maxretry = 10
findtime = 15m
bantime = 1h

[traefik]
enabled = true

[traefik-scanners]
enabled = true
EOF
}

ensure_admin_ips_file() {
  install -d -m 0700 "$(dirname "${ADMIN_IPS_FILE}")"
  if [[ ! -f "${ADMIN_IPS_FILE}" ]]; then
    cat >"${ADMIN_IPS_FILE}" <<'EOF'
# One IPv4/IPv6 or CIDR per line — never banned by fail2ban sshd jail.
# Example:
# 203.0.113.10/32
EOF
    chmod 600 "${ADMIN_IPS_FILE}"
    log "created ${ADMIN_IPS_FILE} — add your home/office IPs"
  fi
}

start_fail2ban() {
  log "start fail2ban"
  systemctl enable fail2ban
  systemctl start fail2ban
  fail2ban-client status sshd || true
}

verify_ssh() {
  log "sshd listeners"
  ss -tlnp | grep ':22' || true
  log "done — retry: ssh root@$(curl -4 -fsS ifconfig.me 2>/dev/null || echo keeper)"
}

main() {
  need_root
  command -v fail2ban-client >/dev/null 2>&1 || {
    echo "fail2ban not installed" >&2
    exit 1
  }
  ensure_admin_ips_file
  unban_and_stop
  flush_f2b_chains
  write_jail_local
  start_fail2ban
  verify_ssh
}

main "$@"
