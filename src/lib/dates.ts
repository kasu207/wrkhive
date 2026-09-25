/**
 * Calendar-date helpers working on "YYYY-MM-DD" strings (local calendar days,
 * no time zone involved). Arithmetic is done in UTC to avoid DST drift.
 */

export type ISODate = string;

export function toISODate(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function parseISODate(s: ISODate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISODate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(a).getTime() - parseISODate(b).getTime()) / 86_400_000);
}

/** Monday of the week containing the date (ISO weeks start on Monday). */
export function startOfWeek(s: ISODate): ISODate {
  const d = parseISODate(s);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(s, -dow);
}

export function dayOfWeek(s: ISODate): number {
  return (parseISODate(s).getUTCDay() + 6) % 7;
}

/** A display Date at local noon for an ISO date (safe for Intl formatting). */
export function displayDate(s: ISODate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function isISODate(s: unknown): s is ISODate {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parseISODate(s).getTime());
}

export function isoWeekNumber(s: ISODate): number {
  const d = parseISODate(s);
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}
