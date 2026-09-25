import "server-only";
import { ProviderError } from "./types";

/** fetch with timeout and uniform error mapping. */
export async function providerFetch(provider: string, url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const detail = body.slice(0, 300).replace(/\s+/g, " ");
      if (res.status === 401) throw new ProviderError(`${provider}: Autorisierung abgelaufen (${detail || res.statusText})`, 401, true);
      if (res.status === 429) throw new ProviderError(`${provider}: zu viele Anfragen, bitte später erneut versuchen.`, 429);
      throw new ProviderError(`${provider}: Fehler ${res.status}${detail ? ` – ${detail}` : ""}`, res.status);
    }
    return res;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new ProviderError(`${provider}: Zeitüberschreitung`);
    throw new ProviderError(`${provider}: Netzwerkfehler (${e instanceof Error ? e.message : String(e)})`);
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the UTC instant of local noon on a calendar day in a time zone. */
export function localNoonInstant(date: string, timeZone: string): Date {
  const nominal = Date.parse(`${date}T12:00:00Z`);
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return new Date(nominal);
  }
  let candidate = nominal;
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(candidate).map((p) => [p.type, p.value]));
    const wall = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const adjustment = nominal - wall;
    if (!adjustment) break;
    candidate += adjustment;
  }
  return new Date(candidate);
}
