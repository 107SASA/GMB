import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import GrowthPartner from '@/models/GrowthPartner';
import { getSession } from '@/lib/session';
import { isSessionEpochValid } from '@/lib/sessionEpoch';

/**
 * Growth Partner session guard — the partner-side twin of requireSuperAdmin.
 *
 * Every /api/partner/* route and the /partner layout go through this. It
 * resolves the GrowthPartner from the SESSION user, never from anything in
 * the request, so a partner can only ever act as themselves. Suspended
 * partners are locked out.
 */

export type PartnerAuthResult =
  | { ok: true; userId: string; user: any; partner: any }
  | { ok: false; status: number; error: string; code?: string };

export async function resolveGrowthPartner(): Promise<PartnerAuthResult> {
  try {
    await dbConnect();
    const session = await getSession();
    if (!session) return { ok: false, status: 401, error: 'Please sign in to your partner account.' };

    const user = await User.findById(session.userId).lean<any>();
    if (!user || user.role !== 'GROWTH_PARTNER' || user.isDeleted) {
      return { ok: false, status: 403, error: 'This page is for Growth Partners only.' };
    }
    if (!isSessionEpochValid(session.sessionEpoch, user.sessionEpoch)) {
      return { ok: false, status: 401, error: 'Session expired. Please sign in again.', code: 'SESSION_INVALIDATED' };
    }

    const partner = await GrowthPartner.findOne({ userId: user._id }).lean<any>();
    if (!partner) return { ok: false, status: 403, error: 'Partner profile not found.' };
    if (partner.status === 'suspended') {
      return { ok: false, status: 403, error: 'Your partner account is suspended. Please contact us.', code: 'PARTNER_SUSPENDED' };
    }

    return { ok: true, userId: String(user._id), user, partner };
  } catch (err: any) {
    console.error('[partnerAuth] check failed:', err?.message);
    return { ok: false, status: 500, error: 'Server error during partner auth check' };
  }
}

/** For API routes: the same result, with a ready JSON response on failure. */
export async function requireGrowthPartner(): Promise<
  | { ok: true; userId: string; user: any; partner: any }
  | { ok: false; response: NextResponse }
> {
  const r = await resolveGrowthPartner();
  if (r.ok) return r;
  return {
    ok: false,
    response: NextResponse.json({ success: false, error: r.error, code: r.code }, { status: r.status }),
  };
}
