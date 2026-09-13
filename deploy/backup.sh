#!/usr/bin/env bash
set -Eeuo pipefail

: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
: "${COS_UPLOAD_COMMAND:?COS_UPLOAD_COMMAND is required}"

backup_once() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  plain="/backups/receivables-${timestamp}.dump"
  encrypted="${plain}.enc"
  trap 'rm -f "$plain" "$encrypted"' RETURN

  pg_dump --format=custom --file="$plain"
  openssl enc -aes-256-cbc -pbkdf2 -salt \
    -in "$plain" -out "$encrypted" -pass env:BACKUP_ENCRYPTION_KEY

  # The operator-provided command reads BACKUP_FILE and uploads only encrypted data.
  BACKUP_FILE="$encrypted" bash -c "$COS_UPLOAD_COMMAND"
  rm -f "$plain" "$encrypted"
  trap - RETURN
}

while true; do
  backup_once
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
