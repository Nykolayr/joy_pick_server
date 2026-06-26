#!/bin/bash
# Восстановление из joypick-*-autobackup.tar.gz (MySQL + uploads + .env)
# Использование:
#   bash scripts/joypick_vps_restore.sh /opt/joypick/backups/joypick-2026-06-24-001001-autobackup.tar.gz
#   bash scripts/joypick_vps_restore.sh /path/to/archive.tar.gz --uploads-only
#   bash scripts/joypick_vps_restore.sh /path/to/archive.tar.gz --db-only
#
# Перед --db-only сделайте свой снимок БД. uploads перезаписывает каталог целиком.

set -euo pipefail

ARCHIVE="${1:-}"
MODE="${2:-all}"
JOY_ROOT="${JOY_ROOT:-/opt/joypick}"
ENV_FILE="${ENV_FILE:-$JOY_ROOT/.env}"

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "[restore] ERROR: укажите существующий архив"
  exit 1
fi

case "$MODE" in
  all | --uploads-only | --db-only) ;;
  *)
    echo "[restore] ERROR: режим $MODE неизвестен (all | --uploads-only | --db-only)"
    exit 1
    ;;
esac

STAGING="$(mktemp -d /tmp/joypick-restore-XXXXXX)"
trap 'rm -rf "$STAGING"' EXIT

echo "[restore] extract $ARCHIVE"
tar -xzf "$ARCHIVE" -C "$STAGING"

if [[ -f "$STAGING/MANIFEST.txt" ]]; then
  echo "[restore] MANIFEST:"
  cat "$STAGING/MANIFEST.txt"
fi

if [[ "$MODE" == "all" || "$MODE" == "--uploads-only" ]]; then
  if [[ -d "$STAGING/uploads" ]]; then
    echo "[restore] uploads -> $JOY_ROOT/uploads"
    rm -rf "$JOY_ROOT/uploads"
    cp -a "$STAGING/uploads" "$JOY_ROOT/uploads"
  else
    echo "[restore] WARN: uploads в архиве нет"
  fi
fi

if [[ "$MODE" == "all" || "$MODE" == "--db-only" ]]; then
  if [[ ! -f "$STAGING/dump.sql" ]]; then
    echo "[restore] ERROR: dump.sql в архиве нет"
    exit 1
  fi
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "[restore] ERROR: нет $ENV_FILE для mysql"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  DB_HOST="${DB_HOST:-localhost}"
  DB_PORT="${DB_PORT:-3306}"
  DB_USER="${DB_USER:?}"
  DB_PASSWORD="${DB_PASSWORD:?}"
  DB_NAME="${DB_NAME:?}"
  echo "[restore] mysql import -> $DB_NAME"
  mysql -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" < "$STAGING/dump.sql"
fi

if [[ "$MODE" == "all" && -f "$STAGING/dotenv" ]]; then
  echo "[restore] dotenv сохранён в $STAGING/dotenv (в $ENV_FILE не перезаписываем автоматически)"
fi

echo "[restore] OK"
