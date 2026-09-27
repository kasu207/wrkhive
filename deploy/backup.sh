#!/usr/bin/env bash
# Konsistente Sicherung der SQLite-Datenbank (Online-Backup, kein Stillstand)
# plus des Verschlüsselungs-Schlüssels. Ablage: ./backups, die letzten 14 bleiben.
#   ./deploy/backup.sh
# Täglich per cron, z. B.:
#   15 3 * * * /opt/wrkhive/deploy/backup.sh >> /var/log/wrkhive-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP=${KEEP:-14}
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p backups
chmod 700 backups

docker exec wrkhive-app node -e '
const Database = require("better-sqlite3");
const db = new Database("/data/wrkhive.db", { readonly: true });
db.backup(process.argv[1]).then(() => { db.close(); }).catch((e) => { console.error(e); process.exit(1); });
' "/data/backup-${stamp}.db"
docker cp "wrkhive-app:/data/backup-${stamp}.db" "backups/wrkhive-${stamp}.db"
docker exec wrkhive-app rm -f "/data/backup-${stamp}.db"
# Nur nötig, wenn APP_SECRET nicht gesetzt ist (dann liegt der Schlüssel im Volume).
docker cp wrkhive-app:/data/.app-secret "backups/app-secret-${stamp}" 2>/dev/null || true
chmod 600 backups/* 2>/dev/null || true

# Alte Sicherungen löschen (die neuesten KEEP bleiben).
prune() {
  find backups -maxdepth 1 -type f -name "$1" -printf '%T@ %p\n' | sort -rn | tail -n +$((KEEP + 1)) | cut -d' ' -f2- | xargs -r rm -f
}
prune 'wrkhive-*.db'
prune 'app-secret-*'
echo "Sicherung: backups/wrkhive-${stamp}.db"
