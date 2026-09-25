/**
 * FIT activity import (Garmin watches / Edge, Wahoo ELEMNT, and any other
 * FIT-recording device). Decodes sessions with the official Garmin FIT SDK,
 * derives Normalized Power and heart-rate zones from the record stream when
 * the device did not store them.
 */
import { Decoder, Stream } from "@garmin/fitsdk";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import type { NormalizedActivity } from "@/lib/server/providers/types";

type AnyMesg = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const positive = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

function sportOf(sport: unknown, subSport: unknown): NormalizedActivity["sport"] {
  const s = String(sport ?? "");
  if (s === "cycling" || s === "eBiking") return "ride";
  if (s === "running") return "run";
  if (String(subSport ?? "") === "strengthTraining") return "strength";
  return "other";
}

function defaultName(sport: NormalizedActivity["sport"], start: Date, timeZone: string): string {
  let hour = start.getUTCHours();
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(start));
  } catch {
    /* keep UTC */
  }
  const part = hour < 11 ? 0 : hour < 14 ? 1 : hour < 18 ? 2 : 3;
  if (sport === "ride") return ["Morgenrunde", "Mittagsrunde", "Nachmittagsrunde", "Abendrunde"][part];
  if (sport === "run") return ["Morgenlauf", "Mittagslauf", "Nachmittagslauf", "Abendlauf"][part];
  if (sport === "strength") return "Krafttraining";
  return "Aktivität";
}

const MANUFACTURER: Record<string, string> = { garmin: "Garmin", wahooFitness: "Wahoo", hammerhead: "Hammerhead", coros: "COROS", suunto: "Suunto", polar: "Polar", zwift: "Zwift", development: "FIT" };

/** Seconds per heart-rate zone 1..5 (Friel, % of threshold heart rate). */
export function hrZonesFromRecords(records: AnyMesg[], lthr: number): number[] | null {
  if (!lthr || records.length < 30) return null;
  const bounds = [0.85, 0.9, 0.95, 1.0].map((p) => p * lthr);
  const zones = [0, 0, 0, 0, 0];
  let prev: number | null = null;
  let any = false;
  for (const r of records) {
    const t = r.timestamp instanceof Date ? r.timestamp.getTime() / 1000 : null;
    const hr = positive(r.heartRate);
    if (t === null) continue;
    if (prev !== null && hr !== null) {
      const dt = Math.min(10, Math.max(0, t - prev)); // gaps = pauses, cap
      let z = 0;
      while (z < 4 && hr >= bounds[z]) z++;
      zones[z] += dt;
      any = true;
    }
    prev = t;
  }
  return any ? zones.map(Math.round) : null;
}

/** Normalized Power from the record stream (30 s rolling average, 4th-power mean). */
export function normalizedPowerFromRecords(records: AnyMesg[]): number | null {
  const series: number[] = [];
  let prev: number | null = null;
  let prevPower = 0;
  for (const r of records) {
    const t = r.timestamp instanceof Date ? Math.round(r.timestamp.getTime() / 1000) : null;
    if (t === null) continue;
    const p = num(r.power);
    if (prev !== null) {
      const dt = t - prev;
      // Resample to 1 Hz; short gaps are held, longer gaps (pauses) are dropped.
      if (dt > 0 && dt <= 5) for (let i = 0; i < dt; i++) series.push(prevPower);
    }
    if (p !== null) prevPower = p;
    prev = t;
  }
  if (series.length < 60 || !series.some((p) => p > 0)) return null;
  let sum = 0;
  let acc = 0;
  let n = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= 30) sum -= series[i - 30];
    if (i >= 29) {
      acc += (sum / 30) ** 4;
      n++;
    }
  }
  return n ? Math.round((acc / n) ** 0.25) : null;
}

const isBikeComputer = (fileId: AnyMesg) =>
  fileId.manufacturer === "wahooFitness" || fileId.manufacturer === "hammerhead" || /^edge/i.test(String(fileId.garminProduct ?? ""));

/**
 * Total ascent from an altitude series with timestamps (seconds).
 *
 * Barometric data can contain long runs of invalid values and step changes
 * after calibration. Samples are accepted only at a physically plausible
 * vertical speed (≤ 5 m/s); if the signal stays "implausible" for 30 samples
 * in a consistent band, that band becomes the new reference (re-anchoring).
 * Changes below 2 m are treated as noise.
 */
