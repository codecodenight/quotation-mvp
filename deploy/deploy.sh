#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/quotation-mvp"
cd "${APP_DIR}"

echo "[$(date)] Starting deployment..."

mkdir -p logs backups

git pull origin main

npm ci --production=false

npm run build

bash deploy/backup.sh

pm2 reload ecosystem.config.cjs

echo "[$(date)] Deployment complete."
