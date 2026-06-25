#!/usr/bin/env bash
set -euo pipefail

DB_PATH="/opt/quotation-mvp/prisma/dev.db"
BACKUP_DIR="/opt/quotation-mvp/backups"
LOG_DIR="/opt/quotation-mvp/logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/dev-${TIMESTAMP}.db"
KEEP_DAYS=30

mkdir -p "${BACKUP_DIR}" "${LOG_DIR}"

# Use SQLite .backup command for safe live backup.
sqlite3 "${DB_PATH}" ".backup '${BACKUP_FILE}'"

gzip "${BACKUP_FILE}"

find "${BACKUP_DIR}" -name "dev-*.db.gz" -mtime +${KEEP_DAYS} -delete

echo "[$(date)] Backup complete: ${BACKUP_FILE}.gz"
