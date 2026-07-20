#!/usr/bin/env bash
# Exit non-zero if core platform containers or HTTPS health checks fail.
set -euo pipefail

fail=0
check_ctn() {
  local name="$1"
  if docker ps --filter "name=^${name}$" --filter status=running -q | grep -q .; then
    printf 'OK  container %s\n' "${name}"
  else
    printf 'FAIL container %s\n' "${name}" >&2
    fail=1
  fi
}

for c in traefik doco-cd authentik-server authentik-worker authentik-postgresql \
  openbao openbao-postgresql powerdns-authoritative powerdns-postgresql alloy; do
  check_ctn "${c}"
done

check_url() {
  local url="$1"
  local code
  code="$(curl -sk -o /dev/null -w '%{http_code}' "${url}")"
  if [[ "${code}" =~ ^(200|302|401|403)$ ]]; then
    printf 'OK  %s (%s)\n' "${url}" "${code}"
  else
    printf 'FAIL %s (%s)\n' "${url}" "${code}" >&2
    fail=1
  fi
}

check_url "https://auth.goodmanners.services/"
check_url "https://keeper.goodmanners.services/v1/sys/health"
check_url "https://doco-cd.goodmanners.services/v1/health"
check_url "https://pdns.goodmanners.services/"

exit "${fail}"
