#!/usr/bin/env bash
# Creates the Poweradmin app DB alongside the PowerDNS schema DB.
# Only runs on first Postgres data init (empty volume).
set -euo pipefail

db="${POWERADMIN_DB:-poweradmin}"
case "${db}" in
  *[!a-zA-Z0-9_]* | "")
    echo "invalid POWERADMIN_DB: ${db}" >&2
    exit 1
    ;;
esac

exists="$(psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '${db}'")"

if [ "${exists}" = "1" ]; then
  echo "database ${db} already exists"
  exit 0
fi

psql -v ON_ERROR_STOP=1 --username "${POSTGRES_USER}" \
  -c "CREATE DATABASE ${db} OWNER \"${POSTGRES_USER}\""
echo "created database ${db}"
