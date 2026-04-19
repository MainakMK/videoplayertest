#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────
# PostgreSQL backup script for the video platform.
#
# Usage:
#   ./scripts/backup-db.sh                # Backup to /var/backups/videoplayer
#   BACKUP_DIR=/mnt/nas ./scripts/backup-db.sh   # Custom backup directory
#
# Schedule via cron (daily at 2am, keep 30 days):
#   0 2 * * * /path/to/backup-db.sh >> /var/log/backup.log 2>&1
#
# Or via systemd timer:
#   Create /etc/systemd/system/videoplayer-backup.service
#   and     /etc/systemd/system/videoplayer-backup.timer
#
# What it does:
#   1. Runs pg_dump with compression
#   2. Rotates — keeps last N backups (default 30)
#   3. Optionally uploads to S3/R2 if AWS CLI + BACKUP_S3_BUCKET set
#   4. Writes a log line on success/failure
# ──────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/var/backups/videoplayer}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
DB_URL="${DATABASE_URL:-}"
S3_BUCKET="${BACKUP_S3_BUCKET:-}"   # Optional off-site backup destination
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_DIR}/videoplayer-${TIMESTAMP}.sql.gz"

# ── Pre-flight checks ────────────────────────────────────────────────────
if [ -z "${DB_URL}" ]; then
  echo "[$(date -Iseconds)] FATAL: DATABASE_URL env var not set" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "[$(date -Iseconds)] FATAL: pg_dump not installed" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

# ── Run backup ───────────────────────────────────────────────────────────
echo "[$(date -Iseconds)] Starting backup to ${BACKUP_FILE}"

if pg_dump "${DB_URL}" --no-owner --no-acl --format=plain | gzip -9 > "${BACKUP_FILE}.tmp"; then
  mv "${BACKUP_FILE}.tmp" "${BACKUP_FILE}"
  SIZE="$(du -h "${BACKUP_FILE}" | cut -f1)"
  echo "[$(date -Iseconds)] Backup complete: ${BACKUP_FILE} (${SIZE})"
else
  rm -f "${BACKUP_FILE}.tmp"
  echo "[$(date -Iseconds)] FATAL: pg_dump failed" >&2
  exit 1
fi

# ── Off-site upload (optional) ───────────────────────────────────────────
if [ -n "${S3_BUCKET}" ]; then
  if command -v aws >/dev/null 2>&1; then
    echo "[$(date -Iseconds)] Uploading to s3://${S3_BUCKET}/"
    aws s3 cp "${BACKUP_FILE}" "s3://${S3_BUCKET}/videoplayer-${TIMESTAMP}.sql.gz" \
      --storage-class STANDARD_IA \
      || echo "[$(date -Iseconds)] WARN: S3 upload failed (backup still exists locally)" >&2
  else
    echo "[$(date -Iseconds)] WARN: BACKUP_S3_BUCKET set but 'aws' CLI not installed" >&2
  fi
fi

# ── Rotate old backups ───────────────────────────────────────────────────
echo "[$(date -Iseconds)] Rotating backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name 'videoplayer-*.sql.gz' -mtime +${RETENTION_DAYS} -delete

# ── Summary ──────────────────────────────────────────────────────────────
COUNT="$(find "${BACKUP_DIR}" -name 'videoplayer-*.sql.gz' | wc -l)"
TOTAL_SIZE="$(du -sh "${BACKUP_DIR}" | cut -f1)"
echo "[$(date -Iseconds)] Done. ${COUNT} backups retained (${TOTAL_SIZE} total)"
