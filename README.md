# Wrkhive

Strukturierte Workouts für **Radfahren, Laufen und Krafttraining** in Sekunden erstellen und mit einem Klick an **Garmin** oder **Wahoo** senden. Dazu gibt es einen **KI-Coach** für spontane Einheiten und periodisierte Trainingspläne sowie ein **Dashboard** mit Fitness, Ermüdung, Form, Umfängen, Pulszonen, VO2max und Wettkampfprognosen. Neue Aktivitäten kommen per **Dauer-Sync** automatisch dazu.

## Funktionen

| Bereich | Was es kann |
| --- | --- |
| **Workout-Builder** | Visueller Editor (Drag & Drop, Wiederholungsblöcke, Zonen-Schnellwahl, Trittfrequenz) und **Text-Schnelleingabe**, beide immer synchron. Live-Profil mit Zonenfarben, Dauer, Distanz, TSS und IF. Rückgängig/Wiederholen, Tastenkürzel (Strg+S, Strg+Z). |
| **Text-Notation** | `Aufwärmen 10min 50-65%`, `5x (3min 110%, Erholung 2min 55%)`, `6x (400m 4:00/km, 90s Pause)`, `3x10 Kniebeuge (Langhantel) 60kg Pause 2min`. Versteht h/min/s/km/m, %, W, Pace, bpm, Z1 bis Z7, GA1/GA2/KB/EB/SB, RPE und rpm. |
| **Senden an Geräte** | Garmin Connect (Training API: Workout plus Kalendereintrag) und Wahoo (Plan plus geplantes Workout für ELEMNT/RIVAL). Export als **FIT** (offizielles Garmin FIT SDK), **ZWO** (Zwift) und Text. |
| **Krafttraining** | 50 Übungen mit FIT- bzw. Garmin-Übungs-IDs, damit Uhren Animationen und Wiederholungszählung zeigen. Sätze, Wiederholungen, Gewicht, Pausen. |
| **KI-Coach** | Chat für spontane Workouts auf Basis der aktuellen Form (CTL/ATL/TSB, letzte 14 Tage, Planung). Planassistent für periodisierte Pläne (Grundlage, Aufbau, Spitze, Tapering, 3:1-Entlastung), mit einem Klick in den Kalender. Nutzt Claude mit strukturierter Ausgabe. Ohne API-Schlüssel arbeitet ein regelbasierter Coach. |
| **Kalender** | 4-Wochen-Ansicht, Drag & Drop, geplante und absolvierte Einheiten, Wochensummen (Soll/Ist/Planziel), automatisches Abhaken bei passender Aktivität. |
| **Dashboard** | Performance-Management-Chart (Fitness, Ermüdung, Tagesbelastung, Form), Wochenumfang nach Sportart, Pulszonenverteilung, effektive VO2max (Daniels/Gilbert mit Pulskorrektur) und Laufprognosen. |
| **Dauer-Sync** | Webhooks (Garmin Push/Ping, Wahoo `workout_summary`), stündlicher Abgleich, Historien-Import (12 Monate), Duplikaterkennung über Anbieter hinweg. |

## Schnellstart

```bash
npm install
cp .env.example .env.local   # optional: Schlüssel eintragen
npm run dev                  # http://localhost:3000
```

Auf der Startseite mit **„Demo ansehen“** entsteht ein vollständig befülltes Demo-Konto mit etwa einem Jahr Trainingshistorie, Workouts und Wochenplanung. Ohne Garmin- bzw. Wahoo-Zugangsdaten laufen Verbindungen im klar gekennzeichneten **Demo-Modus**: Das Senden wird simuliert, Aktivitäten sind Beispieldaten.

Die SQLite-Datenbank wird beim ersten Zugriff automatisch angelegt und migriert (`./data/wrkhive.db`).

### Skripte

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run build && npm start` | Produktionsbuild und Server |
| `npm test` | Unit- und Integrationstests (Vitest) |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run db:generate` | Neue Migration nach Schemaänderung (drizzle-kit) |

## Integrationen einrichten

### Garmin

1. Zugang zum [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/) beantragen, dort **Training API** und **Activity API** (Health API) freischalten lassen.
2. Redirect-URL: `https://<APP_URL>/api/devices/garmin/callback` (OAuth 2.0 mit PKCE).
3. Im Portal als Endpoint für **Activities** (Push oder Ping), **Deregistrations** und **User Permissions** eintragen:
   `https://<APP_URL>/api/webhooks/garmin?token=<GARMIN_WEBHOOK_TOKEN>`
4. `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET`, `GARMIN_WEBHOOK_TOKEN` setzen.

Gesendete Workouts landen in der Garmin-Connect-Workoutbibliothek und, wenn ein Datum gewählt ist, im Kalender. Beim nächsten Sync überträgt Garmin sie auf Uhr bzw. Edge.

