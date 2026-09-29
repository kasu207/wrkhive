/**
 * Apple Health workouts. Apple offers no web API for HealthKit; workouts reach
 * Wrkhive in one of two formats:
 *
 *  - The official export (Health app > profile > "Export All Health Data"):
 *    a ZIP with export.xml, often several GB uncompressed. It is scanned in
 *    the browser as a stream, only the <Workout> elements are kept and sent
 *    to the server as compact JSON. The health data itself never leaves the
 *    device.
 *  - The iOS app "Health Auto Export" posts its JSON format (v1 and v2) to a
 *    per-user webhook, continuously in the background.
 *
 * Both are reduced to `AppleWorkout`, the wire format of the import endpoint.
 * Everything here is pure and runs in the browser as well as on the server.
 */
import { Unzip, UnzipInflate } from "fflate";

export interface AppleWorkout {
  /** HealthKit activity type (e.g. "Running", "HKWorkoutActivityTypeCycling") or the Health Auto Export name ("Outdoor Run"). */
  type: string;
  /** Start as ISO timestamp (UTC). */
  start: string;
  /** Offset of the recording's local time in seconds, for the calendar day. */
  utcOffsetSec: number | null;
  durationSec: number;
  distanceM?: number | null;
  calories?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  avgPower?: number | null;
  elevationGainM?: number | null;
  indoor?: boolean | null;
  /** Recording app or device as named by HealthKit, e.g. "Apple Watch von Philipp", "Garmin Connect". */
  source?: string | null;
  /** HealthKit UUID when known (Health Auto Export v2). */
  id?: string | null;
}

// ---------------------------------------------------------------------------
// Dates and units

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:[\s  ]*([AaPp])\.?\s?[Mm]\.?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

/** Parses "2024-03-01 18:05:12 +0100" (also 12-hour clock and ISO) into instant and UTC offset. */
export function parseAppleDate(input: string | null | undefined): { date: Date; offsetSec: number | null } | null {
  if (!input) return null;
  const s = input.trim();
  const m = DATE_RE.exec(s);
  if (m) {
    let hour = Number(m[4]);
    const ampm = m[7]?.toLowerCase();
    if (ampm === "p" && hour < 12) hour += 12;
    if (ampm === "a" && hour === 12) hour = 0;
    const tz = m[8];
    let offsetSec: number | null = null;
    if (tz === "Z") offsetSec = 0;
    else if (tz) {
      const digits = tz.replace(":", "");
      offsetSec = (digits[0] === "-" ? -1 : 1) * (Number(digits.slice(1, 3)) * 3600 + Number(digits.slice(3, 5)) * 60);
    }
    if (offsetSec === null) return null;
    const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, Number(m[5]), Number(m[6] ?? 0)) - offsetSec * 1000;
    const date = new Date(utc);
    return Number.isNaN(date.getTime()) ? null : { date, offsetSec };
  }
  return null;
}

const DISTANCE_M: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, yd: 0.9144, ft: 0.3048, cm: 0.01 };
const ENERGY_KCAL: Record<string, number> = { kcal: 1, cal: 1, kj: 1 / 4.184, j: 1 / 4184 };

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
/** Distance or length in metres; null for unknown units. */
export function toMetres(value: unknown, unit: string | null | undefined): number | null {
  const n = num(value);
  const f = DISTANCE_M[(unit ?? "").trim().toLowerCase()];
  return n !== null && f ? n * f : null;
}
/** Energy in kcal ("Cal" in HealthKit is the food calorie = kcal). */
export function toKcal(value: unknown, unit: string | null | undefined): number | null {
  const n = num(value);
  const f = ENERGY_KCAL[(unit ?? "kcal").trim().toLowerCase()];
  return n !== null && f ? n * f : null;
}
const positive = (n: number | null | undefined) => (n !== null && n !== undefined && Number.isFinite(n) && n > 0 ? n : null);

// ---------------------------------------------------------------------------
// Sport and naming

