#!/usr/bin/env bash
# Verify keeper runs stacks via Doco-CD GitOps (not legacy /opt/stacks compose).
set -euo pipefail

CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
REPO_SLUG="${REPO_SLUG:-GoodMannersHosting/aws-security-cluster}"
DOCO_CLONE="${DOCO_CLONE:-/var/lib/docker/volumes/doco-cd_doco_cd_data/_data/github.com/${REPO_SLUG}}"
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
  if ! docker compose ls --format json 2>/dev/null \
    | jq -e '.[] | select(.Name=="hcloud-doco-cd")' >/dev/null 2>&1; then
    warn "hcloud-doco-cd compose project missing (Doco-CD not GitOps-managed)"
  else
    ok "hcloud-doco-cd compose project present"
  fi
fi

if [[ ! -d "${CLONE_DIR}/.git" ]]; then
  warn "missing host ops clone at ${CLONE_DIR}"
else
  ok "host ops clone present at ${CLONE_DIR}"
  behind="$(git -C "${CLONE_DIR}" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
  if [[ "${behind}" -gt 0 ]]; then
    warn "host clone is ${behind} commit(s) behind origin/main"
  else
    ok "host clone matches origin/main"
  fi
fi

if [[ ! -d "${DOCO_CLONE}/.git" ]]; then
  warn "Doco-CD deploy clone missing at ${DOCO_CLONE}"
else
  ok "Doco-CD deploy clone present"
  branch="$(git -C "${DOCO_CLONE}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  if [[ "${branch}" != "main" ]]; then
    warn "Doco-CD clone on branch ${branch}, expected main"
  else
    ok "Doco-CD clone on main"
  fi
  doco_sha="$(git -C "${DOCO_CLONE}" rev-parse HEAD 2>/dev/null || echo "")"
  host_sha="$(git -C "${CLONE_DIR}" rev-parse HEAD 2>/dev/null || echo "")"
  if [[ -n "${doco_sha}" && -n "${host_sha}" && "${doco_sha}" != "${host_sha}" ]]; then
    warn "Doco-CD clone (${doco_sha:0:7}) differs from host clone (${host_sha:0:7})"
  elif [[ -n "${doco_sha}" ]]; then
    ok "Doco-CD clone at ${doco_sha:0:7} (matches host)"
  fi
fi

for legacy in \
  "${STACKS}/traefik/docker-compose.yaml" \
  "${STACKS}/authentik/compose.yaml" \
  "${STACKS}/openbao/compose.yaml"; do
  if [[ -f "${legacy}" ]]; then
    warn "legacy manual compose still present: ${legacy}"
  fi
done

while read -r project configs; do
  [[ -z "${project}" ]] && continue
  if [[ "${project}" == "doco-cd" ]]; then
    warn "legacy compose project doco-cd still present (expected hcloud-doco-cd)"
    continue
  fi
  if grep -q "${STACKS}/" <<<"${configs}" && grep -q 'compose' <<<"${configs}"; then
    warn "project ${project} uses /opt/stacks compose: ${configs}"
  fi
  if ! grep -q "${DOCO_CLONE}/stacks" <<<"${configs}"; then
    warn "project ${project} not using Doco-CD git clone: ${configs}"
  else
    ok "project ${project} deployed from Doco-CD clone"
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
