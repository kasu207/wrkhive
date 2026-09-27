#!/usr/bin/env bash
# Aktualisiert und startet Wrkhive auf dem Server:
#   Sicherung -> neuester Code -> Image bauen -> Neustart -> Gesundheitsprüfung
# Aufruf im Projektordner oder von überall:  ./deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.production ]; then
  echo "Fehlt: .env.production. Vorlage: cp deploy/env.production.example .env.production" >&2
  exit 1
fi
env_value() { grep -E "^$1=" .env.production | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }

PROXY=$(env_value PROXY)
PROXY=${PROXY:-caddy}
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)
if [ "$PROXY" = "caddy" ]; then
  COMPOSE+=(--profile caddy)
  if [ -z "$(env_value ACME_EMAIL)" ]; then
    echo "ACME_EMAIL in .env.production fehlt (nötig für das HTTPS-Zertifikat)." >&2
    exit 1
  fi
elif [ "$PROXY" != "external" ]; then
  echo "PROXY muss caddy oder external sein (ist: $PROXY)." >&2
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
domain=$(env_value DOMAIN)
if [ "$PROXY" = "external" ]; then
  port=$(env_value APP_PORT)
  echo "Wrkhive läuft lokal auf 127.0.0.1:${port:-3200}. Dein Reverse Proxy muss https://${domain} dorthin weiterleiten."
else
  echo "Wrkhive läuft: https://${domain}"
fi
