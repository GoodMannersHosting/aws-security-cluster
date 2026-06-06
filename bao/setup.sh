#!/usr/bin/env bash
# Apply OpenBao policies, OIDC auth, roles, and identity groups for Authentik SSO.
# Requires: bao CLI, root token (BAO_TOKEN), config.env with Authentik OAuth client creds.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${CONFIG:-$ROOT/config.env}"

die() { echo "error: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing command: $1"
}

load_config() {
  [[ -f "$CONFIG" ]] || die "copy config.env.example to config.env and set values"
  # shellcheck source=/dev/null
  source "$CONFIG"
  [[ -n "${BAO_TOKEN:-}" ]] || die "export BAO_TOKEN (root token) before running"
  [[ -n "${AUTHENTIK_CLIENT_ID:-}" ]] || die "set AUTHENTIK_CLIENT_ID in config.env"
  [[ -n "${AUTHENTIK_CLIENT_SECRET:-}" ]] || die "set AUTHENTIK_CLIENT_SECRET in config.env"
  export BAO_ADDR="${BAO_ADDR:-https://keeper.goodmanners.services}"
}

subst_client_id() {
  python3 -c "
import json, sys
doc = json.load(open(sys.argv[1]))
doc['bound_audiences'] = [sys.argv[2]]
json.dump(doc, sys.stdout)
" "$1" "$AUTHENTIK_CLIENT_ID"
}

write_policies() {
  echo "==> policies"
  for policy in "$ROOT/policies/"*.hcl; do
    name="$(basename "$policy" .hcl)"
    bao policy write "$name" "$policy"
  done
}

enable_kv() {
  if bao secrets list -format=json | grep -q '"secret/"'; then
    echo "==> kv secret/ already enabled"
    return
  fi
  echo "==> enabling kv-v2 at secret/"
  bao secrets enable -path=secret kv-v2
}

enable_oidc() {
  if bao auth list -format=json | grep -q '"oidc/"'; then
    echo "==> oidc auth already enabled"
    return
  fi
  echo "==> enabling oidc auth"
  bao auth enable oidc
}

write_oidc_config() {
  echo "==> oidc config"
  bao write auth/oidc/config \
    oidc_discovery_url="$AUTHENTIK_OIDC_DISCOVERY_URL" \
    oidc_client_id="$AUTHENTIK_CLIENT_ID" \
    oidc_client_secret="$AUTHENTIK_CLIENT_SECRET" \
    default_role="reader"
}

write_oidc_roles() {
  echo "==> oidc roles"
  for role in admin reader operator; do
    subst_client_id "$ROOT/roles/${role}.json" \
      | bao write "auth/oidc/role/${role}" -
  done
}

write_identity_groups() {
  echo "==> identity groups"
  for group in keeper-admin keeper-reader keeper-operator; do
    bao write identity/group @"$ROOT/identity/groups/${group}.json"
  done
}

write_group_aliases() {
  local accessor group_id name
  accessor="$(bao auth list -format=json \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['oidc/']['accessor'])")"
  echo "==> group aliases (mount_accessor=$accessor)"
  for name in keeper-admin keeper-reader keeper-operator; do
    group_id="$(bao read -field=id "identity/group/name/${name}")"
    bao write identity/group-alias \
      name="$name" \
      mount_accessor="$accessor" \
      canonical_id="$group_id"
  done
}

seed_secret_paths() {
  echo "==> secret path layout"
  for path in authentik apps infra; do
    bao kv put "secret/${path}/.keep" initialized=true \
      created_by=setup.sh 2>/dev/null || true
  done
}

main() {
  require_cmd bao
  require_cmd python3
  load_config
  write_policies
  enable_kv
  enable_oidc
  write_oidc_config
  write_oidc_roles
  write_identity_groups
  write_group_aliases
  seed_secret_paths
  echo "done. test: bao login -method=oidc role=reader"
  echo "      CI:   run setup-github-jwt.sh once, then push bao/ changes to main"
}

main "$@"
