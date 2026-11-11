import { NextResponse } from 'next/server';
import { requireGrowthPartner } from '@/lib/partners/partnerAuth';

/** The signed-in partner's own profile and commission terms. */
export async function GET() {
  const auth = await requireGrowthPartner();
  if (!auth.ok) return auth.response;
  const p = auth.partner;
  return NextResponse.json({
    success: true,
    data: {
      partnerCode: p.partnerCode,
      fullName: p.fullName,
      email: p.email,
      phone: p.phone,
      companyName: p.companyName,
      website: p.website ?? null,
      city: p.city,
      state: p.state,
      applicantType: p.applicantType,
      status: p.status,
      kycStatus: p.kycStatus,
      firstPaymentRate: p.firstPaymentRate,
      recurringRate: p.recurringRate,
      holdDays: p.holdDays,
      recurringMonths: p.recurringMonths ?? null,
    },
  });
}
