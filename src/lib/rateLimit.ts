/**
 * Lightweight in-memory rate limiter (fixed window).
 *
 * Protects auth endpoints (login, password reset, OTP) from brute-force and
 * credential-stuffing. Keyed by whatever string you pass — typically the client
 * IP, or IP+email for login.
 *
 * SCALING NOTE: this state lives in the process memory of a single server, so
 * it is per-instance. That is correct and sufficient for a single-node deploy
 * (the current setup). If you later run multiple instances behind a load
 * balancer, swap the Map for a shared store (Redis / Upstash) — keep this same
 * `checkRateLimit` signature and only the storage changes.
 */

interface Bucket {
  count: number;
  resetAt: number; // epoch ms when the window rolls over
}

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the Map can't grow unbounded from one-off keys.
let lastSweep = Date.now();
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * @param key       unique identifier for the caller (e.g. `login:<ip>:<email>`)
 * @param limit     max attempts allowed within the window
 * @param windowMs  window length in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/** Clear a key early — e.g. on a successful login, so a good user isn't throttled. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Best-effort client IP from proxy headers (works behind Vercel/DO/NGINX). */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
