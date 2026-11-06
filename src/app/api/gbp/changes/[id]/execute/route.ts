import { NextResponse } from 'next/server';
import { requireBusinessContext } from '@/lib/tenant';
import { executeChange } from '@/services/gbp/changes/store';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import { hasGoogleAccess } from '@/lib/googleAccess';
import { googleAccessCopy } from '@/services/gbp/access/evaluate';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireBusinessContext();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  // Nothing is sent to Google until Google has confirmed we may edit this profile.
  await dbConnect();
  const biz: any = await Business.findById(auth.businessId).select('googleConnected googleAccess').lean();
  if (!hasGoogleAccess(biz)) {
    const copy = googleAccessCopy(biz?.googleAccess?.state, biz?.googleAccess?.reason);
    const error = copy && biz?.googleAccess?.state !== 'checking'
      ? `${copy.title}. Fix the Google access first (see the banner at the top), then apply this change.`
      : 'We are still confirming your Google access — try again in a few minutes.';
    return NextResponse.json({ success: false, error, accessProblem: true }, { status: 409 });
  }
  const result = await executeChange(id, { userId: auth.userId, businessId: auth.businessId });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error, change: 'change' in result ? result.change : null }, { status: 409 });
  return NextResponse.json({ success: true, change: result.change, liveWriteApplied: result.change.status === 'VERIFIED' });
}
