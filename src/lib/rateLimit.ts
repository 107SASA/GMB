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

/**
 * Client IP as seen by our OWN trusted reverse proxy — safe to use as a
 * rate-limit key.
 *
 * Production topology is `Client -> Nginx -> Node` (DigitalOcean). The
 * attacker-controlled part of `X-Forwarded-For` is the LEFT side: a client
 * can send `X-Forwarded-For: 1.2.3.4` but Nginx
 * (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`) appends the
 * address it actually received the connection from, so the real client is
 * always the LAST entry — never the first. `X-Real-IP` (set by Nginx from
 * `$remote_addr`) is a single, un-appendable value and is preferred when
 * present.
 *
 * `TRUSTED_PROXY_COUNT` (default 1) is how many proxy hops WE run — bump it to
 * 2 if you put Cloudflare in front of Nginx, etc. We skip that many entries
 * from the end of `X-Forwarded-For`.
 *
 * IMPORTANT (documented in documentation/deployment/nginx-rate-limiting.md):
 * this is only sound if the Node port is NOT publicly reachable. If a client
 * can hit Node directly (bypassing Nginx), it can send a forged
 * `X-Forwarded-For`/`X-Real-IP` with no trusted hop to correct it. The Node
 * process MUST bind to 127.0.0.1 (or be firewalled to Nginx only).
 */
export function getClientIp(req: Request): string {
  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) return realIp.trim();

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) {
      const hops = Math.max(1, parseInt(process.env.TRUSTED_PROXY_COUNT || '1', 10) || 1);
      // The entry our outermost trusted proxy saw as the client.
      return parts[Math.max(0, parts.length - hops)];
    }
  }
  return 'unknown';
}

/**
 * Reads a burst-guard limit/window pair from env vars, falling back to the
 * caller's hardcoded defaults — so ops can tune a route's rate limit without
 * a code change/redeploy, without touching checkRateLimit's storage at all.
 * Invalid/non-positive env values fall back to the default rather than
 * silently disabling the limit (e.g. a blank or "0" env var).
 *
 * @param envPrefix   e.g. "CONTENT_GENERATE" reads CONTENT_GENERATE_RATE_LIMIT
 *                    and CONTENT_GENERATE_RATE_WINDOW_MS
 */
export function getRateLimitConfig(
  envPrefix: string,
  defaultLimit: number,
  defaultWindowMs: number
): { limit: number; windowMs: number } {
  const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    limit: parsePositiveInt(process.env[`${envPrefix}_RATE_LIMIT`], defaultLimit),
    windowMs: parsePositiveInt(process.env[`${envPrefix}_RATE_WINDOW_MS`], defaultWindowMs),
  };
}
