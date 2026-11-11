import { NextRequest, NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { readKycDocument } from '@/services/partners/partnerKyc';
import { kycFileResponse } from '@/lib/partners/kycFileResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** View one of the signed-in partner's own KYC documents. */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/partner/kyc/documents/[docId]'>) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const { docId } = await ctx.params;
    const doc = await readKycDocument(String(auth.partner._id), docId);
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return kycFileResponse(doc);
  } catch (error: any) {
    console.error('[partner/kyc/documents] read failed:', error?.message);
    return NextResponse.json({ error: 'Could not open the document' }, { status: 500 });
  }
}
