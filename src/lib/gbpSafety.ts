/**
 * GBP live-write safety switch.
 *
 * WHY THIS EXISTS
 * ---------------
 * Publishing a post or a review reply pushes content onto a REAL customer's
 * Google Business Profile. Until we have tested the full flow end-to-end on our
 * own test account, no code path is allowed to write to a live profile.
 *
 * Today every "publish"/"post reply" path is intentionally a mock (it only
 * updates our own database and never calls Google). This flag guarantees it
 * STAYS that way: any future code that adds a real Google write MUST call
 * `assertGbpWritesAllowed()` first, so it is impossible to ship live posting by
 * accident. Flipping the single env var `GBP_LIVE_WRITES_ENABLED=true` is the
 * only way to enable real writes — and we will only do that after testing.
 */

export const GBP_LIVE_WRITES_ENABLED =
  process.env.GBP_LIVE_WRITES_ENABLED === 'true';

export class GbpWriteBlockedError extends Error {
  constructor(action: string) {
    super(
      `Live GBP write blocked: "${action}". Writing to real Google Business ` +
        `Profiles is disabled. Set GBP_LIVE_WRITES_ENABLED=true only after the ` +
        `flow has been verified on a test account.`
    );
    this.name = 'GbpWriteBlockedError';
  }
}

/**
 * Call this immediately before any code that pushes content to a real Google
 * Business Profile (a local post, a review reply, a profile edit, media upload,
 * etc.). Throws unless live writes have been explicitly enabled.
 *
 * @param action short human label of what is being attempted, e.g.
 *               "publish-post" or "post-review-reply". Used in the error/log.
 */
export function assertGbpWritesAllowed(action: string): void {
  if (!GBP_LIVE_WRITES_ENABLED) {
    throw new GbpWriteBlockedError(action);
  }
}

/**
 * Non-throwing variant for mock code paths: returns true only when real writes
 * are enabled. Use it to branch between "real Google call" and "mock/log only".
 */
export function gbpWritesEnabled(): boolean {
  return GBP_LIVE_WRITES_ENABLED;
}
