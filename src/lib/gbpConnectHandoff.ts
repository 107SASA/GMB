import crypto from 'crypto';
import mongoose from 'mongoose';

import dbConnect from '@/lib/mongodb';
import { isSessionEpochValid } from '@/lib/sessionEpoch';
import Business from '@/models/Business';
import GbpConnectHandoff from '@/models/GbpConnectHandoff';
import User from '@/models/User';

/**
 * App → web handoff for "Connect Google Business Profile" (iOS and Android).
 *
 * GBP OAuth (/api/auth/google → Google → /api/auth/google/callback) needs a
 * web session cookie and an `activeBusinessId` cookie. The apps sign in with a
 * bearer token, not a cookie: the iOS in-app browser shares no cookies, and an
 * Android Chrome Custom Tab only has whatever Chrome holds (usually no session,
 * or another workspace's), so /api/auth/google answered 401 there.
 *
 *  1. The app (bearer session + x-business-id, verified by
 *     requireBusinessContext) asks POST /api/auth/google/mobile-handoff for a
 *     handoff → a random 256-bit token, stored hashed, valid HANDOFF_TTL_MS,
 *     usable once.
 *  2. The app opens /api/auth/google/mobile-handoff/<token> in an ephemeral
 *     in-app browser session. That route consumes the token atomically,
 *     re-checks the user and workspace, sets a WEB_SESSION_TTL web session +
 *     the workspace cookie, and redirects to the unchanged /api/auth/google.
 *
 * The OAuth state check, code exchange, token storage and location picker are
 * the existing web flow, untouched. No Google access/refresh token and no
 * long-lived credential ever appears in a URL.
 */

export const HANDOFF_TTL_MS = 2 * 60 * 1000;
/** Long enough for Google consent + the multi-location picker, no longer. */
export const WEB_SESSION_TTL_SECONDS = 15 * 60;

const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const hashToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

/** Same ownership rule as requireBusinessContext (src/lib/tenant.ts). */
async function userCanAccessBusiness(user: any, businessId: string): Promise<boolean> {
  if (!mongoose.isValidObjectId(businessId)) return false;
  if (user.role === 'SUPER_ADMIN') return !!(await Business.exists({ _id: businessId }));
  const ownership: any[] = [{ userId: user._id }];
  if (user.organizationId) ownership.push({ organizationId: user.organizationId });
  return !!(await Business.exists({ _id: businessId, $or: ownership }));
}

export async function issueGbpConnectHandoff(params: {
  userId: string;
  businessId: string;
  sessionEpoch: number;
  now?: number;
}): Promise<{ rawToken: string; expiresAt: Date }> {
  await dbConnect();
  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date((params.now ?? Date.now()) + HANDOFF_TTL_MS);
  await GbpConnectHandoff.create({
    tokenHash: hashToken(rawToken),
    userId: params.userId,
    businessId: params.businessId,
    sessionEpoch: params.sessionEpoch,
    expiresAt,
  });
  return { rawToken, expiresAt };
}

export type ConsumeResult =
  | { ok: true; userId: string; role: string; sessionEpoch: number; businessId: string }
  | { ok: false; reason: 'invalid' | 'expired_or_used' | 'session_revoked' | 'workspace_denied' };

/**
 * Consumes a handoff exactly once. Unknown, malformed, expired and replayed
 * tokens all fail; so does a token whose user signed out everywhere, was
 * deleted, or lost access to the workspace since it was issued.
 */
export async function consumeGbpConnectHandoff(rawToken: string, now: number = Date.now()): Promise<ConsumeResult> {
  if (typeof rawToken !== 'string' || !TOKEN_PATTERN.test(rawToken)) return { ok: false, reason: 'invalid' };
  await dbConnect();

  const handoff: any = await GbpConnectHandoff.findOneAndUpdate(
    { tokenHash: hashToken(rawToken), usedAt: null, expiresAt: { $gt: new Date(now) } },
    { $set: { usedAt: new Date(now) } },
    { new: true }
  ).lean();
  if (!handoff) return { ok: false, reason: 'expired_or_used' };

  const user: any = await User.findById(handoff.userId)
    .select('role organizationId sessionEpoch isDeleted')
    .lean();
  if (!user || user.isDeleted || !isSessionEpochValid(handoff.sessionEpoch, user.sessionEpoch)) {
    return { ok: false, reason: 'session_revoked' };
  }

  const businessId = String(handoff.businessId);
  if (!(await userCanAccessBusiness(user, businessId))) return { ok: false, reason: 'workspace_denied' };

  return { ok: true, userId: String(user._id), role: user.role, sessionEpoch: user.sessionEpoch ?? 0, businessId };
}
