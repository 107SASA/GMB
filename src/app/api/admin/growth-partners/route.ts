import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import GrowthPartner from '@/models/GrowthPartner';
import PartnerInvite from '@/models/PartnerInvite';
import { effectivePartnerInviteStatus } from '@/lib/partners/partnerRules';

/** All Growth Partners with their terms and the state of their latest invite. */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();
    const partners = await GrowthPartner.find()
      .select('-termsHistory -kyc')
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean<any[]>();

    const invites = await PartnerInvite.find({ growthPartnerId: { $in: partners.map((p) => p._id) } })
      .select('growthPartnerId status expiresAt createdAt')
      .sort({ createdAt: -1 })
      .lean<any[]>();
    const latest = new Map<string, any>();
    for (const inv of invites) {
      const key = String(inv.growthPartnerId);
      if (!latest.has(key)) latest.set(key, inv);
    }

    const now = new Date();
    const data = partners.map((p) => {
      const inv = latest.get(String(p._id));
      return {
        ...p,
        invite: inv ? { status: effectivePartnerInviteStatus(inv, now), expiresAt: inv.expiresAt } : null,
      };
    });
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('[admin/growth-partners] GET failed:', error?.message);
    return NextResponse.json({ success: false, error: 'Failed to load partners' }, { status: 500 });
  }
}
