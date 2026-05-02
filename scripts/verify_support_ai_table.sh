#!/usr/bin/env bash
set -eu
cd /opt/joypick
set -a
# shellcheck source=/dev/null
. ./.env 2>/dev/null || true
set +a
mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
  -Bse "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'support_ai_messages';"
