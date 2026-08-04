import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import PendingGbpConnection from '@/models/PendingGbpConnection';

export const dynamic = 'force-dynamic';

/**
 * Backs the multi-location picker page. Reads the opaque reference token set
 * by the OAuth callback (see src/app/api/auth/google/callback/route.ts) and
 * returns the candidate GBP locations for the user to choose from — never the
 * tokens themselves, which stay server-side until a choice is made (see
 * POST /api/gbp/select-location).
 */
export async function GET(req: Request) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  const cookieHeader = req.headers.get('cookie') ?? '';
  const rawToken = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('gbp_pending_selection='))
    ?.slice('gbp_pending_selection='.length);

  if (!rawToken) {
    return NextResponse.json({ success: false, error: 'No pending Google connection found.' }, { status: 404 });
  }

  await dbConnect();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const pending = await PendingGbpConnection.findOne({ tokenHash }).lean() as any;

  if (!pending) {
    return NextResponse.json({ success: false, error: 'This connection request has expired. Please reconnect.' }, { status: 404 });
  }

  // The pending record must belong to the CURRENTLY active workspace — stops
  // a stale/guessed reference token from being used against a different
  // workspace than the one that actually started this OAuth flow.
  if (pending.businessId.toString() !== ctx.businessId) {
    return NextResponse.json({ success: false, error: 'This connection request does not match your active workspace.' }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    googleEmail: pending.googleEmail,
    locations: (pending.candidateLocations ?? []).map((l: any) => ({
      locationId: l.locationId,
      title: l.title,
      address: l.address,
    })),
  });
}