export function ascentFromAltitudes(series: { t: number; alt: number | null }[]): number {
  let ref: { t: number; alt: number } | null = null;
  let hyst: number | null = null;
  let ascent = 0;
  let rejected: number[] = [];
  const accept = (t: number, alt: number) => {
    ref = { t, alt };
    if (hyst === null) hyst = alt;
    else if (alt - hyst >= 2) {
      ascent += alt - hyst;
      hyst = alt;
    } else if (hyst - alt >= 2) hyst = alt;
  };
  for (const { t, alt } of series) {
    if (alt === null || alt <= -500 || alt >= 9000) continue;
    if (!ref) {
      accept(t, alt);
      continue;
    }
    const current: { t: number; alt: number } = ref;
    const dt = Math.max(1, t - current.t);
    if (Math.abs(alt - current.alt) <= 5 * dt + 5) {
      rejected = [];
      accept(t, alt);
      continue;
    }
    rejected.push(alt);
    if (rejected.length >= 30) {
      const sorted = [...rejected].sort((a, b) => a - b);
      const spread = sorted[sorted.length - 1] - sorted[0];
      if (spread < 30) {
        // Consistent new level: re-anchor without counting the step as ascent.
        ref = { t, alt: sorted[Math.floor(sorted.length / 2)] };
        hyst = ref.alt;
      }
      rejected = [];
    }
  }
  return Math.round(ascent);
}

/** Builds a session-like summary from records (time-weighted averages). */
export function sessionFromRecords(records: AnyMesg[], fileId: AnyMesg): AnyMesg | null {
  const rows = records.filter((r) => r.timestamp instanceof Date) as (AnyMesg & { timestamp: Date })[];
  if (rows.length < 10) return null;
  const start = rows[0].timestamp;
  const end = rows[rows.length - 1].timestamp;
  const elapsed = (end.getTime() - start.getTime()) / 1000;
  if (elapsed < 60) return null;
  let moving = 0;
  let hrSum = 0;
  let hrTime = 0;
  let maxHr = 0;
  let pSum = 0;
  let pTime = 0;
  let maxDist = 0;
  for (let i = 1; i < rows.length; i++) {
    const dt = Math.min(10, (rows[i].timestamp.getTime() - rows[i - 1].timestamp.getTime()) / 1000);
    if (dt <= 0) continue;
    const speed = num(rows[i].enhancedSpeed) ?? num(rows[i].speed);
    if (speed === null || speed > 0.5) moving += dt;
    const hr = positive(rows[i].heartRate);
    if (hr !== null) {
      hrSum += hr * dt;
      hrTime += dt;
      maxHr = Math.max(maxHr, hr);
    }
    const p = num(rows[i].power);
    if (p !== null) {
      pSum += p * dt;
      pTime += dt;
    }
    maxDist = Math.max(maxDist, num(rows[i].distance) ?? 0);
  }
  const hasPower = pTime > 0 && pSum > 0;
  const ascent = ascentFromAltitudes(rows.map((r) => ({ t: r.timestamp.getTime() / 1000, alt: num(r.enhancedAltitude) ?? num(r.altitude) })));
  return {
    startTime: start,
    totalElapsedTime: elapsed,
    totalTimerTime: moving,
    totalDistance: maxDist || null,
    totalAscent: Math.round(ascent),
    avgHeartRate: hrTime ? Math.round(hrSum / hrTime) : null,
    maxHeartRate: maxHr || null,
    avgPower: hasPower ? Math.round(pSum / pTime) : null,
    avgSpeed: maxDist && moving ? maxDist / moving : null,
    sport: isBikeComputer(fileId) || hasPower ? "cycling" : "generic",
  };
}

export interface FitImportResult {
  activities: NormalizedActivity[];
  errors: string[];
}

