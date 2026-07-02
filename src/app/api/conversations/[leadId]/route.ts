import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Conversation from '@/models/Conversation';
import Lead from '@/models/Lead';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leadId: string }> }) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const resolvedParams = await params;
    const { leadId } = resolvedParams;

    const lead = await Lead.findOne({ _id: leadId, businessId: ctx.businessId }).lean();
    if (!lead) return NextResponse.json({ error: 'Lead not found or unauthorized' }, { status: 404 });

    const conversations = await Conversation.find({ leadId }).sort({ timestamp: 1 });
    return NextResponse.json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
