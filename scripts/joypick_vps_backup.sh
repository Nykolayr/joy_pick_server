#!/bin/bash
# Автобэкап joypick на VPS (Beget и др.): MySQL + uploads + .env
# Cron (ежедневно в 03:10 МСK ≈ 00:10 UTC): 10 0 * * * /bin/bash /opt/joypick/scripts/joypick_vps_backup.sh >> /opt/joypick/backups/backup.log 2>&1
#
# Пароли только из /opt/joypick/.env — в git не коммитить.

set -euo pipefail

JOY_ROOT="${JOY_ROOT:-/opt/joypick}"
BACKUP_DIR="${BACKUP_DIR:-$JOY_ROOT/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ENV_FILE="${ENV_FILE:-$JOY_ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[backup] ERROR: нет $ENV_FILE"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:?DB_USER не задан в .env}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD не задан в .env}"
DB_NAME="${DB_NAME:?DB_NAME не задан в .env}"

STAMP="$(date +%F-%H%M%S)"
STAGING="$BACKUP_DIR/.staging-$STAMP"
ARCHIVE="$BACKUP_DIR/joypick-$STAMP-autobackup.tar.gz"

mkdir -p "$BACKUP_DIR" "$STAGING"

echo "[backup] $STAMP start"

mysqldump \
  -h "$DB_HOST" \
  -P "$DB_PORT" \
  -u "$DB_USER" \
  -p"$DB_PASSWORD" \
  --single-transaction \
  --no-tablespaces \
  --routines \
  --triggers \
  --default-character-set=utf8mb4 \
  "$DB_NAME" > "$STAGING/dump.sql"

# Минимум для восстановления после инцидента с uploads
if [[ -d "$JOY_ROOT/uploads" ]]; then
  cp -a "$JOY_ROOT/uploads" "$STAGING/uploads"
fi
if [[ -f "$JOY_ROOT/.env" ]]; then
  cp -a "$JOY_ROOT/.env" "$STAGING/dotenv"
fi

# Манифест (для проверки после инцидента с uploads)
UPLOAD_PHOTOS_COUNT=0
if [[ -d "$STAGING/uploads/photos" ]]; then
  UPLOAD_PHOTOS_COUNT="$(find "$STAGING/uploads/photos" -type f | wc -l | tr -d ' ')"
fi
{
  echo "generated_at=$STAMP"
  echo "joy_root=$JOY_ROOT"
  echo "db_name=$DB_NAME"
  echo "hostname=$(hostname)"
  echo "upload_photos_files=$UPLOAD_PHOTOS_COUNT"
  du -sh "$STAGING"/* 2>/dev/null || true
} > "$STAGING/MANIFEST.txt"

tar -C "$STAGING" -czf "$ARCHIVE" .
rm -rf "$STAGING"

find "$BACKUP_DIR" -name 'joypick-*-autobackup.tar.gz' -type f -mtime +"$RETENTION_DAYS" -delete

SIZE="$(du -h "$ARCHIVE" | awk '{print $1}')"
echo "[backup] OK $ARCHIVE ($SIZE)"

# Опционально: внешнее копирование (раскомментировать на сервере)
# YANDEX_WEBDAV_USER=... YANDEX_WEBDAV_PASS=... в .env
if [[ -n "${YANDEX_WEBDAV_USER:-}" && -n "${YANDEX_WEBDAV_PASS:-}" ]]; then
  curl -sfS -T "$ARCHIVE" \
    -u "${YANDEX_WEBDAV_USER}:${YANDEX_WEBDAV_PASS}" \
    "https://webdav.yandex.ru/joypick-backups/$(basename "$ARCHIVE")" \
    && echo "[backup] uploaded to Yandex WebDAV" \
    || echo "[backup] WARN: Yandex WebDAV upload failed"
fi
