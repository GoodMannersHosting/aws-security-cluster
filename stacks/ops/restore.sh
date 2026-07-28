#!/usr/bin/env bash
# Restore keeper from a local backup directory or S3 prefix (see BACKUP-RESTORE.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/backup.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/backup.env"
  set +a
fi

BACKUP_ROOT="${BACKUP_ROOT:-/opt/backups/keeper}"
BACKUP_AWS_CREDS_DIR="${BACKUP_AWS_CREDS_DIR:-${SCRIPT_DIR}/aws}"
BACKUP_AWS_CREDS_FILE="${BACKUP_AWS_CREDS_FILE:-${BACKUP_AWS_CREDS_DIR}/credentials}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-keeper/}"
DRY_RUN="${DRY_RUN:-0}"
STOP_STACKS="${STOP_STACKS:-1}"

usage() {
  cat <<'EOF'
Usage: restore.sh [--dry-run] [--from-s3 STAMP] [BACKUP_DIR]

  BACKUP_DIR     Local path like /opt/backups/keeper/20260606T030001Z
  --from-s3 STAMP  Download s3://BUCKET/keeper/STAMP/ (needs backup.env)
  --dry-run      Print actions only
  --keep-running Do not stop Postgres containers before restore

Requires root on keeper. Read stacks/ops/BACKUP-RESTORE.md first.
EOF
}

log() { printf '==> %s\n' "$*"; }
run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf 'DRY  %s\n' "$*"
  else
    "$@"
  fi
}

die() { printf 'restore: %s\n' "$*" >&2; exit 1; }

fetch_s3_backup() {
  local stamp="$1"
  [[ -n "${BACKUP_S3_BUCKET:-}" ]] || die "BACKUP_S3_BUCKET not set in backup.env"
  [[ -f "${BACKUP_AWS_CREDS_FILE}" ]] || die "missing ${BACKUP_AWS_CREDS_FILE}"
  local dest="${BACKUP_ROOT}/${stamp}"
  local s3_base="s3://${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX}${stamp}"
  local aws_env=(
    AWS_DEFAULT_REGION="${AWS_REGION:?set AWS_REGION}"
    AWS_SHARED_CREDENTIALS_FILE="${BACKUP_AWS_CREDS_FILE}"
    AWS_CONFIG_FILE="${AWS_CONFIG_FILE:-/dev/null}"
  )
  mkdir -p "${dest}"
  log "Download ${s3_base}/"
  run env "${aws_env[@]}" aws s3 cp "${s3_base}/authentik.dump" "${dest}/authentik.dump"
  run env "${aws_env[@]}" aws s3 cp "${s3_base}/openbao.dump" "${dest}/openbao.dump"
  run env "${aws_env[@]}" aws s3 cp "${s3_base}/powerdns.dump" "${dest}/powerdns.dump"
  if env "${aws_env[@]}" aws s3 ls "${s3_base}/poweradmin.dump" >/dev/null 2>&1; then
    run env "${aws_env[@]}" aws s3 cp "${s3_base}/poweradmin.dump" "${dest}/poweradmin.dump"
  fi
  local bundle="${BACKUP_ROOT}/keeper-${stamp}.tar.gz"
  if env "${aws_env[@]}" aws s3 ls "${s3_base}/keeper-${stamp}.tar.gz" >/dev/null 2>&1; then
    run env "${aws_env[@]}" aws s3 cp \
      "${s3_base}/keeper-${stamp}.tar.gz" "${bundle}"
    run tar -xzf "${bundle}" -C "${BACKUP_ROOT}"
    rm -f "${bundle}"
  fi
  printf '%s\n' "${dest}"
}

restore_pg() {
  local ctn="$1" dump="$2"
  [[ -f "${dump}" ]] || die "missing ${dump}"
  log "Restore PostgreSQL ${ctn} from ${dump}"
  if [[ "${STOP_STACKS}" == "1" ]]; then
    run docker stop "${ctn}"
    run docker start "${ctn}"
    sleep 5
  fi
  run docker exec -i "${ctn}" sh -c \
    'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
    <"${dump}"
}

