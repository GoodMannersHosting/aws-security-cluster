#!/usr/bin/env bash
# Fix Authentik blueprint mount permissions, remove junk, clear orphan rows.
set -euo pipefail

BLUEPRINTS_DIR="${1:-/opt/hcloud-security-cluster/authentik/blueprints}"
CLONE_ROOT="$(cd "$(dirname "${BLUEPRINTS_DIR}")/.." && pwd)"

log() { printf '==> %s\n' "$*"; }

fix_permissions() {
  [[ -d "${BLUEPRINTS_DIR}" ]] || {
    echo "missing blueprint dir: ${BLUEPRINTS_DIR}" >&2
    return 1
  }
  log "permissions on ${BLUEPRINTS_DIR}"
  find "${BLUEPRINTS_DIR}" -type d -exec chmod 755 {} +
  find "${BLUEPRINTS_DIR}" -type f \( -name '*.yaml' -o -name '*.yml' \) \
    -exec chmod 644 {} +
  # Worker must traverse the bind-mount path (non-root uids need o+rx on parents).
  local path="${BLUEPRINTS_DIR}"
  while [[ "${path}" != "/" ]]; do
    chmod o+rx "${path}" 2>/dev/null || true
    path="$(dirname "${path}")"
  done
  log "blueprint files:"
  ls -la "${BLUEPRINTS_DIR}"
}

remove_junk() {
  [[ -d "${BLUEPRINTS_DIR}" ]] || return 0
  find "${BLUEPRINTS_DIR}" -name '._*' -delete
}

clear_orphans() {
  docker exec authentik-worker ak shell -c "
from authentik.blueprints.models import BlueprintInstance
orphans = BlueprintInstance.objects.filter(path='')
for row in orphans:
    print(f'removing orphan blueprint: {row.name!r}')
    row.delete()
" 2>/dev/null || echo "authentik-worker not running; skip orphan cleanup"
}

show_blueprint_status() {
  docker exec authentik-worker ak shell -c "
from authentik.blueprints.models import BlueprintInstance
for row in BlueprintInstance.objects.order_by('name'):
    print(f'{row.name!r} path={row.path!r} status={row.status}')
" 2>/dev/null || echo "authentik-worker not running; skip status"
}

show_policies() {
  docker exec authentik-worker ak shell -c "
from authentik.policies.models import Policy
for row in Policy.objects.order_by('name'):
    print(row.name)
" 2>/dev/null || echo "authentik-worker not running; skip policy list"
}

main() {
  fix_permissions
  remove_junk
  clear_orphans
  log "blueprint instances"
  show_blueprint_status
  log "expression policies"
  show_policies
  log "restart worker if files changed: docker restart authentik-worker"
}

main "$@"
