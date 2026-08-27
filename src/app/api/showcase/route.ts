import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import ShowcaseAsset from '@/models/ShowcaseAsset';
import { toFriendlyMessage } from '@/lib/errors/friendlyMessage';

/** The caller's own showcase submissions, newest first — every status included. */
export async function GET() {
  const ctx = await requireBusinessContext();
  if (!ctx.ok) return ctx.response;

  try {
    const assets = await ShowcaseAsset.find({ businessId: ctx.businessId })
      .sort({ createdAt: -1 })
      .lean();
    return NextResponse.json({ success: true, assets });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: toFriendlyMessage(err) }, { status: 500 });
  }
}
