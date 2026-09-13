#!/usr/bin/env bash
set -Eeuo pipefail

: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"

if [[ -z "${BACKUP_FILE:-}" ]]; then
  BACKUP_FILE="$(find /backups -maxdepth 1 -type f -name '*.dump.enc' -print | sort | tail -n 1)"
fi
: "${BACKUP_FILE:?No encrypted backup found}"

check_db="restore_check_$(date +%s)_$RANDOM"
plain="/tmp/${check_db}.dump"
cleanup() {
  rm -f "$plain"
  dropdb --if-exists "$check_db"
}
trap cleanup EXIT

openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$BACKUP_FILE" -out "$plain" -pass env:BACKUP_ENCRYPTION_KEY
createdb "$check_db"
pg_restore --exit-on-error --no-owner --dbname="$check_db" "$plain"

psql --dbname="$check_db" --set=ON_ERROR_STOP=1 --tuples-only <<'SQL'
SELECT COUNT(*) AS applied_migrations FROM schema_migrations;
SELECT COUNT(*) AS users FROM users;
SQL
