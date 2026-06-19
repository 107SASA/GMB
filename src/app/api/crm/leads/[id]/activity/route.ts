import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Activity from '@/models/Activity';
import Lead from '@/models/Lead';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params;
    const { id } = resolvedParams;
    const data = await req.json();
    
    await dbConnect();
    
    const lead = await Lead.findById(id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const activity = await Activity.create({
      tenantId: lead.tenantId,
      leadId: lead._id,
      type: data.type, // 'call' | 'note' | 'meeting' | 'email'
      content: data.content,
      metadata: data.metadata
    });

    lead.lastActivityAt = new Date();
    await lead.save();

    return NextResponse.json({ success: true, activity }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
