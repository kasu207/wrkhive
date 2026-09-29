# Wrkhive

Strukturierte Workouts für **Radfahren, Laufen und Krafttraining** in Sekunden erstellen und mit einem Klick an **Garmin** oder **Wahoo** senden. Dazu gibt es einen **KI-Coach** für spontane Einheiten und periodisierte Trainingspläne sowie ein **Dashboard** mit Fitness, Ermüdung, Form, Umfängen, Pulszonen, VO2max und Wettkampfprognosen. Aktivitäten von Uhr und Radcomputer kommen per **Dauer-Sync** oder **FIT-Import** automatisch dazu.

## Auf einen eigenen Server bringen

Für den Produktivbetrieb (z. B. Hetzner mit Docker) gibt es ein fertiges Setup mit automatischem HTTPS, geschlossener Registrierung, Sicherung und Updates per Befehl: siehe [deploy/README.md](deploy/README.md).

## Schnellstart mit Docker Desktop

Voraussetzung: [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows, macOS oder Linux).

```bash
git clone https://github.com/kasu207/wrkhive.git
cd wrkhive
git checkout claude/busy-cray-s2ego9
docker compose up --build
```

Danach **http://localhost:3000** öffnen. Beim ersten Start dauert der Build einige Minuten.

- **„Demo ansehen“** legt ein Konto mit etwa einem Jahr Beispieldaten an.
- **„Kostenlos starten“** legt ein leeres, eigenes Konto an.
- Alle Daten liegen im Docker-Volume `wrkhive-data` und überstehen Neustarts und Updates. Komplett zurücksetzen: `docker compose down -v`.
- Konfiguration (optional): `.env.example` nach `.env` kopieren und ausfüllen, dann `docker compose up --build`.

| Befehl | Zweck |
| --- | --- |
| `docker compose up --build` | Bauen und starten (Vordergrund, Logs sichtbar) |
| `docker compose up -d --build` | Im Hintergrund starten |
| `docker compose logs -f wrkhive` | Logs ansehen |
| `docker compose down` | Stoppen (Daten bleiben erhalten) |
| `docker compose down -v` | Stoppen und alle Daten löschen |

Das Image ist ein schlanker Node-22-Container mit Health-Check (`/api/health`), läuft als unprivilegierter Nutzer und wendet Datenbank-Migrationen beim Start automatisch an. Ein Hintergrund-Sync holt alle 30 Minuten neue Aktivitäten (`SYNC_INTERVAL_MINUTES`).

## Geräte und Apps verbinden

Unter **Geräte** („Apps & Geräte“) zeigt Wrkhive für jede App, woher die Aktivitäten kommen und wohin die Workouts gehen. Neue Konten durchlaufen ein kurzes Onboarding: Apps auswählen, Schwellenwerte eintragen, und Wrkhive schlägt die kleinste Zahl an Verbindungen vor, die alles abdeckt.

| App / Gerät | Workouts dorthin | Aktivitäten von dort |
| --- | --- | --- |
| **Apple Health** (Apple Watch, iPhone) | nicht möglich (nur native iPhone-Apps dürfen auf die Watch schreiben) | Export der Health-App (einmalig) und laufend über die iPhone-App Health Auto Export |
| **Wahoo ELEMNT** | direkt (eigene Wahoo-App, siehe unten) oder über intervals.icu | direkt oder über intervals.icu |
| **Garmin** | direkt (Garmin-Partnerprogramm), über intervals.icu oder FIT per USB | direkt, über intervals.icu oder FIT-Import |
| **Zwift** | über intervals.icu (offizielle Zwift-Anbindung) oder ZWO-Datei | über intervals.icu oder FIT-Import |
| **MyWhoosh** | über intervals.icu (offizielle MyWhoosh-Anbindung) | über intervals.icu |
| **ROUVY** | über intervals.icu („Workout of the day“) oder ZWO-Upload im Webportal | über intervals.icu |
| **Freeletics** | nicht möglich (keine Schnittstelle) | über Apple Health (siehe unten) oder per Companion-App nach intervals.icu |

