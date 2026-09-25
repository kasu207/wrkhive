#!/usr/bin/env node
/**
 * End-to-end check of the device sync in both directions against the mock
 * providers (scripts/mock-providers.mjs):
 *   app -> device : OAuth connect, send workouts to Garmin (workout + schedule)
 *                   and Wahoo (plan + scheduled workout)
 *   device -> app : Wahoo pull on connect, Wahoo webhook, Garmin backfill push
 *                   and ping/pull notifications
 * Requires Google Chrome (or CHROME_PATH pointing to a Chromium binary).
 *
 *   APP=http://localhost:3100 MOCK=http://localhost:4010 node scripts/e2e-sync.mjs
 */
import { chromium } from "playwright-core";

const APP = process.env.APP ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:4010";
const WAHOO_WEBHOOK_TOKEN = process.env.WAHOO_WEBHOOK_TOKEN ?? "wahoo-webhook-token";
const CHROME = process.env.CHROME_PATH;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` – ${detail}` : ""}`);
};

// Uses the installed Google Chrome unless CHROME_PATH points to another Chromium.
const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : { channel: "chrome" });
const page = await (await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// 1. Account
const email = `e2e-${Date.now()}@example.com`;
await page.goto(`${APP}/signup`);
await page.getByLabel("Name").fill("E2E Test");
await page.getByLabel("E-Mail").fill(email);
await page.getByLabel("Passwort").fill("sehr-sicheres-passwort");
await page.getByRole("button", { name: "Konto erstellen" }).click();
await page.waitForURL("**/dashboard**");
check("Konto erstellt", true, email);

// 2. Connect both providers via OAuth (mock consent redirects straight back)
for (const [provider, label] of [
  ["garmin", "Mit Garmin verbinden"],
  ["wahoo", "Mit Wahoo verbinden"],
]) {
  await page.goto(`${APP}/devices`);
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL(`**/devices?connected=${provider}`, { timeout: 60_000 });
  const badge = await page.locator("h2", { hasText: provider === "garmin" ? "Garmin" : "Wahoo" }).locator("..").getByText("Verbunden", { exact: true }).count();
  check(`${provider}: OAuth mit PKCE verbunden`, badge > 0);
}

// 2b. intervals.icu via personal API key (form in a dialog)
await page.goto(`${APP}/devices`);
await page.getByRole("button", { name: "Mit intervals.icu verbinden" }).click();
await page.getByLabel("Athleten-ID").fill("i999");
await page.getByLabel("API-Schlüssel").fill("falscher-schluessel");
await page.getByRole("dialog").getByRole("button", { name: "Verbinden", exact: true }).click();
check("intervals.icu: falscher Schlüssel abgewiesen", (await page.getByText(/abgelehnt|nicht gefunden|Fehler 403/).first().textContent({ timeout: 30_000 }).catch(() => null)) !== null);
await page.getByLabel("Athleten-ID").fill("https://intervals.icu/athlete/i424242/activities");
await page.getByLabel("API-Schlüssel").fill("mock-intervals-key");
await page.getByRole("dialog").getByRole("button", { name: "Verbinden", exact: true }).click();
await page.getByText("intervals.icu verbunden").first().waitFor({ timeout: 30_000 });
const icuCard = page.locator("h2", { hasText: "intervals.icu" }).locator("..");
// The toast shows before router.refresh() has re-rendered the card: wait for the badge.
const icuBadge = await icuCard.getByText("Verbunden", { exact: true }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
check("intervals.icu: mit API-Schlüssel verbunden", icuBadge);

// 3. Wahoo history pulled on connect
await page.goto(`${APP}/activities`);
check("wahoo → app: Historie per API abgerufen", (await page.getByText("Sonntagsrunde").count()) > 0 && (await page.getByText("Zwift – Sweet Spot").count()) > 0);
check("wahoo → app: geplante Workouts ohne Ergebnis ignoriert", (await page.getByText("Geplantes Workout").count()) === 0);

check("intervals.icu → app: Aktivitäten abgerufen", (await page.getByText("Rolle – Sweet Spot ERG").count()) > 0 && (await page.getByText("Intervalle am Dienstag").count()) > 0);

// 4. Garmin backfill arrives asynchronously via push + ping
await page.waitForTimeout(6000);
await page.goto(`${APP}/activities`);
check("garmin → app: Push-Webhook (Backfill)", (await page.getByText("Rennrad-Runde").count()) > 0 && (await page.getByText("Lockerer Lauf").count()) > 0);
check("garmin → app: Ping + Pull mit Token", (await page.getByText("Trail am Samstag").count()) > 0);

// 5. Send workouts app -> device
const sendTo = async (templateName, providerLabel, where) => {
  await page.goto(`${APP}/workouts`);
  await page.getByRole("radio", { name: "Vorlagen" }).click();
  const card = page.locator("div", { hasText: templateName }).filter({ has: page.getByRole("button", { name: "Verwenden" }) }).last();
  await card.getByRole("button", { name: "Verwenden" }).click();
  await page.waitForURL(/\/workouts\/[a-z0-9]{12}$/);
  await page.getByRole("button", { name: /An Gerät senden/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: new RegExp(`^${providerLabel.replace(".", "\\.")}`) }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Morgen" }).click();
  if (where) await page.getByRole("dialog").getByRole("radio", { name: where }).click();
  await page.getByRole("button", { name: "Senden", exact: true }).click();
  return page.getByText(new RegExp(`An ${providerLabel} gesendet|Senden fehlgeschlagen`)).first().textContent({ timeout: 30_000 });
};
check("app → garmin: Rad-Workout gesendet", (await sendTo("Sweet Spot 2x20", "Garmin Connect")) === "An Garmin Connect gesendet");
check("app → garmin: Kraft-Workout gesendet", (await sendTo("Beine & Rumpf", "Garmin Connect")) === "An Garmin Connect gesendet");
check("app → garmin: Lauf-Workout gesendet", (await sendTo("Intervalle 6x800 m", "Garmin Connect")) === "An Garmin Connect gesendet");
check("app → wahoo: Rad-Workout gesendet", (await sendTo("VO2max 5x4", "Wahoo")) === "An Wahoo gesendet");
check("app → wahoo: Lauf-Workout gesendet", (await sendTo("Tempodauerlauf 3x10", "Wahoo")) === "An Wahoo gesendet");
check("app → wahoo: Rollentrainer-Workout (ERG) gesendet", (await sendTo("Sweet Spot 2x20", "Wahoo", "Rollentrainer (ERG)")) === "An Wahoo gesendet");
check("app → intervals.icu: Rad-Workout gesendet", (await sendTo("VO2max 5x4", "intervals.icu")) === "An intervals.icu gesendet");
check("app → intervals.icu: Lauf-Workout gesendet", (await sendTo("Intervalle 6x800 m", "intervals.icu")) === "An intervals.icu gesendet");

// 6. Wahoo webhook (new ride finished on the ELEMNT)
const hook = await fetch(`${APP}/api/webhooks/wahoo`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    event_type: "workout_summary",
    webhook_token: WAHOO_WEBHOOK_TOKEN,
    user: { id: 555 },
    workout_summary: {
      id: 1,
      duration_total_accum: "5400.0",
      duration_active_accum: "5300.0",
      distance_accum: "45000.0",
      power_bike_avg: "190.0",
      heart_rate_avg: "140.0",
      workout: { id: 7010, starts: new Date(Date.now() - 3 * 3600e3).toISOString(), minutes: 90, name: "ELEMNT Feierabendrunde", workout_type_id: 15 },
    },
  }),
});
check("wahoo → app: Webhook angenommen", hook.status === 200, `HTTP ${hook.status}`);
const badHook = await fetch(`${APP}/api/webhooks/wahoo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_type: "workout_summary", webhook_token: "falsch" }) });
check("wahoo webhook: falscher Token abgewiesen", badHook.status === 403);
const badGarmin = await fetch(`${APP}/api/webhooks/garmin?token=falsch`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
check("garmin webhook: falscher Token abgewiesen", badGarmin.status === 403);
await page.goto(`${APP}/activities`);
check("wahoo → app: Webhook-Aktivität sichtbar", (await page.getByText("ELEMNT Feierabendrunde").count()) > 0);

// 7. Manual sync (exercises Wahoo token refresh with single-use refresh tokens)
await page.goto(`${APP}/devices`);
const wahooCard = page.locator("h2", { hasText: "Wahoo" }).locator("xpath=ancestor::div[contains(@class,'flex-col')][1]");
await wahooCard.getByRole("button", { name: /Jetzt synchronisieren/ }).click();
const toast = await page.getByText(/^(Synchronisiert|Fehler)$/).first().textContent({ timeout: 30_000 });
check("wahoo: manueller Sync inkl. Token-Refresh", toast === "Synchronisiert");

// 8. Mock verdict: every request Wrkhive sent must have passed validation
const report = await (await fetch(`${MOCK}/report`)).json();
check("Anbieter-Mock: alle Anfragen formal korrekt", report.problems.length === 0, report.problems.join(" | "));
check("wahoo: Rollentrainer-Workout als BIKING_INDOOR_TRAINER geplant", report.wahooIndoorWorkouts >= 1, `${report.wahooIndoorWorkouts}`);
check("intervals.icu: Workouts im Kalender angelegt", report.intervalsEvents === 2, `${report.intervalsEvents}`);
check("Browser ohne Laufzeitfehler", errors.length === 0, errors.join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} Prüfungen bestanden`);
process.exit(failed ? 1 : 0);
