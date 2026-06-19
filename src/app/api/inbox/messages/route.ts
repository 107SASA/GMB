import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Conversation from '@/models/Conversation';
import ConversationThread from '@/models/ConversationThread';
import Activity from '@/models/Activity';
import mongoose from 'mongoose';
import { sendOutboundMessage } from '@/services/twilio/client';

export async function GET(req: Request) {
  try {
    await dbConnect();
    const url = new URL(req.url);
    const leadId = url.searchParams.get('leadId');
    if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 });

    const messages = await Conversation.find({ leadId: new mongoose.Types.ObjectId(leadId) })
      .sort({ timestamp: 1 })
      .lean();

    // Mark thread as read
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
    await dbConnect();
    const data = await req.json();
    const { leadId, businessId, tenantId, phone, text, threadId } = data;

    // Send via Twilio
    const twilioSid = await sendOutboundMessage(phone, text, leadId);

    // Save outbound message
    const msg = await Conversation.create({
      tenantId,
      businessId: new mongoose.Types.ObjectId(businessId),
      leadId: new mongoose.Types.ObjectId(leadId),
      direction: 'outbound',
      messageText: text,
      isAI: false, // Manual message
      messageStatus: 'sent',
      twilioSid: twilioSid || 'pending'
    });

    // Update thread: Disable AI upon manual intervention (Human Takeover)
    await ConversationThread.findByIdAndUpdate(threadId, {
      lastMessage: text,
      lastActivityAt: new Date(),
      aiEnabled: false,
      unreadCount: 0
    });

    // CRM Timeline
    await Activity.create({
      tenantId,
      leadId: new mongoose.Types.ObjectId(leadId),
      type: 'WhatsApp',
      content: text,
      metadata: { isAI: false }
    });

    return NextResponse.json({ success: true, message: msg });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