Jede Aktivität trägt ihre Quell-App (Filter in „Aktivitäten“). Kommt dieselbe Einheit mehrfach an, etwa vom ELEMNT über Wahoo und von MyWhoosh über intervals.icu, oder lädt MyWhoosh eine Fahrt doppelt hoch, führt Wrkhive sie zusammen: gleiche Sportart und Start innerhalb von 5 Minuten oder zeitliche Überschneidung von mindestens der Hälfte (etwa wenn die Uhr vor der Trainings-App gestartet wurde). Fehlende Werte werden ergänzt (Leistung aus der Trainings-App, Puls von der Uhr), die Belastung wird neu berechnet.

**Strava** ist bewusst nicht angebunden: Seit Juni 2026 braucht jeder Entwickler ein bezahltes Strava-Abo für den API-Zugang, die API-Bedingungen verbieten die Nutzung der Daten in KI-Anwendungen (Wrkhive hat einen KI-Coach), und für die genannten Apps gibt es über intervals.icu bzw. direkt einen Weg ohne Strava.

### Wahoo ELEMNT direkt (empfohlen für Wahoo)

Wahoo gibt Workouts nur an registrierte Apps weiter. Für den eigenen Gebrauch reicht eine kostenlose persönliche App im **Sandbox-Modus** mit bis zu 250 API-Abfragen am Tag (genug für Senden und Abgleich alle 30 Minuten). Wahoo prüft jede neue App, auch Sandbox-Apps; Nutzer berichten von 5 bis 7 Tagen Wartezeit. Bis zur Freigabe gehen Workouts über intervals.icu auf den ELEMNT (siehe unten). Die Einrichtung läuft komplett in Wrkhive:

