import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import PartnerApplication from '@/models/PartnerApplication';
import GrowthPartner from '@/models/GrowthPartner';
import PartnerCommission from '@/models/PartnerCommission';

/** What needs the team: new applications, KYC to review, commissions ready to approve. For the sidebar badge. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  try {
    await dbConnect();
    const [applications, kyc, commissions] = await Promise.all([
      PartnerApplication.countDocuments({ status: 'pending' }),
      GrowthPartner.countDocuments({ kycStatus: 'submitted' }),
      PartnerCommission.countDocuments({ status: 'pending', availableAt: { $lte: new Date() } }),
    ]);
    return NextResponse.json({ success: true, applications, kyc, commissions, total: applications + kyc + commissions });
  } catch (error: any) {
    console.error('[admin/growth-partners/attention] failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed' }, { status: 500 });
  }
}
