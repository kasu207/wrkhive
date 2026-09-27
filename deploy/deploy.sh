#!/usr/bin/env bash
# Aktualisiert und startet Wrkhive auf dem Server:
#   Sicherung -> neuester Code -> Image bauen -> Neustart -> Gesundheitsprüfung
# Aufruf im Projektordner oder von überall:  ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

if [ ! -f .env.production ]; then
  echo "Fehlt: .env.production. Vorlage: cp deploy/env.production.example .env.production" >&2
  exit 1
fi
if ! grep -Eq '^APP_SECRET=.{32,}' .env.production; then
  echo "APP_SECRET in .env.production fehlt oder ist zu kurz (openssl rand -base64 48)." >&2
  exit 1
fi

# Sicherung vor jedem Update, sofern Wrkhive schon läuft.
if docker ps --format '{{.Names}}' | grep -qx wrkhive-app; then
  "$(dirname "$0")/backup.sh"
fi

if [ -d .git ]; then
  git pull --ff-only
fi

"${COMPOSE[@]}" up -d --build --remove-orphans
docker image prune -f >/dev/null

echo -n "Warte auf Wrkhive"
status=""
for _ in $(seq 1 90); do
  status=$(docker inspect -f '{{.State.Health.Status}}' wrkhive-app 2>/dev/null || true)
  [ "$status" = "healthy" ] && break
  echo -n "."
  sleep 2
done
echo
if [ "$status" != "healthy" ]; then
  echo "Wrkhive ist nicht gesund (Status: ${status:-unbekannt}). Logs: docker logs wrkhive-app" >&2
  exit 1
fi
domain=$(grep -E '^DOMAIN=' .env.production | cut -d= -f2-)
echo "Wrkhive läuft: https://${domain}"
