/** Formatting helpers. All user-facing output is German (de-DE). */

export function formatDuration(totalSeconds: number, opts: { compact?: boolean } = {}): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (opts.compact) {
    if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
    if (m > 0) return sec > 0 ? `${m}:${String(sec).padStart(2, "0")} min` : `${m} min`;
    return `${sec} s`;
  }
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Hours with one decimal, e.g. "7,5 h". */
export function formatHours(seconds: number): string {
  return `${formatNumber(seconds / 3600, 1)} h`;
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${formatNumber(meters / 1000, meters >= 100_000 ? 0 : 1)} km`;
  return `${Math.round(meters)} m`;
}

/** Pace in seconds per km -> "4:45". */
export function formatPace(secondsPerKm: number): string {
  if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "–";
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Parse "4:45" -> 285 seconds. Returns null on invalid input. */
export function parsePace(text: string): number | null {
  const m = /^\s*(\d{1,2}):([0-5]\d)\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatSpeedKmh(metersPerSecond: number): string {
  return `${formatNumber(metersPerSecond * 3.6, 1)} km/h`;
}

const DATE_FMT = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" });
const DATE_SHORT_FMT = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
const WEEKDAY_LONG_FMT = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });

export function formatDate(d: Date | number): string {
  return DATE_FMT.format(d);
}
export function formatDateShort(d: Date | number): string {
  return DATE_SHORT_FMT.format(d);
}
export function formatWeekday(d: Date | number): string {
  return WEEKDAY_FMT.format(d).replace(".", "");
}
export function formatDayLong(d: Date | number): string {
  return WEEKDAY_LONG_FMT.format(d);
}

export function relativeTime(date: Date | number, now = Date.now()): string {
  const t = typeof date === "number" ? date : date.getTime();
  const diff = Math.round((now - t) / 1000);
  if (diff < 60) return "gerade eben";
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return "gestern";
  if (days < 7) return `vor ${days} Tagen`;
  return formatDate(t);
}
