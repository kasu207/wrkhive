import "server-only";

/**
 * Small in-memory fixed-window limiter (per process). Good enough for a single
 * instance; use a shared store (Redis) when running multiple instances.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count++;
  return b.count > limit ? { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) } : { ok: true, retryAfterSec: 0 };
}
