#!/usr/bin/env bash
# Generate stack secrets into /opt/stack-env. Run on the VPS after bootstrap.
set -euo pipefail

STACK_ENV_DIR="${STACK_ENV_DIR:-/opt/stack-env}"
need_openssl() { command -v openssl >/dev/null || { echo "openssl required" >&2; exit 1; }; }

set_if_empty() {
  local file="$1" key="$2" value="$3"
  if grep -q "^${key}=" "$file" && ! grep -q "^${key}=$" "$file"; then
    return
  fi
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
    rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

need_openssl
mkdir -p "${STACK_ENV_DIR}"

for f in traefik postgres authentik openbao doco-cd; do
  [[ -f "${STACK_ENV_DIR}/${f}.env" ]] || touch "${STACK_ENV_DIR}/${f}.env"
  chmod 600 "${STACK_ENV_DIR}/${f}.env"
done

set_if_empty "${STACK_ENV_DIR}/authentik.env" AUTHENTIK_SECRET_KEY \
  "$(openssl rand -base64 48 | tr -d '\n')"
set_if_empty "${STACK_ENV_DIR}/authentik.env" PG_PASS \
  "$(openssl rand -base64 32 | tr -d '\n')"
set_if_empty "${STACK_ENV_DIR}/postgres.env" POSTGRES_SUPERUSER_PASSWORD \
  "$(openssl rand -base64 32 | tr -d '\n')"
set_if_empty "${STACK_ENV_DIR}/postgres.env" AUTHENTIK_POSTGRES_PASSWORD \
  "$(openssl rand -base64 32 | tr -d '\n')"
set_if_empty "${STACK_ENV_DIR}/postgres.env" OPENBAO_POSTGRES_PASSWORD \
  "$(openssl rand -base64 32 | tr -d '\n')"
set_if_empty "${STACK_ENV_DIR}/doco-cd.env" WEBHOOK_SECRET \
  "$(openssl rand -base64 40 | tr -d '\n')"

echo "Secrets generated where values were empty."
echo "Review ${STACK_ENV_DIR}/*.env before production use."