type Sport = "ride" | "run" | "strength" | "other";

const TYPE_NAMES: [RegExp, Sport, string][] = [
  [/wheelchair/i, "other", "Rollstuhl"],
  [/run|jog/i, "run", "Lauf"],
  [/hand\s?cycl/i, "other", "Handbike"],
  [/cycl|bik(e|ing)/i, "ride", "Radfahrt"],
  [/traditional\s?strength|functional\s?strength|strength|weight|core\s?training/i, "strength", "Krafttraining"],
  [/martial|boxing|kickbox|wrestling|jiu|judo|karate|taekwondo/i, "other", "Kampfsport"],
  [/high\s?intensity|hiit/i, "other", "HIIT"],
  [/cross\s?training/i, "other", "Crosstraining"],
  [/swim/i, "other", "Schwimmen"],
  [/hik(e|ing)/i, "other", "Wandern"],
  [/walk/i, "other", "Gehen"],
  [/row/i, "other", "Rudern"],
  [/elliptical/i, "other", "Crosstrainer"],
  [/yoga/i, "other", "Yoga"],
  [/pilates/i, "other", "Pilates"],
  [/ski/i, "other", "Skifahren"],
  [/stair/i, "other", "Treppensteigen"],
  [/climb/i, "other", "Klettern"],
  [/dance/i, "other", "Tanzen"],
  [/soccer|football/i, "other", "Fußball"],
  [/tennis|squash|badminton|padel|pickleball/i, "other", "Rückschlagsport"],
];

/** "HKWorkoutActivityTypeTraditionalStrengthTraining" -> "Traditional Strength Training". */
function readableType(type: string): string {
  return type
    .replace(/^HKWorkoutActivityType/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

export function appleSport(type: string): { sport: Sport; label: string } {
  const t = readableType(type);
  for (const [re, sport, label] of TYPE_NAMES) if (re.test(t)) return { sport, label };
  return { sport: "other", label: t || "Training" };
}

/** Indoor rides and runs (trainer, treadmill) are named as such; HAE v2 names carry "Indoor"/"Outdoor". */
export function appleWorkoutName(w: Pick<AppleWorkout, "type" | "indoor">): string {
  const { sport, label } = appleSport(w.type);
  const indoor = w.indoor ?? /\bindoor\b/i.test(w.type);
  if (indoor && sport === "ride") return "Indoor-Radfahrt";
  if (indoor && sport === "run") return "Laufband";
  return label;
}

// ---------------------------------------------------------------------------
// Official export (export.xml)

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? "";
  });
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

/** "1234 cm" -> 12.34 (metres). */
function quantityInMetres(value: string | undefined): number | null {
  const m = /^\s*(-?[\d.]+)\s*([a-zA-Z]+)\s*$/.exec(value ?? "");
  return m ? toMetres(m[1], m[2]) : null;
}

/**
 * Reads one <Workout> element of export.xml. Handles both the pre-iOS-16
 * attributes (totalDistance, totalEnergyBurned) and <WorkoutStatistics>.
 */
