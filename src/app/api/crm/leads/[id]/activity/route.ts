import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Activity from '@/models/Activity';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const resolvedParams = await params;
    const { id } = resolvedParams;
    const data = await req.json();

    await dbConnect();

    // Accept leads matched by businessId OR tenantId so old records created before
    // the businessId fix was applied are still accessible by their real owner.
    const lead = await Lead.findOne({
      _id: id,
      $or: [
        { businessId: ctx.businessId },
        { tenantId: ctx.organizationId },
      ],
    });
    if (!lead) return NextResponse.json({ error: 'Lead not found or unauthorized' }, { status: 404 });

    const activity = await Activity.create({
      tenantId: ctx.organizationId,
      leadId: lead._id,
      type: data.type,
      content: data.content,
      metadata: data.metadata,
    });

    lead.lastActivityAt = new Date();
    await lead.save();

    return NextResponse.json({ success: true, activity }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
