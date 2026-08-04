import { NextResponse } from 'next/server';
import crypto from 'crypto';
import dbConnect from '@/lib/mongodb';
import { requireBusinessContext } from '@/lib/tenant';
import PendingGbpConnection from '@/models/PendingGbpConnection';
import { decrypt } from '@/lib/crypto';
import { finalizeGbpConnection } from '@/lib/gbpConnect';

export const dynamic = 'force-dynamic';

/**
 * Completes the multi-location picker flow: takes the user's chosen
 * `locationId` (must be one of the staged candidates — never trusted
 * as-is), decrypts the staged tokens, and finalizes the connection via the
 * same helper the single-location OAuth callback path uses. Single-use: the
 * staging record is deleted on success so it can't be replayed.
 */
export async function POST(req: Request) {
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

  const body = await req.json().catch(() => null);
  const locationId = typeof body?.locationId === 'string' ? body.locationId : null;
  if (!locationId) {
    return NextResponse.json({ success: false, error: 'Please choose a location.' }, { status: 400 });
  }

  await dbConnect();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const pending = await PendingGbpConnection.findOne({ tokenHash });

  if (!pending) {
    return NextResponse.json({ success: false, error: 'This connection request has expired. Please reconnect.' }, { status: 404 });
  }
  if (pending.businessId.toString() !== ctx.businessId) {
    return NextResponse.json({ success: false, error: 'This connection request does not match your active workspace.' }, { status: 403 });
  }

  const chosen = pending.candidateLocations.find((l: any) => l.locationId === locationId);
  if (!chosen) {
    return NextResponse.json({ success: false, error: 'That location is not one of the available options.' }, { status: 400 });
  }

  await finalizeGbpConnection({
    businessId: pending.businessId.toString(),
    organizationId: pending.organizationId.toString(),
    googleAccountId: pending.googleAccountId,
    googleEmail: pending.googleEmail,
    accessToken: decrypt(pending.accessToken),
    refreshToken: decrypt(pending.refreshToken),
    expiresAt: pending.expiresAt,
    locationId: chosen.locationId,
    accountId: pending.accountId,
    scopes: pending.scopes,
  });

  await PendingGbpConnection.deleteOne({ _id: pending._id });

  const response = NextResponse.json({ success: true });
  response.cookies.set('gbp_pending_selection', '', { maxAge: 0, path: '/' });
  return response;
}
