/**
 * Session-epoch comparison — the core of server-side session invalidation.
 *
 * Every issued session JWT / mobile bearer token embeds the value
 * `User.sessionEpoch` held at sign-in time (as the `sv` claim, see
 * src/lib/session.ts). On every request requireClient() / requireSuperAdmin()
 * / proxy.ts call this with (token epoch, user's current epoch) and reject the
 * request on a mismatch — so bumping the user's epoch
 * (src/lib/sessionInvalidation.ts) revokes every existing session immediately,
 * well before the token's own 30-day expiry.
 *
 * Zero dependencies on purpose: importable from a plain `node --test` file.
 *
 * `?? 0` on both sides: a pre-migration user has no `sessionEpoch` field and a
 * token minted before this feature carries no `sv` claim — both resolve to 0,
 * so existing sessions keep working until the FIRST invalidation for that
 * user (which sets the epoch to `Date.now()`, a value no old token can carry).
 */
export function isSessionEpochValid(
  tokenEpoch: number | undefined | null,
  userEpoch: number | undefined | null
): boolean {
  return (tokenEpoch ?? 0) === (userEpoch ?? 0);
}
