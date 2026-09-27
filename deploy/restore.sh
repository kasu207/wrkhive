#!/usr/bin/env bash
# Spielt eine Datenbank-Sicherung zurück (auch zum Umzug der lokalen Daten).
#   ./deploy/restore.sh backups/wrkhive-20260101-031500.db
# Wrkhive wird dafür kurz gestoppt. Vorher wird der aktuelle Stand gesichert.
set -euo pipefail
cd "$(dirname "$0")/.."
file=${1:-}
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "Aufruf: ./deploy/restore.sh <sicherung.db>" >&2
  exit 1
fi
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
if ! grep -Eq '^PROXY=external' .env.production; then COMPOSE+=(--profile caddy); fi
# Projektname "wrkhive-prod" (docker-compose.prod.yml) -> Volume-Name.
volume=wrkhive-prod_wrkhive-data

if docker ps --format '{{.Names}}' | grep -qx wrkhive-app; then
  "$(dirname "$0")/backup.sh"
fi
"${COMPOSE[@]}" stop wrkhive
# Bei einem Fehler Wrkhive in jedem Fall wieder starten.
trap '"${COMPOSE[@]}" up -d' ERR
dir="$(cd "$(dirname "$file")" && pwd)"
name="$(basename "$file")"
# Als root kopieren (Sicherungen sind nur für root lesbar), danach dem App-Nutzer (1001) übergeben.
docker run --rm --user 0:0 --entrypoint sh \
  -v "${volume}:/data" -v "${dir}:/restore:ro" wrkhive:prod \
  -c "cp '/restore/${name}' /data/wrkhive.db.restore && rm -f /data/wrkhive.db-wal /data/wrkhive.db-shm && mv /data/wrkhive.db.restore /data/wrkhive.db && chown 1001:1001 /data/wrkhive.db"
trap - ERR
"${COMPOSE[@]}" up -d
echo "Wiederhergestellt aus ${file}. Neue Migrationen laufen beim Start automatisch."