export function decodeFitActivity(bytes: Uint8Array, fileName: string, lthr: number, timeZone = "Europe/Berlin"): FitImportResult {
  const stream = Stream.fromByteArray(Array.from(bytes));
  if (!Decoder.isFIT(stream)) return { activities: [], errors: [`${fileName}: keine FIT-Datei`] };
  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) return { activities: [], errors: [`${fileName}: Datei ist beschädigt (Prüfsumme)`] };
  const { messages, errors } = decoder.read();
  if (errors.length) return { activities: [], errors: [`${fileName}: ${String(errors[0])}`] };

  const fileId = (messages.fileIdMesgs?.[0] ?? {}) as AnyMesg;
  if (fileId.type !== undefined && fileId.type !== "activity") {
    return { activities: [], errors: [`${fileName}: keine Aktivität (FIT-Typ „${String(fileId.type)}“)`] };
  }
  const records = (messages.recordMesgs ?? []) as AnyMesg[];
  let sessions = (messages.sessionMesgs ?? []) as AnyMesg[];
  // Recordings that were not finished cleanly (e.g. battery died) may lack the
  // session summary: rebuild it from the record stream.
  if (!sessions.length) {
    const synthetic = sessionFromRecords(records, fileId);
    if (!synthetic) return { activities: [], errors: [`${fileName}: keine Einheit in der Datei gefunden`] };
    sessions = [synthetic];
  }

  const workoutName = (messages.workoutMesgs?.[0] as AnyMesg | undefined)?.wktName;
  const manufacturer = String(fileId.manufacturer ?? "");
  const product = String((fileId.garminProduct ?? fileId.productName ?? "") || "");
  const deviceName = [MANUFACTURER[manufacturer] ?? (manufacturer ? manufacturer : null), product && !/^\d+$/.test(product) ? product : null].filter(Boolean).join(" ") || "FIT-Datei";
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 20);

  const activities: NormalizedActivity[] = [];
  sessions.forEach((s, i) => {
    const start = s.startTime instanceof Date ? s.startTime : null;
    const elapsed = positive(s.totalElapsedTime);
    if (!start || !elapsed) return;
    const end = new Date(start.getTime() + elapsed * 1000);
    const sessionRecords = records.filter((r) => r.timestamp instanceof Date && r.timestamp >= start && r.timestamp <= end);
    const sport = sportOf(s.sport, s.subSport);
    const cadence = positive(s.avgCadence);
    const timeInZone = Array.isArray(s.timeInHrZone) ? (s.timeInHrZone as number[]) : null;
    activities.push({
      externalId: `fit-${hash}-${i}`,
      sport,
      name: (typeof workoutName === "string" && workoutName.trim()) || defaultName(sport, start, timeZone),
      startTime: start,
      durationSec: Math.round(elapsed),
      movingSec: positive(s.totalTimerTime) !== null ? Math.round(s.totalTimerTime as number) : null,
      distanceM: positive(s.totalDistance),
      elevationGainM: num(s.totalAscent),
      avgHr: positive(s.avgHeartRate),
      maxHr: positive(s.maxHeartRate),
      avgPower: positive(s.avgPower),
      normPower: positive(s.normalizedPower) ?? (sport === "ride" ? normalizedPowerFromRecords(sessionRecords) : null),
      // FIT stores running cadence per leg (strides/min).
      avgCadence: cadence !== null ? Math.round(sport === "run" ? cadence * 2 : cadence) : null,
      avgSpeed: positive(s.enhancedAvgSpeed) ?? positive(s.avgSpeed),
      calories: positive(s.totalCalories),
      hrZoneSec: hrZonesFromRecords(sessionRecords, lthr) ?? (timeInZone && timeInZone.length >= 5 ? timeInZone.slice(0, 5).map((v) => Math.round(v ?? 0)) : null),
      deviceName,
    });
  });
  return { activities, errors: activities.length ? [] : [`${fileName}: keine auswertbare Einheit`] };
}

/** Expands uploads: .fit files directly, .zip archives (also nested one level, as Garmin exports them). */
export function expandUploads(files: { name: string; bytes: Uint8Array }[]): { fit: { name: string; bytes: Uint8Array }[]; errors: string[] } {
  const fit: { name: string; bytes: Uint8Array }[] = [];
  const errors: string[] = [];
  const visit = (name: string, bytes: Uint8Array, depth: number) => {
    const lower = name.toLowerCase();
    if (lower.endsWith(".fit")) {
      fit.push({ name, bytes });
      return;
    }
    if (lower.endsWith(".zip") && depth < 2) {
      try {
        const entries = unzipSync(bytes, { filter: (f) => /\.(fit|zip)$/i.test(f.name) && !f.name.startsWith("__MACOSX") });
        const names = Object.keys(entries);
        if (!names.length) errors.push(`${name}: keine FIT-Dateien im Archiv`);
        for (const n of names) visit(n.split("/").pop() ?? n, entries[n], depth + 1);
      } catch {
        errors.push(`${name}: ZIP-Archiv konnte nicht gelesen werden`);
      }
      return;
    }
    errors.push(`${name}: nur .fit- oder .zip-Dateien werden unterstützt`);
  };
  for (const f of files) visit(f.name, f.bytes, 0);
  return { fit, errors };
}