restore_pg_db() {
  local ctn="$1" dump="$2" db="$3"
  [[ -f "${dump}" ]] || die "missing ${dump}"
  log "Restore PostgreSQL ${ctn}/${db} from ${dump}"
  if [[ "${STOP_STACKS}" == "1" ]]; then
    run docker stop "${ctn}"
    run docker start "${ctn}"
    sleep 5
  fi
  run docker exec "${ctn}" sh -c \
    "psql -U \"\$POSTGRES_USER\" -tc \"SELECT 1 FROM pg_database WHERE datname='${db}'\" | grep -q 1 || \
     psql -U \"\$POSTGRES_USER\" -c \"CREATE DATABASE ${db} OWNER \\\"\$POSTGRES_USER\\\"\""
  run docker exec -i "${ctn}" sh -c \
    "pg_restore -U \"\$POSTGRES_USER\" -d \"${db}\" --clean --if-exists" \
    <"${dump}"
}

restore_tar() {
  local archive="$1" dest_parent="$2"
  [[ -f "${archive}" ]] || return 0
  log "Extract ${archive} -> ${dest_parent}"
  run mkdir -p "${dest_parent}"
  run tar -xzf "${archive}" -C "${dest_parent}"
}

main() {
  [[ "${EUID:-$(id -u)}" -eq 0 ]] || die "run as root on keeper"
  local backup_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run) DRY_RUN=1; shift ;;
      --keep-running) STOP_STACKS=0; shift ;;
      --from-s3)
        shift
        [[ $# -gt 0 ]] || die "--from-s3 requires STAMP"
        backup_dir="$(fetch_s3_backup "$1")"
        shift
        ;;
      -h|--help) usage; exit 0 ;;
      *)
        backup_dir="$1"
        shift
        ;;
    esac
  done
  [[ -n "${backup_dir}" ]] || die "specify BACKUP_DIR or --from-s3 STAMP"
  [[ -d "${backup_dir}" ]] || die "not a directory: ${backup_dir}"

  log "Restore from ${backup_dir}"
  [[ -f "${backup_dir}/authentik.dump" ]] || die "missing authentik.dump"
  [[ -f "${backup_dir}/openbao.dump" ]] || die "missing openbao.dump"
  [[ -f "${backup_dir}/powerdns.dump" ]] || die "missing powerdns.dump"

  if [[ "${STOP_STACKS}" == "1" && "${DRY_RUN}" != "1" ]]; then
    log "Stopping application containers (Postgres stays up)"
    docker stop openbao authentik-server authentik-worker \
      powerdns-authoritative poweradmin traefik doco-cd alloy \
      2>/dev/null || true
  fi

  restore_pg authentik-postgresql "${backup_dir}/authentik.dump"
  restore_pg openbao-postgresql "${backup_dir}/openbao.dump"
  restore_pg powerdns-postgresql "${backup_dir}/powerdns.dump"
  if [[ -f "${backup_dir}/poweradmin.dump" ]]; then
    restore_pg_db powerdns-postgresql "${backup_dir}/poweradmin.dump" \
      "${POWERADMIN_DB:-poweradmin}"
  fi

  restore_tar "${backup_dir}/authentik-data.tgz" /mnt/sec-hil-1-authentik
  restore_tar "${backup_dir}/openbao-data.tgz" /mnt/data
  restore_tar "${backup_dir}/poweradmin-data.tgz" /mnt/data
  restore_tar "${backup_dir}/traefik-acme.tgz" /opt/stacks/traefik
  if [[ -f "${backup_dir}/stack-secrets.tgz" ]]; then
    restore_tar "${backup_dir}/stack-secrets.tgz" /
  fi

  log "Start stacks via Doco-CD reconcile or: docker start ..."
  if [[ "${DRY_RUN}" != "1" ]]; then
    log "Run: bash ${SCRIPT_DIR}/reconcile-gitops.sh"
  fi
  log "done"
}

main "$@"
