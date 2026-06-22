import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ConversationThread from '@/models/ConversationThread';
import mongoose from 'mongoose';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();

    const threads = await ConversationThread.find({
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    })
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
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const data = await req.json();
    const { threadId, aiEnabled } = data;

    if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 });

    const thread = await ConversationThread.findOne({
      _id: threadId,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });
    if (!thread) {
      return NextResponse.json({ error: 'Thread not found or access denied' }, { status: 403 });
    }

    thread.aiEnabled = aiEnabled;
    await thread.save();

    return NextResponse.json({ success: true, thread });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
