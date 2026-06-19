import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ConversationThread from '@/models/ConversationThread';
import mongoose from 'mongoose';

export async function GET(req: Request) {
  try {
    await dbConnect();
    const url = new URL(req.url);
    const businessId = url.searchParams.get('businessId');
    if (!businessId) return NextResponse.json({ error: 'businessId required' }, { status: 400 });

    const threads = await ConversationThread.find({ businessId: new mongoose.Types.ObjectId(businessId) })
      .populate('leadId', 'name phone source pipelineStage aiLeadScore')
      .sort({ lastActivityAt: -1 })
      .lean();

    return NextResponse.json({ success: true, threads });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    await dbConnect();
    const data = await req.json();
    const { threadId, aiEnabled } = data;

    if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

    const thread = await ConversationThread.findByIdAndUpdate(
      threadId,
      { aiEnabled },
      { new: true }
    );

    return NextResponse.json({ success: true, thread });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