1. **Geräte → Wahoo → „Wahoo einrichten“.** Der Dialog zeigt die Redirect-URI und die Scopes zum Kopieren.
2. Im [Wahoo-Entwicklerportal](https://developers.wahooligan.com/) registrieren, unter **My Apps → Add a new app**: Typ *Confidential*, Umgebung *Sandbox*, Redirect-URI und Scopes einfügen.
3. Client-ID und Client-Secret in den Dialog kopieren, **„Speichern und verbinden“**, bei Wahoo zustimmen.

Danach landen Workouts mit einem Klick auf dem ELEMNT (geplant für heute bis 6 Tage). Die Einrichtung darf nur das erste Konto der Installation vornehmen; weitere Konten verbinden ihr Wahoo-Konto dann mit einem Klick. Das Secret wird verschlüsselt gespeichert. Sind `WAHOO_CLIENT_ID`/`WAHOO_CLIENT_SECRET` gesetzt, haben diese Vorrang. Nimmt Wahoo eine `http://localhost`-Adresse als Redirect-URI nicht an, den HTTPS-Tunnel einrichten (siehe unten) und die `https://`-Adresse verwenden.

### Apple Health

Apple bietet keine Web-Schnittstelle zu Health; HealthKit ist nur für Apps auf dem iPhone zugänglich. Wrkhive holt Workouts deshalb auf zwei Wegen, beide unter **Geräte → Apple Health**:

- **Bisherige Workouts, einmalig:** In der Health-App auf das Profilbild tippen, **„Alle Gesundheitsdaten exportieren“**, die `Export.zip` (oder die entpackte `export.xml`) in Wrkhive auswählen. Die Datei wird im Browser als Datenstrom gelesen, auch mehrere GB; an den Server gehen nur die Workouts (Sportart, Zeit, Dauer, Distanz, Puls, Höhenmeter, Kalorien, bei Rad auch Leistung), keine anderen Gesundheitsdaten. Erneutes Importieren aktualisiert statt zu verdoppeln.
- **Laufend:** Die iPhone-App [Health Auto Export](https://www.healthyapps.dev/apps/health-auto-export/) sendet neue Workouts per REST-API-Automation an `https://<deine-domain>/api/ingest/apple-health`. Den persönlichen Schlüssel erzeugt Wrkhive (wird nur einmal angezeigt, gespeichert ist nur sein Hash); in der App als Header `api-key` eintragen, Data Type *Workouts*, Format *JSON*, Export Version *2*, ohne Routen, *Batch Requests* an. Für Erholungswerte eine zweite Automation mit Data Type *Health Metrics* (Resting Heart Rate, Heart Rate Variability, Sleep Analysis, Weight; täglich aggregiert). Der Export der Health-App liefert dieselben Tageswerte für die Vergangenheit mit. Automationen sind in der App kostenpflichtig (Premium). iOS gibt Health-Daten nur bei entsperrtem iPhone frei, neue Workouts kommen daher meist bei der nächsten Nutzung des iPhones an. Die URL muss öffentlich per HTTPS erreichbar sein; Wrkhive bildet sie aus `APP_URL` (auf dem Server aus `DOMAIN`).

Workouts anderer Apps, die in Health schreiben (Garmin Connect, Zwift, Freeletics), werden ihrer App zugeordnet und mit Aufzeichnungen aus anderen Quellen zusammengeführt. Kostenlose Alternative für den laufenden Sync: die App „Intervals.icu Companion“ schickt Apple-Health-Workouts an intervals.icu, von dort holt Wrkhive sie.

### intervals.icu als Brücke (für Zwift, MyWhoosh, ROUVY, Freeletics)

[intervals.icu](https://intervals.icu) ist kostenlos und offiziell mit Zwift, MyWhoosh, ROUVY, Garmin und Wahoo verbunden. Wrkhive schreibt Workouts in den intervals.icu-Kalender und liest die Aktivitäten zurück; bedient wird alles in Wrkhive.

1. Konto bei intervals.icu anlegen, E-Mail-Adresse bestätigen, unter **Settings** die gewünschten Apps verbinden (bei Garmin und Wahoo **„Upload planned workouts“** aktivieren; in MyWhoosh und ROUVY intervals.icu unter den Verbindungen der jeweiligen App hinzufügen).
2. In intervals.icu unter **Settings → Developer Settings** die Athleten-ID (`i123456`) ablesen und einen persönlichen API-Schlüssel erzeugen. Das ist kein Antrag: Die Bewerbung mit Website und Datenschutzerklärung gilt nur für OAuth-Apps, die andere Nutzer anbinden wollen, nicht für den Zugriff auf das eigene Konto.
3. In Wrkhive unter **Geräte → „Mit intervals.icu verbinden“** beides eintragen.

Unterstützt werden Rad- und Lauf-Workouts mit Leistung (% FTP), Puls (% LTHR), Pace (% Schwellenpace) und Trittfrequenz. Jeder Wrkhive-Nutzer braucht sein eigenes intervals.icu-Konto.

### Workouts verschieben

Ein Workout, das mit Datum gesendet wird, steht automatisch auch im Wrkhive-Kalender.

| Wo verschoben | Was passiert |
| --- | --- |
| **Wrkhive** (Kalender: ziehen oder im Workout-Dialog „Verschieben“) | Bereits gesendete Kopien ziehen mit: intervals.icu-Kalendereintrag, geplantes Wahoo-Workout, Garmin-Kalendereintrag (bei direkter Verbindung). Klappt das bei einem Anbieter nicht, sagt Wrkhive es und du sendest dort erneut. |
| **intervals.icu** | Wrkhive übernimmt das neue Datum beim nächsten Abgleich (spätestens nach 30 Minuten) und verschiebt direkte Wahoo- oder Garmin-Kopien mit. Wird das Workout dort gelöscht, bleibt es in Wrkhive geplant und lässt sich neu senden. |
| **Wahoo-App** (direkte Verbindung) | Wrkhive übernimmt das neue Datum beim nächsten Abgleich. |
| **Garmin Connect** | Wird von keiner Schnittstelle zurückgemeldet, weder an Wrkhive noch an intervals.icu. |

Deshalb am besten immer in Wrkhive verschieben. Wichtig beim Weg über intervals.icu: Laut intervals.icu-Forum überträgt intervals.icu eine Verschiebung nicht in einen bereits befüllten Garmin-Connect-Kalender. Dort kann das Workout zusätzlich am alten Tag stehen bleiben und ist in Garmin Connect von Hand zu löschen. Bei Wahoo werden die Workouts der nächsten 7 Tage von intervals.icu neu abgeglichen.

### Workouts an die Belastung anpassen

Wrkhive bewertet täglich die Form im Verhältnis zur Fitness (TSB in Prozent der CTL) und die Steigerungsrate. Bei hoher Ermüdung (unter -30 %) werden harte Einheiten kürzer und 5 % leichter (weniger Wiederholungen oder kürzere Blöcke), bei sehr hoher Ermüdung (unter -40 %) durch eine lockere Einheit ersetzt; lockere Einheiten bleiben unverändert. Auf der Übersicht erscheint dazu ein Vorschlag mit einem Klick zum Übernehmen, das Original lässt sich jederzeit wiederherstellen. Im Automatikmodus (Onboarding oder Einstellungen) passiert das morgens von selbst, aber nie für Workouts, die schon an ein Gerät gesendet wurden.

### Indoor mit Smart-Trainer (ERG)

Ein Wahoo ELEMNT (BOLT, ROAM, ACE) steuert Rollentrainer anderer Hersteller über **ANT+ FE-C** und hält im ERG-Modus die Leistungsziele eines geplanten Workouts.

1. Trainer in der Wahoo-App unter Sensoren mit dem ELEMNT koppeln, während du trittst, damit der Trainer aktiv ist.
2. Rad-Workout mit Leistungszielen (% FTP) bauen. Beim Senden **„Rollentrainer (ERG)“** wählen (Standard, wenn jeder Schritt ein Leistungsziel hat). Wrkhive plant es bei Wahoo als Indoor-Trainer-Einheit (`BIKING_INDOOR_TRAINER`) und weist auf Schritte ohne Leistungsziel, sehr kurze Intervalle und Distanz-Schritte hin.
3. Auf dem ELEMNT unter **Geplante Workouts** starten; der Trainer folgt den Zielwerten.

**Van Rysel D500 / D900:** Decathlon bestätigt für Firmware 104 einen Fehler, bei dem ERG über ANT+ mit Radcomputern abbricht. Firmware vorher mit der App **OneLap Fit** aktualisieren. Erkennt der ELEMNT den Trainer danach nur als Leistungsmesser und nicht als Smart-Trainer, fehlt die FE-C-Steuerung; dann das Workout als **ZWO** in Zwift fahren (Steuerung per Bluetooth FTMS) und den ELEMNT nur aufzeichnen lassen.

### Garmin und Wahoo über die Hersteller-APIs (Server-Konfiguration)

| Richtung | Garmin | Wahoo |
| --- | --- | --- |
| **Wrkhive → Gerät** | Workout plus Kalendereintrag über die Training API. Die Uhr lädt es beim nächsten Sync mit Garmin Connect | Plan plus geplantes Workout über die Cloud API. Erscheint auf dem ELEMNT/RIVAL, wenn es für heute bis 6 Tage im Voraus geplant ist |
| **Gerät → Wrkhive** | Garmin **schickt** neue Aktivitäten an einen Webhook (Push oder Ping). Beim Verbinden wird die Historie der letzten 12 Monate angefordert | Abruf über die API (beim Verbinden 12 Monate, danach alle 30 Minuten) und zusätzlich in Echtzeit per Webhook |

Was du dafür brauchst:

1. **Zugangsdaten der Hersteller**
   - Garmin: Zugang zum [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/) beantragen und die **Training API** sowie die **Activity API** freischalten lassen. Garmin prüft die Anträge; das kann einige Tage dauern.
   - Wahoo: Im [Wahoo Developer Portal](https://developers.wahooligan.com/) eine App anlegen. Scopes: `user_read workouts_read workouts_write plans_read plans_write power_zones_read offline_data`.
2. **Eine öffentliche HTTPS-Adresse**, damit Garmin und Wahoo Wrkhive erreichen. Das betrifft die OAuth-Rückleitung und die Webhooks. Lokal geht das am einfachsten mit dem eingebauten Tunnel (ngrok, kostenlos mit fester Domain):
   - Konto bei [ngrok](https://ngrok.com/) anlegen, unter *Domains* die kostenlose statische Domain reservieren, Authtoken kopieren.
   - In `.env` eintragen:
     ```
     NGROK_AUTHTOKEN=…
     NGROK_DOMAIN=dein-name.ngrok-free.app
     APP_URL=https://dein-name.ngrok-free.app
     ```
   - Starten: `docker compose --profile tunnel up --build`
3. **Adressen bei den Herstellern hinterlegen** (mit deiner `APP_URL`):

   | | Garmin | Wahoo |
   | --- | --- | --- |
   | OAuth-Redirect | `https://…/api/devices/garmin/callback` | `https://…/api/devices/wahoo/callback` |
   | Webhook | `https://…/api/webhooks/garmin?token=<GARMIN_WEBHOOK_TOKEN>` für *Activities* (Push oder Ping), *Deregistrations* und *User Permissions*, für Erholungswerte zusätzlich *Dailies*, *Sleeps*, *HRV Summary*, *Body Compositions* und *User Metrics* (Health API) | `https://…/api/webhooks/wahoo`, Token als `WAHOO_WEBHOOK_TOKEN` |

4. **Zugangsdaten in `.env`** eintragen (`GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET`, `GARMIN_WEBHOOK_TOKEN`, `WAHOO_CLIENT_ID`, `WAHOO_CLIENT_SECRET`, `WAHOO_WEBHOOK_TOKEN`) und mit `docker compose --profile tunnel up --build` neu starten.
5. In Wrkhive unter **Geräte** auf **„Mit Garmin verbinden“** bzw. **„Mit Wahoo verbinden“** klicken und beim Hersteller zustimmen. Fehlen dort erteilte Berechtigungen, zeigt Wrkhive das auf der Geräteseite an.

Ohne Zugangsdaten laufen die Verbindungen im klar gekennzeichneten **Demo-Modus** mit Beispieldaten.

### Dateien, ohne API-Zugang

| Richtung | Garmin (z. B. Forerunner, fēnix, Edge) | Wahoo (ELEMNT BOLT, ROAM, ACE) |
| --- | --- | --- |
| **Gerät → Wrkhive** | Aktivitäten unter **Aktivitäten → „FIT-Dateien importieren“** hochladen: direkt vom Gerät per USB (Ordner `GARMIN/Activity`) oder aus Garmin Connect über **Aktivität → Zahnrad → „Original exportieren“** (ZIP, wird direkt verarbeitet) | In der ELEMNT-App den Verlauf öffnen, die Fahrt teilen und die **.fit**-Datei speichern. Dann in Wrkhive importieren |
| **Wrkhive → Gerät** | Workout öffnen → **„An Gerät senden“ → „FIT-Workout“** herunterladen und per USB in den Ordner `GARMIN/NewFiles` kopieren. Die Uhr zeigt es unter **Training → Workouts** an. Unter macOS brauchen neuere Uhren (MTP) z. B. [OpenMTP](https://openmtp.ganeshrvel.com/) | Strukturierte Workouts gelangen nur über die Wahoo-Cloud aufs ELEMNT, also direkt oder über intervals.icu |

Der Import erkennt Duplikate (erneuter Import derselben Datei, dieselbe Einheit aus zwei Quellen), berechnet Normalized Power, Pulszonen und Trainingsbelastung und rekonstruiert unvollständige Aufzeichnungen, etwa wenn der Akku leer war.

### Den kompletten Sync ohne Zugangsdaten ausprobieren

Ein mitgelieferter **Anbieter-Simulator** bildet die Garmin-, Wahoo- und intervals.icu-APIs nach: OAuth mit PKCE, API-Schlüssel, Workout- und Plan-Formate, Workout-Text, Token-Rotation, Backfill-Push und Ping. Er prüft jede Anfrage von Wrkhive auf formale Korrektheit.

```bash
docker compose -f docker-compose.yml -f docker-compose.mock.yml up --build
```

Dann unter http://localhost:3000 ein Konto anlegen und unter **Geräte** die Anbieter verbinden (intervals.icu im Simulator: Athleten-ID `i424242`, API-Schlüssel `mock-intervals-key`). Workouts lassen sich senden, und simulierte Aktivitäten treffen ein. Die automatisierte Prüfung beider Richtungen (32 Checks, inklusive Onboarding, Quell-Apps und MyWhoosh-Doppelupload) läuft mit:

```bash
npm install
APP=http://localhost:3000 WAHOO_WEBHOOK_TOKEN=mock-wahoo-webhook-token npm run test:e2e
```

(Nutzt das installierte Google Chrome; alternativ `CHROME_PATH=/pfad/zu/chromium` setzen.)

## Funktionen

| Bereich | Was es kann |
| --- | --- |
| **Workout-Builder** | Visueller Editor (Drag & Drop, Wiederholungsblöcke, Zonen-Schnellwahl, Trittfrequenz) und **Text-Schnelleingabe**, beide immer synchron. Live-Profil mit Zonenfarben, Dauer, Distanz, TSS und IF. Rückgängig/Wiederholen, Tastenkürzel (Strg+S, Strg+Z). |
| **Text-Notation** | `Aufwärmen 10min 50-65%`, `5x (3min 110%, Erholung 2min 55%)`, `6x (400m 4:00/km, 90s Pause)`, `3x10 Kniebeuge (Langhantel) 60kg Pause 2min`. Versteht h/min/s/km/m, %, W, Pace, bpm, Z1 bis Z7, GA1/GA2/KB/EB/SB, RPE und rpm. |
| **Senden an Geräte** | Garmin Connect (Workout plus Kalender), Wahoo (Plan plus geplantes Workout, auf Wunsch als Rollentrainer-Einheit mit ERG-Hinweisen) und intervals.icu (Kalender, weiter an Garmin und Wahoo). Export als **FIT** (offizielles Garmin FIT SDK), **ZWO** (Zwift) und Text. |
| **Aktivitäten** | Dauer-Sync (Webhooks und Abruf), FIT/ZIP-Import, Apple-Health-Import (Export und Health Auto Export), manuelle Erfassung mit Session-RPE (z. B. Kampfsport ohne Uhr), Quell-App je Aktivität (Garmin, Wahoo, Apple Health, Zwift, MyWhoosh, ROUVY, Freeletics …) mit Filter, Zusammenführen doppelter Aufzeichnungen, Normalized Power, Pulszonen, TSS nach Leistung, Pace, Puls oder Session-RPE. |
| **Apps & Geräte** | Übersicht aller Apps mit Datenfluss und Status, Onboarding mit Empfehlung der nötigen Verbindungen, Einrichtungs-Checkliste auf der Übersicht. |
| **Anpassung an Belastung** | Tägliche Bereitschaft aus Form und Steigerungsrate, Vorschlag oder automatische Anpassung des Workouts des Tages, Original wiederherstellbar. Bei weniger als 6 Wochen Verlauf zeigt die Form „Kalibrierung“ und passt nichts an, bis der Trainingsumfang vor Wrkhive angegeben ist (Startwert für Fitness und Ermüdung). |
| **Krafttraining** | 50 Übungen mit FIT- bzw. Garmin-Übungs-IDs, damit Uhren Animationen und Wiederholungszählung zeigen. Sätze, Wiederholungen, Gewicht, Pausen. |
| **KI-Coach** | Chat für spontane Workouts auf Basis der aktuellen Form. Planassistent für periodisierte Pläne (Grundlage, Aufbau, Spitze, Tapering, 3:1-Entlastung), mit einem Klick in den Kalender. Nutzt Claude (`ANTHROPIC_API_KEY`); ohne Schlüssel arbeitet ein regelbasierter Coach. |
| **Kalender** | 4-Wochen-Ansicht, Drag & Drop, geplante und absolvierte Einheiten, Wochensummen (Soll/Ist/Planziel), automatisches Abhaken bei passender Aktivität. Termine ohne Workout (z. B. Jiu-Jitsu, Studio), auch wöchentlich: nach dem Termin fragt Wrkhive nach Bestätigung und Bewertung (Dauer, Session-RPE), eine Aufzeichnung der Uhr am selben Tag erledigt den Termin automatisch und ersetzt den manuellen Eintrag. |
| **Trainingsziele** | Bis zu drei Ziele im Profil (Muskelaufbau, Ausdauer, Wettkampf, Gewicht, Gesundheit). Das Hauptziel steuert Schwerpunkt und Länge vorgeschlagener Workouts, Krafttraining und Intensität neuer Pläne; der KI-Coach bekommt alle Ziele. |
| **Dashboard** | Frei zusammenstellbar: Widgets ein- und ausblenden, sortieren (Ziehen, Tastatur, Pfeile) und in der Größe wählen; ohne Daten erklärt ein Widget, woher sie kommen. Performance-Management-Chart, Wochenumfang, Pulszonen, Intensitätsverteilung (locker/mittel/hart, Ziel 80/20), Regelmäßigkeit mit Wochenziel, aerobe Effizienz und Entkopplung, Bestwerte (Leistung 5 s bis 60 min, 1/5/10 km) mit FTP-Schätzung, Schwellen-Check mit Übernahme per Klick, VO2max (Lauf aus Pace und Puls aller Läufe, Rad aus bester 5-min-Leistung pro kg, daneben der Wert der Uhr aus Garmin, Apple Health oder intervals.icu) und Laufprognosen. |
| **Erholung und Gesundheit** | Ruhepuls, HRV (rMSSD, Apple Watch als SDNN getrennt), Schlafdauer, Gewicht und die VO2max der Uhr aus Apple Health, Garmin (Health API) und intervals.icu, jeweils als 7-Tage-Schnitt gegen den persönlichen Normalbereich der letzten 60 Tage. Morgen-Check-in (Beine, Schlafgefühl, Motivation, optional Messwerte). Eingeschränkte Erholung (zwei oder mehr negative Signale) macht harte Einheiten des Tages kürzer und leichter. |

## Entwicklung ohne Docker

```bash
npm install
cp .env.example .env.local   # optional
npm run dev                  # http://localhost:3000
```

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run build && npm start` | Produktionsbuild und Server |
| `npm test` | Unit- und Integrationstests (Vitest) |
| `npm run test:e2e` | Sync-Prüfung gegen laufende App plus Simulator |
| `npm run mock:providers` | Anbieter-Simulator lokal starten |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npm run db:generate` | Neue Migration nach Schemaänderung (drizzle-kit) |

## Konfiguration

Alle Variablen mit Erklärung stehen in `.env.example`. Die wichtigsten:

| Variable | Bedeutung |
| --- | --- |
| `APP_URL` | Öffentliche Adresse (für OAuth und Webhooks), lokal `http://localhost:3000` |
| `APP_SECRET` | Schlüssel für die Token-Verschlüsselung. Leer lassen, dann wird er erzeugt und im Datenverzeichnis gespeichert |
| `ANTHROPIC_API_KEY` | Aktiviert den KI-Coach (Modell `claude-opus-5`, änderbar über `COACH_MODEL`) |
| `GARMIN_*`, `WAHOO_*` | Zugangsdaten und Webhook-Tokens der Hersteller (für intervals.icu braucht die Installation nichts, jeder Nutzer trägt seinen eigenen Schlüssel ein) |
| `SIGNUP_MODE` | `open` (Standard), `first` (nur das erste Konto) oder `closed` |
| `DEMO_ENABLED` | Demo-Konten mit Beispieldaten (Standard `true`) |
| `SYNC_INTERVAL_MINUTES` | Intervall des Hintergrund-Syncs (Standard 30, `0` = aus) |
| `CRON_SECRET` | Schützt `GET /api/cron/sync` für externe Scheduler |

## Architektur

- **Next.js 16** (App Router, Server Components, Server Actions), **React 19**, **TypeScript** (strict), **Tailwind CSS 4**, Standalone-Build für Docker
- **SQLite** über **Drizzle ORM** und better-sqlite3 (WAL, Fremdschlüssel, Migrationen in `drizzle/`)
- Eigene Authentifizierung: scrypt-Passwort-Hashes, gehashte Session-Tokens in httpOnly-Cookies, Rate-Limit für Logins
- Geräte-Tokens mit **AES-256-GCM** verschlüsselt, OAuth 2.0 mit **PKCE**, Webhooks mit Token-Prüfung
- Diagramme als eigene SVG-Komponenten (d3-scale/d3-shape)

```
src/
  app/                  Seiten, Server Actions (actions/), API-Routen (api/)
  components/           UI-Bausteine, Builder, Diagramme, Kalender, Coach
  db/                   Drizzle-Schema und Verbindung
  lib/workout/          Workout-Modell, Text-Parser, Kennzahlen, Zonen, Exporter (FIT, ZWO, Wahoo, Garmin, intervals.icu), ERG-Prüfung
  lib/fit/              FIT-Aktivitätsimport
  lib/apple-health.ts   Apple-Health-Export (Stream-Parser) und Health-Auto-Export-Format
  lib/analytics/        TSS, CTL/ATL/TSB, VO2max, Wettkampfprognosen
  lib/coach/            Regelbasierter Workout- und Plangenerator, Coach-Prompt
  lib/server/           Auth, Krypto, Sync, Scheduler, Geräteadapter, Coach (Claude)
scripts/                Anbieter-Simulator und End-to-End-Sync-Prüfung
```

Workouts speichern Intensitäten **relativ** zu den Schwellenwerten (% FTP, % Schwellenpace, % LTHR) und passen sich an, wenn sich diese ändern. Absolute Werte (Watt, Pace, bpm) werden erst beim Senden bzw. Export berechnet.

## Tests

- `npm test`: 194 Unit- und Integrationstests, u. a.:
  - Parser und Exporter; FIT-Workouts werden mit dem offiziellen Garmin-Decoder zurückgelesen
  - FIT-Aktivitätsimport inklusive NP, Pulszonen, ZIP und defekter Aufzeichnungen
  - Apple-Health-Export (gestreamtes ZIP, auch mit Data Descriptors) und Health-Auto-Export-Webhook v1/v2
  - Belastungsmodelle gegen die Daniels-Tabellen
  - Sync mit echter SQLite-Datenbank und Coach mit gemocktem Claude
- `npm run test:e2e:wahoo-setup`: 8 Prüfungen der Wahoo-Einrichtung über die Oberfläche (App ohne `WAHOO_CLIENT_ID` starten, `WAHOO_API_BASE`/`WAHOO_AUTHORIZE_URL` auf den Simulator)
- `npm run test:e2e`: 32 End-to-End-Prüfungen des Syncs in beide Richtungen gegen den Anbieter-Simulator, im Browser und im Docker-Container

## Betrieb

- Für den Betrieb im Internet über **HTTPS** ausliefern (Reverse Proxy oder Tunnel). Session-Cookies sind dann automatisch `Secure`.
- Backup: Das Volume enthält `wrkhive.db` und `.app-secret`. Beides sichern, z. B.:
  `docker run --rm -v wrkhive_wrkhive-data:/data -v "$PWD":/backup busybox tar czf /backup/wrkhive-backup.tgz -C /data .`
- Rate-Limit, Sync-Sperre und Scheduler arbeiten im Prozessspeicher und sind für eine einzelne Instanz ausgelegt.