### Wahoo

1. App im [Wahoo Developer Portal](https://developers.wahooligan.com/) anlegen, Scopes: `user_read workouts_read workouts_write plans_read plans_write power_zones_read offline_data`.
2. Redirect-URL: `https://<APP_URL>/api/devices/wahoo/callback`.
3. Webhook-URL: `https://<APP_URL>/api/webhooks/wahoo`, den Token als `WAHOO_WEBHOOK_TOKEN` setzen.
4. `WAHOO_CLIENT_ID`, `WAHOO_CLIENT_SECRET` setzen.

Einschränkungen von Wahoo: Pläne erscheinen auf ELEMNT und RIVAL nur, wenn sie für **heute bis 6 Tage im Voraus** geplant sind. Krafttraining und Schritte mit Runden-Taste unterstützt Wahoo nicht; der Senden-Dialog weist darauf hin.

### KI-Coach

`ANTHROPIC_API_KEY` setzen. Standardmodell ist `claude-opus-5` (über `COACH_MODEL` änderbar), mit adaptivem Denken, strukturierter JSON-Ausgabe und serverseitigen Fallbacks bei Ablehnungen. Workouts erzeugt das Modell in der Text-Notation. Wrkhive validiert sie mit demselben Parser wie der Editor und bittet bei Fehlern einmal um Korrektur. Ist die API nicht erreichbar, übernimmt der regelbasierte Coach.

### Periodischer Sync

Webhooks liefern neue Aktivitäten in Echtzeit. Zusätzlich synchronisiert die App beim Öffnen Verbindungen, die länger als eine Stunde nicht abgeglichen wurden. Für einen serverseitigen Abgleich ohne Nutzeraktivität:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<APP_URL>/api/cron/sync
```

## Architektur

- **Next.js 16** (App Router, Server Components, Server Actions), **React 19**, **TypeScript** (strict), **Tailwind CSS 4**
- **SQLite** über **Drizzle ORM** und better-sqlite3 (WAL, Fremdschlüssel, Migrationen in `drizzle/`)
- Eigene Authentifizierung: scrypt-Passwort-Hashes, gehashte Session-Tokens in httpOnly-Cookies, Rate-Limit für Logins
- Geräte-Tokens mit **AES-256-GCM** verschlüsselt (`APP_SECRET`)
- Diagramme als eigene SVG-Komponenten (d3-scale/d3-shape), mit Hover-Tooltips

```
src/
  app/                  Seiten, Server Actions (actions/), API-Routen (api/)
  components/           UI-Bausteine, Builder, Diagramme, Kalender, Coach
  db/                   Drizzle-Schema und Verbindung
  lib/workout/          Workout-Modell, Text-Parser, Kennzahlen, Zonen, Exporter (FIT, ZWO, Wahoo, Garmin)
  lib/analytics/        TSS, CTL/ATL/TSB, VO2max, Wettkampfprognosen
  lib/coach/            Regelbasierter Workout- und Plangenerator, Coach-Prompt
  lib/server/           Auth, Krypto, Sync, Geräteadapter, Coach (Claude), Trainingsdaten
```

Workouts speichern Intensitäten **relativ** zu den Schwellenwerten (% FTP, % Schwellenpace, % LTHR). Dadurch passen sie sich automatisch an, wenn sich FTP oder Pace ändern. Absolute Werte (Watt, Pace, bpm) werden erst beim Export berechnet.

## Tests

`npm test` führt 124 Tests aus:

- Parser und Serializer inklusive Roundtrip, Fehlermeldungen und alle Vorlagen
- FIT-Export, geprüft mit dem offiziellen Garmin-Decoder (Ziele, Wiederholungen, Distanzen, Pace, Kraftübungen)
- Wahoo-Plan, Garmin-Payload und ZWO
- Belastungsmodelle (TSS, PMC) und VO2max-Prognosen gegen die Daniels-Tabellen
- Workout- und Plangenerator für alle Kombinationen aus Sportart, Schwerpunkt und Dauer
- Integrationstests mit echter SQLite-Datenbank: Demo-Sync, Idempotenz, Duplikaterkennung, automatisches Abhaken, Coach mit gemocktem Claude (Anfrageformat, Reparaturrunde, Planübernahme, Fallback)

## Betrieb

- In Produktion `APP_SECRET` setzen und über **HTTPS** ausliefern, da Session-Cookies `Secure` sind.
- Die Datenbank ist eine einzelne Datei. Für Backups genügt `sqlite3 wrkhive.db ".backup backup.db"`.
- Rate-Limit und Sync-Sperre arbeiten im Prozessspeicher. Für mehrere Instanzen sollten sie auf einen geteilten Speicher (z. B. Redis) umgestellt werden, ebenso die Datenbank (z. B. Postgres, Drizzle unterstützt beides).
