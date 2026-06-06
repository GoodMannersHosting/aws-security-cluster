#!/usr/bin/env bash
# One-shot: redeploy Doco-CD with /opt/stacks mount, then reconcile all stacks.
set -euo pipefail

CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
STACKS="${STACKS:-/opt/stacks}"
DOCO_ENV="${STACKS}/doco-cd/.env"
OPS_DIR="${CLONE_DIR}/stacks/ops"

log() { printf '==> %s\n' "$*"; }

log "Update repo ${CLONE_DIR}"
git -C "${CLONE_DIR}" fetch origin main
git -C "${CLONE_DIR}" checkout main
git -C "${CLONE_DIR}" pull --ff-only origin main
chmod +x "${OPS_DIR}"/*.sh

log "Redeploy Doco-CD (needs /opt/stacks mount for GitOps env_files)"
(
  cd "${CLONE_DIR}/stacks/doco-cd"
  args=(-f compose.yaml)
  [[ -f sops_age_key.txt ]] && args+=(-f compose.sops.yaml)
  docker compose --env-file "${DOCO_ENV}" "${args[@]}" up -d
)

sleep 2
"${OPS_DIR}/reconcile-gitops.sh" || true
"${OPS_DIR}/verify-gitops.sh"