export function parseExportWorkout(xml: string): AppleWorkout | null {
  const head = xml.slice(0, tagEnd(xml, 0) + 1);
  const a = attributes(head);
  const type = a.workoutActivityType;
  const start = parseAppleDate(a.startDate);
  const end = parseAppleDate(a.endDate);
  if (!type || !start) return null;

  const unit = (a.durationUnit ?? "min").toLowerCase();
  const rawDuration = num(a.duration);
  let durationSec = rawDuration === null ? null : unit.startsWith("h") ? rawDuration * 3600 : unit === "s" || unit.startsWith("sec") ? rawDuration : rawDuration * 60;
  if (!positive(durationSec) && end) durationSec = (end.date.getTime() - start.date.getTime()) / 1000;
  if (!positive(durationSec)) return null;

  const stats = new Map<string, Record<string, string>>();
  for (const m of xml.matchAll(/<WorkoutStatistics\b[^>]*>/g)) {
    const s = attributes(m[0]);
    const key = (s.type ?? "").replace(/^HKQuantityTypeIdentifier/, "");
    if (key && !stats.has(key)) stats.set(key, s);
  }
  const meta = new Map<string, string>();
  for (const m of xml.matchAll(/<MetadataEntry\b[^>]*>/g)) {
    const e = attributes(m[0]);
    if (e.key && !meta.has(e.key)) meta.set(e.key, e.value ?? "");
  }

  const distanceStat = [...stats.entries()].find(([k]) => k.startsWith("Distance"))?.[1];
  const distanceM = positive(toMetres(a.totalDistance, a.totalDistanceUnit)) ?? (distanceStat ? positive(toMetres(distanceStat.sum, distanceStat.unit)) : null);
  const energy = stats.get("ActiveEnergyBurned");
  const calories = positive(toKcal(a.totalEnergyBurned, a.totalEnergyBurnedUnit)) ?? (energy ? positive(toKcal(energy.sum, energy.unit)) : null);
  const hr = stats.get("HeartRate");
  const power = stats.get("CyclingPower");
  const indoor = meta.has("HKIndoorWorkout") ? meta.get("HKIndoorWorkout") === "1" : null;

  return {
    type: type.replace(/^HKWorkoutActivityType/, ""),
    start: start.date.toISOString(),
    utcOffsetSec: start.offsetSec,
    durationSec: Math.round(durationSec as number),
    distanceM: distanceM === null ? null : Math.round(distanceM),
    calories: calories === null ? null : Math.round(calories),
    avgHr: hr ? positive(num(hr.average)) : null,
    maxHr: hr ? positive(num(hr.maximum)) : null,
    avgPower: power ? positive(num(power.average)) : null,
    elevationGainM: positive(quantityInMetres(meta.get("HKElevationAscended"))),
    indoor,
    source: a.sourceName ?? null,
    id: null,
  };
}

/** Index of the ">" that closes the tag starting at `from`, ignoring ">" inside quoted values. */
function tagEnd(s: string, from: number): number {
  let quote = false;
  for (let i = from; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34) quote = !quote;
    else if (c === 62 && !quote) return i;
  }
  return -1;
}

const WORKOUT_START = /<Workout[\s>/]/g;
const WORKOUT_CLOSE = "</Workout>";
/** Safety limit for a single element (routes are separate GPX files, so real elements are small). */
const MAX_ELEMENT = 4 * 1024 * 1024;

/**
 * Incremental scanner for export.xml: feed decoded text chunks, get parsed
 * workouts. Keeps only the unfinished element in memory.
 */
export function createExportScanner(onWorkout: (w: AppleWorkout) => void) {
  let buf = "";
  let skipped = 0;
  const drain = (final: boolean) => {
    for (;;) {
      WORKOUT_START.lastIndex = 0;
      const m = WORKOUT_START.exec(buf);
      if (!m) {
        // Keep a tail in case "<Workout" is split across chunks.
        buf = final ? "" : buf.slice(-16);
        return;
      }
      const start = m.index;
      const headEnd = tagEnd(buf, start);
      if (headEnd < 0) {
        buf = buf.slice(start);
        if (buf.length > MAX_ELEMENT) buf = "";
        return;
      }
      let endIdx: number;
      if (buf[headEnd - 1] === "/") endIdx = headEnd + 1;
      else {
        const close = buf.indexOf(WORKOUT_CLOSE, headEnd);
        if (close < 0) {
          buf = buf.slice(start);
          if (buf.length > MAX_ELEMENT) {
            skipped++;
            buf = "";
          }
          return;
        }
        endIdx = close + WORKOUT_CLOSE.length;
      }
      const w = parseExportWorkout(buf.slice(start, endIdx));
      if (w) onWorkout(w);
      else skipped++;
      buf = buf.slice(endIdx);
    }
  };
  return {
    push(text: string) {
      buf += text;
      drain(false);
    },
    end() {
      drain(true);
      return { skipped };
    },
  };
}

