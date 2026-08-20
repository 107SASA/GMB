import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { publishAsset } from '@/lib/gbpMediaService';
import { GBPAuthError } from '@/lib/gbpClient';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

export const dynamic = 'force-dynamic';

/**
 * POST -> pushes a staged photo to the live Google profile. Explicit action
 * (not automatic on upload) so every photo gets a review step — see
 * gbpMediaService.publishAsset for the LOGO/COVER singleton swap-out logic.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;
  const { id } = await params;

  if (!ctx.business.googleConnected) {
    return NextResponse.json({ success: false, error: 'Connect your Google Business Profile first.' }, { status: 400 });
  }

  try {
    await dbConnect();
    const user = await User.findById(ctx.userId).select('fullName').lean();
    const { asset, liveWriteApplied } = await publishAsset(ctx.businessId, id, {
      organizationId: ctx.organizationId,
      name: (user as any)?.fullName || 'You',
    });
    return NextResponse.json({
      success: true,
      asset,
      liveWriteApplied,
      ...(liveWriteApplied ? {} : { note: 'Live GBP publishing is currently disabled — this photo stays staged until it\'s enabled.' }),
    });
  } catch (err: any) {
    if (err instanceof GBPAuthError) {
      return NextResponse.json({ success: false, error: 'Google connection expired — please reconnect.' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
