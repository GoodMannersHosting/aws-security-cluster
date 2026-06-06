#!/usr/bin/env bash
# Verify keeper runs stacks via Doco-CD GitOps (not legacy /opt/stacks compose).
set -euo pipefail

CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
STACKS="${STACKS:-/opt/stacks}"
fail=0

warn() { printf 'WARN %s\n' "$*" >&2; fail=1; }
ok() { printf 'OK   %s\n' "$*"; }

if ! docker ps --filter name=^doco-cd$ --filter status=running -q | grep -q .; then
  warn "doco-cd container is not running"
else
  ok "doco-cd container running"
  if docker inspect doco-cd --format '{{range .Mounts}}{{.Destination}} {{end}}' \
    | grep -qw '/opt/stacks'; then
    ok "doco-cd mounts /opt/stacks (env_files visible in container)"
  else
    warn "doco-cd missing /opt/stacks mount — .doco-cd.yml env_files will fail"
  fi
fi

if [[ ! -d "${CLONE_DIR}/.git" ]]; then
  warn "missing git clone at ${CLONE_DIR}"
else
  ok "host clone present at ${CLONE_DIR}"
  behind="$(git -C "${CLONE_DIR}" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
  if [[ "${behind}" -gt 0 ]]; then
    warn "host clone is ${behind} commit(s) behind origin/main"
  else
    ok "host clone matches origin/main"
  fi
fi

for legacy in \
  "${STACKS}/traefik/docker-compose.yaml" \
  "${STACKS}/authentik/compose.yaml"; do
  if [[ -f "${legacy}" ]]; then
    warn "legacy manual compose still present: ${legacy}"
  fi
done

while read -r project configs; do
  [[ -z "${project}" ]] && continue
  case "${project}" in
    doco-cd) continue ;;
  esac
  if grep -q "${STACKS}/${project}" <<<"${configs}"; then
    warn "project ${project} uses /opt/stacks compose: ${configs}"
  fi
  if ! grep -q "${CLONE_DIR}/stacks" <<<"${configs}"; then
    warn "project ${project} not using git clone compose: ${configs}"
  fi
done < <(docker compose ls --format json 2>/dev/null \
  | jq -r '.[] | "\(.Name) \(.ConfigFiles)"' 2>/dev/null || docker compose ls 2>/dev/null | tail -n +2)

traefik_env="${STACKS}/traefik/.env"
for key in TRAEFIK_CONFIG_PATH TRAEFIK_DYNAMIC_PATH TRAEFIK_ACME_DIR; do
  if [[ -f "${traefik_env}" ]] && grep -q "^${key}=" "${traefik_env}"; then
    ok "traefik .env has ${key}"
  else
    warn "traefik .env missing ${key} (required for git-based deploys)"
  fi
done

exit "${fail}"