/** export.xml inside the archive, whatever the locale's capitalisation ("Export.xml"); not export_cda.xml. */
export const isExportXml = (name: string) => /(^|\/)export\.xml$/i.test(name) && !name.startsWith("__MACOSX");

/**
 * Reads workouts from the official export, either the ZIP or an unpacked
 * export.xml (macOS unpacks archives on download). Streams, so multi-GB
 * exports work without loading them into memory.
 */
export async function readAppleHealthExport(
  file: { name: string; size: number; stream(): ReadableStream<Uint8Array> },
  onProgress?: (fraction: number) => void,
): Promise<{ workouts: AppleWorkout[]; skipped: number; foundXml: boolean }> {
  const workouts: AppleWorkout[] = [];
  const scanner = createExportScanner((w) => workouts.push(w));
  const decoder = new TextDecoder("utf-8");
  const isZip = /\.zip$/i.test(file.name);
  let foundXml = !isZip;
  let error: Error | null = null;
  let xmlDone = false;

  const unzip = isZip
    ? new Unzip((entry) => {
        if (foundXml || !isExportXml(entry.name)) {
          // fflate buffers entries that are never started; discard them instead (export_cda.xml is as large as export.xml).
          entry.ondata = () => {};
          entry.start();
          return;
        }
        foundXml = true;
        entry.ondata = (err, data, final) => {
          if (err) {
            error = err;
            return;
          }
          scanner.push(decoder.decode(data, { stream: !final }));
          if (final) xmlDone = true;
        };
        entry.start();
      })
    : null;
  unzip?.register(UnzipInflate);

  const reader = file.stream().getReader();
  let read = 0;
  let lastYield = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (value) {
      read += value.length;
      if (unzip) unzip.push(value, false);
      else scanner.push(decoder.decode(value, { stream: true }));
      if (error) throw error;
      onProgress?.(file.size ? Math.min(1, read / file.size) : 0);
      // Let the browser repaint during long exports.
      if (Date.now() - lastYield > 100) {
        await new Promise((r) => setTimeout(r, 0));
        lastYield = Date.now();
      }
    }
    if (done) break;
    if (xmlDone) {
      // Everything after export.xml (routes, ECGs, clinical records) is not needed.
      await reader.cancel();
      break;
    }
  }
  if (unzip && !xmlDone) unzip.push(new Uint8Array(0), true);
  else scanner.push(decoder.decode());
  if (error) throw error;
  const { skipped } = scanner.end();
  return { workouts, skipped, foundXml };
}

// ---------------------------------------------------------------------------
// Health Auto Export (JSON, v1 and v2)

type Quantity = { qty?: unknown; units?: unknown } | number | null | undefined;
const qty = (q: Quantity) => (typeof q === "number" ? q : q && typeof q === "object" ? num(q.qty) : null);
const units = (q: Quantity) => (q && typeof q === "object" && typeof q.units === "string" ? q.units : null);

/**
 * Converts one Health Auto Export workout. Field names follow the app's JSON
 * export: v2 has `id`, `duration` in seconds, nested `heartRate.avg/max`,
 * `avgHeartRate`, `distance`, `activeEnergyBurned`, `elevationUp`,
 * `isIndoor`; v1 has only `heartRateData`, `activeEnergy`, `elevation` and
 * a duration that is not always in seconds.
 */
