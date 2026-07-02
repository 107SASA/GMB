import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Conversation from '@/models/Conversation';
import ConversationThread from '@/models/ConversationThread';
import Activity from '@/models/Activity';
import Lead from '@/models/Lead';
import mongoose from 'mongoose';
import { sendOutboundMessage } from '@/services/twilio/client';
import { requireBusinessContext } from '@/lib/tenant';

export async function GET(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    const url = new URL(req.url);
    const leadId = url.searchParams.get('leadId');
    if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 });

    // Verify the lead belongs to this business before returning its messages
    const lead = await Lead.findOne({
      _id: leadId,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found or access denied' }, { status: 403 });
    }

    const messages = await Conversation.find({ leadId: new mongoose.Types.ObjectId(leadId) })
      .sort({ timestamp: 1 })
      .lean();

    await ConversationThread.findOneAndUpdate(
      { leadId: new mongoose.Types.ObjectId(leadId) },
      { unreadCount: 0 }
    );

    return NextResponse.json({ success: true, messages });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// Send manual message
export async function POST(req: Request) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    await dbConnect();
    // businessId and tenantId come from verified session context — never from body
    const { leadId, phone, text, threadId } = await req.json();

    // Verify the lead belongs to this business
    const lead = await Lead.findOne({
      _id: leadId,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
    });
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found or access denied' }, { status: 403 });
    }

    const twilioSid = await sendOutboundMessage(phone, text, leadId, ctx.businessId);

    const msg = await Conversation.create({
      tenantId: ctx.organizationId,
      businessId: new mongoose.Types.ObjectId(ctx.businessId),
      leadId: new mongoose.Types.ObjectId(leadId),
      direction: 'outbound',
      messageText: text,
      isAI: false,
      messageStatus: 'sent',
      twilioSid: twilioSid || 'pending',
    });

    // Human takeover: disable AI for this thread
    await ConversationThread.findByIdAndUpdate(threadId, {
      lastMessage: text,
      lastActivityAt: new Date(),
      aiEnabled: false,
      unreadCount: 0,
    });

    await Activity.create({
      tenantId: ctx.organizationId,
      leadId: new mongoose.Types.ObjectId(leadId),
      type: 'WhatsApp',
      content: text,
      metadata: { isAI: false },
    });

    return NextResponse.json({ success: true, message: msg });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
