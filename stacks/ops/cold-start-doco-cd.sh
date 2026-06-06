#!/usr/bin/env bash
# Start Doco-CD when GitOps deploy is not yet stamped (uses host plaintext .env).
set -euo pipefail

STACKS="${STACKS:-/opt/stacks}"
CLONE_DIR="${CLONE_DIR:-/opt/hcloud-security-cluster}"
DIR="${CLONE_DIR}/stacks/doco-cd"
ENV_FILE="${STACKS}/doco-cd/.env"

[[ -f "${ENV_FILE}" ]] || { echo "missing ${ENV_FILE}" >&2; exit 1; }

args=(-f compose.yaml)
[[ -f "${DIR}/compose.sops.yaml" ]] && args+=(-f compose.sops.yaml)
[[ -f "${DIR}/compose.install.yaml" ]] && args+=(-f compose.install.yaml)

(
  cd "${DIR}"
  docker compose -p hcloud-doco-cd --env-file "${ENV_FILE}" "${args[@]}" up -d
)
