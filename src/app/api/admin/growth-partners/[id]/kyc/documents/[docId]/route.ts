import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { adminReadKycDocument } from '@/services/partners/partnerKyc';
import { kycFileResponse } from '@/lib/partners/kycFileResponse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** View one partner KYC document. Each view is logged. */
export async function GET(_req: NextRequest, ctx: RouteContext<'/api/admin/growth-partners/[id]/kyc/documents/[docId]'>) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    const { id, docId } = await ctx.params;
    const doc = await adminReadKycDocument(id, docId, auth.userId);
    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return kycFileResponse(doc);
  } catch (error: any) {
    console.error('[admin/growth-partners/kyc/documents] read failed:', error?.message);
    return NextResponse.json({ error: 'Could not open the document' }, { status: 500 });
  }
}
