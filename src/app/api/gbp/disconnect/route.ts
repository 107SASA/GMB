import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import Business from '@/models/Business';
import { requireBusinessContext } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Disconnects the active workspace from Google Business Profile: removes the
 * stored OAuth token and flips the workspace back to not-connected. The next
 * "Connect" runs the full OAuth consent again (the auth route forces
 * prompt=consent), minting a fresh token — which is exactly what you want when
 * re-testing the connection or after switching OAuth clients.
 */
export async function POST() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  await dbConnect();
  await GBPToken.deleteOne({ businessId: ctx.businessId });
  await Business.updateOne(
    { _id: ctx.businessId },
    { $set: { googleConnected: false }, $unset: { googleLocationId: '' } }
  );

  return NextResponse.json({ success: true });
}
