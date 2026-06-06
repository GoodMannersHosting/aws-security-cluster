#!/usr/bin/env bash
# Install keeper maintenance cron jobs (backup nightly, healthcheck hourly).
set -euo pipefail

OPS_DIR="${1:-/opt/hcloud-security-cluster/stacks/ops}"
CRON_FILE="/etc/cron.d/hcloud-security-cluster"

cat >"${CRON_FILE}" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

0 3 * * * root ${OPS_DIR}/backup.sh >> /var/log/hcloud-backup.log 2>&1
0 * * * * root ${OPS_DIR}/healthcheck.sh >> /var/log/hcloud-health.log 2>&1
EOF

chmod 644 "${CRON_FILE}"
printf 'Installed %s\n' "${CRON_FILE}"
