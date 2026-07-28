#!/usr/bin/env bash
# Backup Postgres, service data, ACME store, and encrypted env copies.
# Optional S3 upload when BACKUP_S3_BUCKET is set (see backup.env.example).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/backup.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/backup.env"
  set +a
fi

BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/keeper}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${BACKUP_ROOT}/${STAMP}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
BACKUP_AWS_CREDS_DIR="${BACKUP_AWS_CREDS_DIR:-${SCRIPT_DIR}/aws}"
BACKUP_AWS_CREDS_FILE="${BACKUP_AWS_CREDS_FILE:-${BACKUP_AWS_CREDS_DIR}/credentials}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-keeper/}"
BACKUP_S3_FULL_BUNDLE="${BACKUP_S3_FULL_BUNDLE:-1}"
BACKUP_S3_REMOVE_LOCAL_ARCHIVE="${BACKUP_S3_REMOVE_LOCAL_ARCHIVE:-1}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'backup: %s\n' "$*" >&2; exit 1; }

mkdir -p "${DEST}"

dump_pg() {
  local ctn="$1" out="$2"
  docker exec "${ctn}" sh -c \
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -Z 9' \
    >"${DEST}/${out}"
}

dump_pg_db() {
  local ctn="$1" db="$2" out="$3"
  docker exec "${ctn}" sh -c \
    "pg_dump -U \"\$POSTGRES_USER\" -d \"${db}\" -Fc -Z 9" \
    >"${DEST}/${out}"
}

log "PostgreSQL dumps (custom format, gzip-compressed)"
dump_pg authentik-postgresql authentik.dump
dump_pg openbao-postgresql openbao.dump
dump_pg powerdns-postgresql powerdns.dump
poweradmin_db="${POWERADMIN_DB:-poweradmin}"
if docker exec powerdns-postgresql sh -c \
  "psql -U \"\$POSTGRES_USER\" -tc \"SELECT 1 FROM pg_database WHERE datname='${poweradmin_db}'\"" \
  | grep -q 1; then
  dump_pg_db powerdns-postgresql "${poweradmin_db}" poweradmin.dump
else
  log "skip poweradmin.dump (${poweradmin_db} not present yet)"
fi

log "Archive data directories"
tar -czf "${DEST}/authentik-data.tgz" \
  -C /mnt/sec-hil-1-authentik data media certs 2>/dev/null || true
tar -czf "${DEST}/openbao-data.tgz" -C /mnt data/openbao 2>/dev/null || true
tar -czf "${DEST}/poweradmin-data.tgz" \
  -C /mnt/data poweradmin 2>/dev/null || true
tar -czf "${DEST}/traefik-acme.tgz" \
  -C /opt/stacks/traefik acme 2>/dev/null || true

if [[ -d /opt/stack-secrets ]]; then
  tar -czf "${DEST}/stack-secrets.tgz" -C /opt stack-secrets
fi

find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d \
  -mtime +"${RETAIN_DAYS}" -exec rm -rf {} +

upload_s3() {
  [[ -n "${BACKUP_S3_BUCKET:-}" ]] || return 0
  [[ -f "${BACKUP_AWS_CREDS_FILE}" ]] || \
    die "BACKUP_S3_BUCKET set but missing ${BACKUP_AWS_CREDS_FILE}"
  [[ -n "${AWS_REGION:-}" ]] || die "set AWS_REGION in backup.env"

  local s3_base="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}${STAMP}"
  local aws_env=(
    AWS_DEFAULT_REGION="${AWS_REGION}"
    AWS_SHARED_CREDENTIALS_FILE="${BACKUP_AWS_CREDS_FILE}"
    AWS_CONFIG_FILE="${BACKUP_AWS_CONFIG:-/dev/null}"
  )
  local sse_args=(--sse AES256)
  if [[ -n "${BACKUP_S3_STORAGE_CLASS:-}" ]]; then
    sse_args+=(--storage-class "${BACKUP_S3_STORAGE_CLASS}")
  fi

  s3_cp() {
    local src="$1" s3_dest="$2"
    if ! command -v aws >/dev/null 2>&1; then
      die "AWS CLI v2 required for IAM Roles Anywhere credential_process"
    fi
    env "${aws_env[@]}" aws s3 cp "${src}" "${s3_dest}" \
      "${sse_args[@]}"
  }

  log "Upload PostgreSQL dumps to ${s3_base}/"
  s3_cp "${DEST}/authentik.dump" "${s3_base}/authentik.dump"
  s3_cp "${DEST}/openbao.dump" "${s3_base}/openbao.dump"
  s3_cp "${DEST}/powerdns.dump" "${s3_base}/powerdns.dump"
  if [[ -f "${DEST}/poweradmin.dump" ]]; then
    s3_cp "${DEST}/poweradmin.dump" "${s3_base}/poweradmin.dump"
  fi

  if [[ "${BACKUP_S3_FULL_BUNDLE}" == "1" ]]; then
    local bundle="${BACKUP_ROOT}/keeper-${STAMP}.tar.gz"
    log "Create compressed full backup bundle"
    tar -czf "${bundle}" -C "${BACKUP_ROOT}" "${STAMP}"
    s3_cp "${bundle}" "${s3_base}/keeper-${STAMP}.tar.gz"
    if [[ "${BACKUP_S3_REMOVE_LOCAL_ARCHIVE}" == "1" ]]; then
      rm -f "${bundle}"
    fi
  fi

  log "S3 upload complete: ${s3_base}/"
}

upload_s3

log "Backup complete: ${DEST}"
