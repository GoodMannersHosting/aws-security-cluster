#!/usr/bin/env bash
# Remove orphan Authentik blueprint instances and macOS AppleDouble junk.
set -euo pipefail

BLUEPRINTS_DIR="${1:-/opt/hcloud-security-cluster/authentik/blueprints}"

if [[ -d "${BLUEPRINTS_DIR}" ]]; then
  find "${BLUEPRINTS_DIR}" -name '._*' -delete
fi

docker exec authentik-worker ak shell -c "
from authentik.blueprints.models import BlueprintInstance
orphans = BlueprintInstance.objects.filter(path='')
for row in orphans:
    print(f'removing orphan blueprint: {row.name!r}')
    row.delete()
" 2>/dev/null || echo "authentik-worker not running; skip orphan cleanup"
