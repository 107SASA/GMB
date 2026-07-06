import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Activity from '@/models/Activity';
import FollowUp from '@/models/FollowUp';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';
import { requireModule } from '@/lib/moduleGating';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;
    const gate = await requireModule(ctx.userId, 'sales_agent');
    if (!gate.ok) return gate.response;

    const resolvedParams = await params;
    const { id } = resolvedParams;

    await dbConnect();

    const lead = await Lead.findOne({
      _id: id,
      $or: [
        { businessId: ctx.businessId },
        { tenantId: ctx.organizationId },
      ],
    }).lean();
    if (!lead) return NextResponse.json({ error: 'Lead not found or unauthorized' }, { status: 404 });

    const [activities, followUps] = await Promise.all([
      Activity.find({ leadId: id }).sort({ createdAt: -1 }).lean(),
      FollowUp.find({ leadId: id }).sort({ createdAt: -1 }).lean()
    ]);

    const timeline = [
      ...activities.map(a => ({ ...a, timelineType: 'activity', date: a.createdAt })),
      ...followUps.map(f => ({ ...f, timelineType: 'followUp', date: f.createdAt }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({ success: true, timeline });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
