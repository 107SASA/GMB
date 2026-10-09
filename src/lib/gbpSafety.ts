/**
 * GBP live-write safety switch.
 *
 * WHY THIS EXISTS
 * ---------------
 * Publishing a post or a review reply pushes content onto a REAL customer's
 * Google Business Profile. Until we have tested the full flow end-to-end on our
 * own test account, no code path is allowed to write to a live profile.
 *
 * Today every real Google-write call site (a local post, a review reply, a
 * profile edit, media upload) branches on `gbpWritesEnabled()` and falls back
 * to a mock/log-only path when it's false — see lib/gbpClient.ts,
 * lib/gbpMediaService.ts, services/reviews/postReply.ts, and the scheduler/
 * publish routes for the actual call sites. Flipping the single env var
 * `GBP_LIVE_WRITES_ENABLED=true` is the only way to enable posts, review
 * replies, and photo upload or deletion. FR-5 profile execution and rollback
 * also require `GBP_FR5_LIVE_WRITES_ENABLED=true`. Either missing or any other
 * value keeps that path closed.
 *
 * (Sep 2026: this file used to also export a throwing `assertGbpWritesAllowed()`
 * as "the" required guard, but no call site ever actually used it — every real
 * one used `gbpWritesEnabled()` instead. Removed rather than left as
 * documentation for a pattern the code doesn't follow.)
 */

export const GBP_LIVE_WRITES_ENABLED =
  process.env.GBP_LIVE_WRITES_ENABLED === 'true';

/**
 * Returns true only when real Google writes are enabled. Branch on this
 * before any code that would push content to a real Google Business Profile;
 * fall back to a mock/log-only path when it's false.
 */
export function gbpWritesEnabled(): boolean {
  return GBP_LIVE_WRITES_ENABLED;
}

type WriteFlagEnv = { [key: string]: string | undefined };

/**
 * FR-5 profile execution and rollback only. Posts, review replies, and photos
 * keep using gbpWritesEnabled() and do not read the FR-5 flag.
 * Both values must be exactly "true". Anything else fails closed.
 */
export function fr5ProfileMutationAllowed(env?: WriteFlagEnv): boolean {
  const globalFlag = env ? env.GBP_LIVE_WRITES_ENABLED : process.env.GBP_LIVE_WRITES_ENABLED;
  const fr5Flag = env ? env.GBP_FR5_LIVE_WRITES_ENABLED : process.env.GBP_FR5_LIVE_WRITES_ENABLED;
  return globalFlag === 'true' && fr5Flag === 'true';
}

/** Calls patch only when both live-write flags allow an FR-5 mutation. */
export async function fr5GuardedPatch<T>(
  env: WriteFlagEnv,
  patch: () => Promise<T>,
): Promise<{ applied: false } | { applied: true; value: T }> {
  if (!fr5ProfileMutationAllowed(env)) return { applied: false };
  return { applied: true, value: await patch() };
}