export function parseAutoExportWorkout(raw: unknown): AppleWorkout | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const name = typeof w.name === "string" ? w.name.trim() : "";
  const start = parseAppleDate(typeof w.start === "string" ? w.start : null);
  const end = parseAppleDate(typeof w.end === "string" ? w.end : null);
  if (!name || !start) return null;

  // Prefer the stated duration (excludes pauses), but only if it matches the span in seconds or minutes.
  const span = end ? (end.date.getTime() - start.date.getTime()) / 1000 : null;
  const d = num(w.duration);
  let durationSec: number | null = null;
  if (d !== null && d > 0 && span !== null) {
    const tolerance = span * 0.1 + 60;
    if (d <= span + tolerance && d >= span * 0.3) durationSec = d;
    else if (d * 60 <= span + tolerance && d * 60 >= span * 0.3) durationSec = d * 60;
  } else if (d !== null && d > 0) durationSec = d;
  if (durationSec === null && span !== null && span > 0) durationSec = span;
  if (!positive(durationSec)) return null;

  const hr = (w.heartRate ?? {}) as { avg?: Quantity; max?: Quantity };
  const series = Array.isArray(w.heartRateData) ? (w.heartRateData as Record<string, unknown>[]) : [];
  const seriesAvg = series.map((p) => num(p.Avg) ?? num(p.avg) ?? num(p.qty)).filter((n): n is number => n !== null && n > 0);
  const seriesMax = series.map((p) => num(p.Max) ?? num(p.max) ?? num(p.qty)).filter((n): n is number => n !== null && n > 0);
  const avgHr = positive(qty(hr.avg)) ?? positive(qty(w.avgHeartRate as Quantity)) ?? (seriesAvg.length ? seriesAvg.reduce((a, b) => a + b, 0) / seriesAvg.length : null);
  const maxHr = positive(qty(hr.max)) ?? positive(qty(w.maxHeartRate as Quantity)) ?? (seriesMax.length ? Math.max(...seriesMax) : null);

  const distance = w.distance as Quantity;
  const distanceM = positive(toMetres(qty(distance), units(distance) ?? "km"));
  const energy = (w.activeEnergyBurned ?? w.activeEnergy) as Quantity | Quantity[];
  const calories = Array.isArray(energy)
    ? positive(energy.reduce<number>((sum, e) => sum + (toKcal(qty(e), units(e)) ?? 0), 0))
    : positive(toKcal(qty(energy), units(energy)));
  const elevation = w.elevationUp as Quantity;
  const legacyElevation = w.elevation as { ascent?: unknown; units?: unknown } | undefined;
  const elevationGainM =
    positive(toMetres(qty(elevation), units(elevation) ?? "m")) ?? positive(toMetres(legacyElevation?.ascent, typeof legacyElevation?.units === "string" ? legacyElevation.units : "m"));
  const indoor = typeof w.isIndoor === "boolean" ? w.isIndoor : typeof w.location === "string" ? /indoor/i.test(w.location) : /\bindoor\b/i.test(name) ? true : null;

  return {
    type: name,
    start: start.date.toISOString(),
    utcOffsetSec: start.offsetSec,
    durationSec: Math.round(durationSec as number),
    distanceM: distanceM === null ? null : Math.round(distanceM),
    calories: calories === null ? null : Math.round(calories),
    avgHr: avgHr === null ? null : Math.round(avgHr),
    maxHr: maxHr === null ? null : Math.round(maxHr),
    avgPower: null,
    elevationGainM,
    indoor,
    source: typeof w.source === "string" ? w.source : null,
    id: typeof w.id === "string" && w.id ? w.id : null,
  };
}

/** Workouts of a Health Auto Export payload ({ data: { workouts: [...] } }); metrics are ignored. */
export function parseAutoExportPayload(body: unknown): { workouts: AppleWorkout[]; skipped: number; metricsOnly: boolean } {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  const list = data && typeof data === "object" ? (data as { workouts?: unknown }).workouts : null;
  const metrics = data && typeof data === "object" ? (data as { metrics?: unknown }).metrics : null;
  if (!Array.isArray(list)) return { workouts: [], skipped: 0, metricsOnly: Array.isArray(metrics) };
  const workouts: AppleWorkout[] = [];
  let skipped = 0;
  for (const raw of list) {
    const w = parseAutoExportWorkout(raw);
    if (w) workouts.push(w);
    else skipped++;
  }
  return { workouts, skipped, metricsOnly: false };
}
