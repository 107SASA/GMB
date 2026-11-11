import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { partnerKycView, submitKyc } from '@/services/partners/partnerKyc';

/** The signed-in partner's KYC (PAN / account number masked). */
export async function GET() {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ success: true, data: partnerKycView(auth.partner) });
}

/** Submit KYC details for review (documents are uploaded first, one by one). */
export async function POST(req: Request) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await submitKyc(String(auth.partner._id), body);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: result.kyc });
  } catch (error: any) {
    console.error('[partner/kyc] submit failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Could not submit your KYC. Please try again.' }, { status: 500 });
  }
}
