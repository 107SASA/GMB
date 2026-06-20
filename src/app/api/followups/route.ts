import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import FollowUp from '@/models/FollowUp';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET() {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    // Scope to leads belonging to this business via tenantId on the FollowUp record
    const followups = await FollowUp.find({ tenantId: ctx.organizationId })
      .populate('leadId', 'name phone aiLeadScore')
      .sort({ scheduledFor: -1 });

    return NextResponse.json(followups);
  } catch (error) {
    console.error('Error fetching followups:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
