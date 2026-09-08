import dbConnect from '@/lib/mongodb';
import User from '@/models/User';

// Re-exported from the zero-dependency module so pure tests can import the
// predicate without pulling in mongoose.
export { isSessionEpochValid } from '@/lib/sessionEpoch';

/**
 * Server-side session invalidation.
 *
 * Every session JWT / mobile bearer token embeds the value `User.sessionEpoch`
 * held when it was issued (see src/lib/session.ts). requireClient(),
 * requireSuperAdmin() and proxy.ts compare that embedded value against the
 * user's CURRENT sessionEpoch on every request and reject the token on a
 * mismatch. Bumping the epoch here therefore invalidates every existing
 * session for that user — web cookies and mobile bearer tokens alike — well
 * before the token's own 30-day expiry.
 *
 * Call this on:
 *  - password reset            (src/app/api/auth/reset-password)
 *  - password change           (src/app/api/user/change-password — which then
 *                               immediately re-issues the CURRENT session so
 *                               the acting device stays signed in)
 *  - "log out everywhere"      (src/app/api/auth/logout?scope=all)
 *  - any future role change / account-security event
 *
 * Uses `Date.now()` (a monotonically increasing epoch) rather than an $inc
 * counter so it works correctly for pre-migration users whose sessionEpoch
 * field doesn't exist yet: `$inc` on a missing field would produce 1, which
 * collides with the bootstrap value old tokens resolve to. A timestamp never
 * collides with 0.
 *
 * Best-effort: logs and swallows failures so it can never turn a successful
 * password reset / logout into a 500. A failure here just means the old
 * sessions stay valid until their natural expiry — no worse than before this
 * feature existed.
 */
export async function invalidateUserSessions(
  userId: string,
  reason: string = 'security_event'
): Promise<number> {
  const epoch = Date.now();
  try {
    await dbConnect();
    await User.updateOne({ _id: userId }, { $set: { sessionEpoch: epoch } });
    console.log(`[session] invalidated all sessions for user ${userId} (${reason})`);
  } catch (err: any) {
    console.error(`[session] invalidateUserSessions failed for ${userId} (${reason}):`, err?.message);
  }
  return epoch;
}
