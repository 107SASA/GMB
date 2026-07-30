import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Business from '@/models/Business';
import User from '@/models/User';

/**
 * GrowwMatics' own sales pipeline — every workspace that has experienced the
 * product (completed its free audit) or paid, shaped to match the same
 * lead-card contract the business-owner CRM already uses (name/phone/email/
 * source/aiLeadScore/createdAt/pipelineStage) so the existing KanbanBoard
 * component can render it unmodified.
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const businesses = await Business.find({ pipelineStage: { $exists: true } })
      .select('name phone userId subscriptionStatus pipelineStage createdAt')
      .sort({ createdAt: -1 })
      .lean();

    const userIds = [...new Set(businesses.map((b: any) => b.userId?.toString()).filter(Boolean))];
    const users = await User.find({ _id: { $in: userIds } }).select('email fullName').lean();
    const userMap: Record<string, { email: string; fullName: string }> = {};
    users.forEach((u: any) => { userMap[u._id.toString()] = { email: u.email, fullName: u.fullName }; });

    const leads = businesses.map((b: any) => {
      const owner = userMap[b.userId?.toString()];
      return {
        _id: b._id.toString(),
        name: b.name || owner?.fullName || 'Unnamed business',
        phone: b.phone ?? null,
        email: owner?.email ?? null,
        source: 'Free Audit',
        aiLeadScore: null,
        subscriptionStatus: b.subscriptionStatus ?? 'trialing',
        pipelineStage: b.pipelineStage,
        createdAt: b.createdAt,
      };
    });

    const total = leads.length;
    const converted = leads.filter((l) => l.pipelineStage === 'Customer').length;

    return NextResponse.json({
      success: true,
      leads,
      stats: {
        total,
        converted,
        conversionRate: total > 0 ? Math.round((converted / total) * 100) : 0,
      },
    });
  } catch (error: any) {
    console.error('[admin/sales-leads] GET failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to load sales leads.' }, { status: 500 });
  }
}
