import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';
import { checkDurableRateLimit } from '@/lib/durableRateLimit';
import { uploadKycDocument } from '@/services/partners/partnerKyc';

export const runtime = 'nodejs';

/** Upload or replace one KYC document. multipart/form-data: kind, file. */
export async function POST(req: Request) {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;

  const partnerId = String(auth.partner._id);
  const rate = await checkDurableRateLimit(`partner-kyc-upload:${partnerId}`, 40, 60 * 60 * 1000);
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: 'Too many uploads. Please try again in an hour.' }, { status: 429 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file');
    const result = await uploadKycDocument(partnerId, form.get('kind'), file instanceof File ? file : null);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    return NextResponse.json({ success: true, data: { document: result.document, kycStatus: result.kycStatus } });
  } catch (error: any) {
    console.error('[partner/kyc/documents] upload failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Upload failed. Please try again.' }, { status: 500 });
  }
}
