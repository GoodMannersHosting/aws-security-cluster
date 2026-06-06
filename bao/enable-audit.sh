#!/usr/bin/env bash
# Enable OpenBao file audit device (idempotent). Requires BAO_TOKEN (root or sudo).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${CONFIG:-$ROOT/config.env}"

die() { echo "error: $*" >&2; exit 1; }

load_config() {
  [[ -f "$CONFIG" ]] && source "$CONFIG"
  export BAO_ADDR="${BAO_ADDR:-https://keeper.goodmanners.services}"
  if [[ -z "${BAO_TOKEN:-}" && -n "${BAO_TOKEN_FILE:-}" && -f "${BAO_TOKEN_FILE}" ]]; then
    BAO_TOKEN="$(tr -d '[:space:]' < "${BAO_TOKEN_FILE}")"
    export BAO_TOKEN
  fi
  [[ -n "${BAO_TOKEN:-}" ]] || die "set BAO_TOKEN or BAO_TOKEN_FILE (root or sudo token)"
}

enable_file_audit() {
  if bao audit list -format=json | grep -q '"file/"'; then
    echo "==> file audit already enabled"
    return
  fi
  echo "==> enabling file audit at /openbao/data/audit.log"
  bao audit enable -path=file file file_path=/openbao/data/audit.log \
    log_raw=false hmac_accessor=true mode=0600
}

main() {
  command -v bao >/dev/null 2>&1 || die "missing bao CLI"
  load_config
  enable_file_audit
  echo "done"
}

main "$@"
