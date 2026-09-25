#!/usr/bin/env node
/**
 * End-to-end check of the self-hosted Wahoo setup: the installation owner
 * enters the credentials of a personal Wahoo developer app in the UI (no
 * WAHOO_CLIENT_ID in the environment), connects via OAuth and sends a
 * smart-trainer workout to the ELEMNT. Runs against an app started WITHOUT
 * WAHOO_CLIENT_ID/SECRET but with WAHOO_API_BASE/WAHOO_AUTHORIZE_URL pointing
 * to the provider simulator (scripts/mock-providers.mjs, client
 * "wahoo-client" / "wahoo-secret").
 *
 *   APP=http://localhost:3200 MOCK=http://localhost:4010 node scripts/e2e-wahoo-setup.mjs
 */
import { chromium } from "playwright-core";

const APP = process.env.APP ?? "http://localhost:3000";
const MOCK = process.env.MOCK ?? "http://localhost:4010";
const CHROME = process.env.CHROME_PATH;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` – ${detail}` : ""}`);
};

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : { channel: "chrome" });
const errors = [];

async function signup(label) {
  const ctx = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${APP}/signup`);
  await page.getByLabel("Name").fill(label);
  await page.getByLabel("E-Mail").fill(`${label.toLowerCase()}-${Date.now()}@example.com`);
  await page.getByLabel("Passwort").fill("sehr-sicheres-passwort");
  await page.getByRole("button", { name: "Konto erstellen" }).click();
  await page.waitForURL("**/welcome**");
  await page.getByRole("button", { name: "Überspringen" }).click();
  await page.waitForURL("**/dashboard**");
  return page;
}

// The first account owns the installation.
const owner = await signup("Owner");
await owner.goto(`${APP}/devices`);
await owner.getByRole("button", { name: "Wahoo einrichten" }).click();
const dialog = owner.getByRole("dialog");
check("Einrichtungsdialog zeigt Redirect URI", (await dialog.getByText(`${APP}/api/devices/wahoo/callback`).count()) > 0 || (await dialog.innerText()).includes("/api/devices/wahoo/callback"));
await dialog.getByLabel("Client-ID").fill("x");
await dialog.getByLabel("Client-Secret").fill("y");
await dialog.getByRole("button", { name: "Speichern und verbinden" }).click();
check("Unvollständige Zugangsdaten abgewiesen", (await dialog.getByText(/sieht nicht vollständig aus/).first().textContent({ timeout: 15_000 }).catch(() => null)) !== null);
await dialog.getByLabel("Client-ID").fill("wahoo-client");
await dialog.getByLabel("Client-Secret").fill("wahoo-secret");
await dialog.getByRole("button", { name: "Speichern und verbinden" }).click();
await owner.waitForURL("**/devices?connected=wahoo", { timeout: 60_000 });
const wahooCard = owner.locator("h2", { hasText: "Wahoo" }).locator("..");
check("Wahoo mit eigener App per OAuth verbunden", await wahooCard.getByText("Verbunden", { exact: true }).waitFor({ timeout: 15_000 }).then(() => true, () => false));

// Send a smart-trainer workout to the ELEMNT.
await owner.goto(`${APP}/workouts`);
await owner.getByRole("radio", { name: "Vorlagen" }).click();
const card = owner.locator("div", { hasText: "Sweet Spot 2x20" }).filter({ has: owner.getByRole("button", { name: "Verwenden" }) }).last();
await card.getByRole("button", { name: "Verwenden" }).click();
await owner.waitForURL(/\/workouts\/[a-z0-9]{12}$/);
await owner.getByRole("button", { name: /An Gerät senden/ }).click();
await owner.getByRole("dialog").getByRole("button", { name: /^Wahoo/ }).click();
await owner.getByRole("dialog").getByRole("radio", { name: "Rollentrainer (ERG)" }).click();
await owner.getByRole("button", { name: "Senden", exact: true }).click();
const toast = await owner.getByText(/An Wahoo gesendet|Senden fehlgeschlagen/).first().textContent({ timeout: 30_000 });
check("Rollentrainer-Workout an den ELEMNT gesendet", toast === "An Wahoo gesendet");

// A second account can use the app but not change it.
const other = await signup("Zweit");
await other.goto(`${APP}/devices`);
check("Zweites Konto sieht keine Einrichtung", (await other.getByRole("button", { name: "Wahoo einrichten" }).count()) === 0 && (await other.getByRole("button", { name: "Mit Wahoo verbinden" }).count()) === 1);

const report = await (await fetch(`${MOCK}/report`)).json();
check("Anbieter-Mock: alle Anfragen formal korrekt", report.problems.length === 0, report.problems.join(" | "));
check("wahoo: als BIKING_INDOOR_TRAINER geplant", report.wahooIndoorWorkouts >= 1);
check("Browser ohne Laufzeitfehler", errors.length === 0, errors.join(" | "));

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} Prüfungen bestanden`);
process.exit(failed ? 1 : 0);
