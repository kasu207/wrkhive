# Wrkhive auf einem eigenen Server (Hetzner, Docker)

Ergebnis: Wrkhive läuft unter `https://deine-domain` mit automatischem HTTPS (Caddy, Let's Encrypt), täglicher Sicherung und Updates per einem Befehl. Nur dein Konto kann sich registrieren, die Demo ist aus.

Voraussetzungen: Linux-Server mit Docker und Docker Compose (Plugin `docker compose`), eine Domain oder Subdomain, SSH-Zugang. Für den Build sollte der Server mindestens 2 GB RAM haben, besser 4 GB (Hetzner CX22). Bei 2 GB vorher Swap anlegen (siehe unten).

## 1. Domain auf den Server zeigen lassen

Beim Domain-Anbieter einen DNS-Eintrag anlegen:

| Typ | Name | Wert |
| --- | --- | --- |
| A | `wrkhive` (oder `@`) | IPv4 des Servers |
| AAAA | `wrkhive` (oder `@`) | IPv6 des Servers (optional) |

Prüfen (auf dem eigenen Rechner): `ping wrkhive.deine-domain.de` muss die Server-IP zeigen.

## 2. Ports freigeben

Wrkhive braucht Port 80 und 443 (für HTTPS und das Zertifikat). In der **Hetzner Cloud Firewall** (falls aktiv) eingehend erlauben: TCP 22, TCP 80, TCP 443, UDP 443.

Läuft auf dem Server schon ein anderer Webserver auf Port 80/443 (z. B. nginx, Traefik, ein anderer Caddy)? Prüfen mit:

```bash
sudo ss -tlnp | grep -E ':(80|443) '
```

Wenn dort etwas steht (z. B. `caddy` oder `nginx`, über den schon andere Seiten laufen), in `.env.production` `PROXY=external` setzen und nach „Server mit bestehendem Reverse Proxy“ unten vorgehen.

## 3. Code auf den Server holen

Das GitHub-Repository ist privat. Der Server bekommt dafür einen eigenen, nur lesenden Schlüssel (Deploy Key):

```bash
ssh root@DEINE_SERVER_IP
ssh-keygen -t ed25519 -f ~/.ssh/wrkhive_deploy -N "" -C "wrkhive-server"
cat ~/.ssh/wrkhive_deploy.pub
```

Den ausgegebenen Schlüssel in GitHub eintragen: Repository `kasu207/wrkhive` → Settings → Deploy keys → Add deploy key, Haken bei „Allow write access“ **nicht** setzen.

Dann klonen:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-wrkhive
  HostName github.com
  User git
  IdentityFile ~/.ssh/wrkhive_deploy
  IdentitiesOnly yes
EOF

git clone -b claude/busy-cray-s2ego9 git@github-wrkhive:kasu207/wrkhive.git /opt/wrkhive
cd /opt/wrkhive
```

(Nach einem Merge nach `main` später einfach `git checkout main` im Ordner.)

## 4. Konfiguration

```bash
cp deploy/env.production.example .env.production
nano .env.production
```

Mindestens ausfüllen:

- `DOMAIN` – z. B. `wrkhive.deine-domain.de`
- `ACME_EMAIL` – deine E-Mail für Let's Encrypt
- `APP_SECRET` – erzeugen mit `openssl rand -base64 48`, Ausgabe einfügen. **Nie wieder ändern**, sonst sind gespeicherte Verbindungen (intervals.icu-Schlüssel, Tokens) nicht mehr lesbar.

Optional: `ANTHROPIC_API_KEY` für den KI-Coach, Wahoo-/Garmin-Zugangsdaten.

Die Datei enthält Geheimnisse; sie wird nicht ins Repository übernommen. Rechte einschränken: `chmod 600 .env.production`.

## 5. Starten

```bash
./deploy/deploy.sh
```

Das Skript baut das Image (beim ersten Mal einige Minuten), startet Wrkhive und Caddy und wartet, bis alles gesund ist. Caddy holt das HTTPS-Zertifikat beim ersten Aufruf automatisch.

Danach `https://deine-domain` öffnen und **sofort dein Konto anlegen**: Mit `SIGNUP_MODE=first` ist die Registrierung nach dem ersten Konto geschlossen. Dein Konto ist damit auch der Besitzer der Installation (darf z. B. die Wahoo-App hinterlegen).

## 6. Tägliche Sicherung

```bash
crontab -e
```

Zeile hinzufügen:

```
15 3 * * * /opt/wrkhive/deploy/backup.sh >> /var/log/wrkhive-backup.log 2>&1
```

Die Sicherungen liegen in `/opt/wrkhive/backups` (die letzten 14). Wer sie zusätzlich außerhalb des Servers haben will: Hetzner Backups für den Server aktivieren oder den Ordner regelmäßig herunterladen, z. B. `scp -r root@SERVER:/opt/wrkhive/backups ./wrkhive-backups`.

Zurückspielen: `./deploy/restore.sh backups/wrkhive-JJJJMMTT-HHMMSS.db`

## 7. Updates

```bash
cd /opt/wrkhive && ./deploy/deploy.sh
```

Sichert zuerst, holt den neuesten Code, baut neu und startet neu. Datenbank-Migrationen laufen automatisch.

## Lokale Daten auf den Server umziehen (optional)

Wer die Aktivitäten, Workouts und Verbindungen aus der lokalen Docker-Desktop-Installation mitnehmen will. Am besten direkt nach Schritt 5 und **bevor** du auf dem Server ein Konto anlegst: Das Zurückspielen ersetzt die komplette Datenbank des Servers. Auf dem **eigenen Rechner** im Projektordner, während die lokale App läuft:

```bash
docker exec wrkhive node -e 'const D=require("better-sqlite3");new D("/data/wrkhive.db",{readonly:true}).backup("/data/export.db").then(()=>console.log("ok"))'
docker cp wrkhive:/data/export.db ./wrkhive-export.db
docker exec wrkhive cat /data/.app-secret; echo
```

Die letzte Zeile zeigt den lokal erzeugten Schlüssel. Ihn auf dem Server in `.env.production` als `APP_SECRET` eintragen (statt eines neuen), damit die gespeicherten Verbindungen lesbar bleiben. Zeigt der Befehl nichts an, war lokal ein eigenes `APP_SECRET` gesetzt; dann dieses verwenden.

Datei hochladen und zurückspielen:

```bash
ssh root@DEINE_SERVER_IP 'mkdir -p /opt/wrkhive/backups'
scp wrkhive-export.db root@DEINE_SERVER_IP:/opt/wrkhive/backups/
ssh root@DEINE_SERVER_IP 'cd /opt/wrkhive && ./deploy/restore.sh backups/wrkhive-export.db'
```

Dein lokales Konto existiert dann auf dem Server; die Registrierung bleibt geschlossen. Die lokale Datei danach löschen.

## Nützliche Befehle

| Zweck | Befehl |
| --- | --- |
| Status | `docker compose -f docker-compose.prod.yml --env-file .env.production ps` |
| Logs der App | `docker logs -f --tail 100 wrkhive-app` |
| Logs von Caddy (Zertifikat) | `docker logs -f --tail 100 wrkhive-caddy` |
| Neustart | `docker compose -f docker-compose.prod.yml --env-file .env.production restart` |
| Stoppen | `docker compose -f docker-compose.prod.yml --env-file .env.production down` (Daten bleiben erhalten) |

Niemals `down -v` verwenden: `-v` löscht die Datenbank.

## Swap für Server mit 2 GB RAM

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## Server mit bestehendem Reverse Proxy

Läuft auf dem Server schon ein Webserver auf Port 80/443 (Fehler beim Start: `failed to bind host port 0.0.0.0:80/tcp: address already in use`), startet Wrkhive ohne eigenen Caddy und dein vorhandener Webserver leitet die Domain weiter.

1. In `.env.production` setzen:
   ```
   PROXY=external
   APP_PORT=3200
   ```
   `APP_PORT` muss ein freier Port sein (prüfen mit `sudo ss -tlnp | grep :3200`). Wrkhive ist darauf nur lokal erreichbar (`127.0.0.1`), nicht aus dem Internet.

2. Den fehlgeschlagenen Caddy-Container entfernen und neu starten:
   ```bash
   docker rm -f wrkhive-caddy 2>/dev/null; ./deploy/deploy.sh
   ```

3. Eintrag im vorhandenen Webserver ergänzen.

   **Caddy auf dem Server** (`/etc/caddy/Caddyfile`), neuer Block am Ende:
   ```
   wrkhive.deine-domain.de {
   	encode zstd gzip
   	request_body {
   		max_size 70MB
   	}
   	reverse_proxy 127.0.0.1:3200
   }
   ```
   Prüfen und übernehmen, ohne die anderen Seiten zu unterbrechen:
   ```bash
   caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy
   ```
   Caddy holt das Zertifikat für die neue Domain selbst und setzt `X-Forwarded-Proto`.

   **nginx:** `proxy_pass http://127.0.0.1:3200;` mit `proxy_set_header Host $host;`, `proxy_set_header X-Forwarded-Proto $scheme;`, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` und `client_max_body_size 70m;`, Zertifikat z. B. per certbot.

## Nach dem Umzug auf HTTPS

- **intervals.icu** funktioniert ohne Änderung.
- **Wahoo** (nach Freigabe deiner App): Im Wahoo-Entwicklerportal als Redirect URI `https://deine-domain/api/devices/wahoo/callback` eintragen. Mit HTTPS entfällt das localhost-Problem; Webhooks (sofortiger Import) gehen an `https://deine-domain/api/webhooks/wahoo`.
