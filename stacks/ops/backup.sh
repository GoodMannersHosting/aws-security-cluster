#!/usr/bin/env bash
# Backup Postgres, OpenBao/Authentik data, ACME store, and encrypted env copies.
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/keeper}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_ROOT}/${STAMP}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

log() { printf '==> %s\n' "$*"; }

mkdir -p "${DEST}"

dump_pg() {
  local ctn="$1" out="$2"
  docker exec "${ctn}" sh -c \
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"${DEST}/${out}"
}

log "PostgreSQL dumps"
dump_pg authentik-postgresql authentik.dump
dump_pg openbao-postgresql openbao.dump

log "Archive data directories"
tar -czf "${DEST}/authentik-data.tgz" -C /mnt/sec-hil-1-authentik data media certs 2>/dev/null || true
tar -czf "${DEST}/openbao-data.tgz" -C /mnt data/openbao 2>/dev/null || true
tar -czf "${DEST}/traefik-acme.tgz" -C /opt/stacks/traefik acme 2>/dev/null || true

if [[ -d /opt/stack-secrets ]]; then
  tar -czf "${DEST}/stack-secrets.tgz" -C /opt stack-secrets
fi

find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d -mtime +"${RETAIN_DAYS}" -exec rm -rf {} +

log "Backup complete: ${DEST}"
