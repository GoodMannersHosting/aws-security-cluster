#!/usr/bin/env bash
# One-shot: pull main and reconcile GitOps (Doco-CD self-deploys via .doco-cd.yml).
set -euo pipefail

CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
OPS_DIR="${CLONE_DIR}/stacks/ops"

log() { printf '==> %s\n' "$*"; }

log "Update repo ${CLONE_DIR}"
git -C "${CLONE_DIR}" fetch origin main
git -C "${CLONE_DIR}" checkout main
git -C "${CLONE_DIR}" pull --ff-only origin main
chmod +x "${OPS_DIR}"/*.sh

"${OPS_DIR}/reconcile-gitops.sh"
"${OPS_DIR}/verify-gitops.sh"
