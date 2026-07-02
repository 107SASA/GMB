import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Lead from '@/models/Lead';
import ConversationThread from '@/models/ConversationThread';
import Business from '@/models/Business';
import mongoose from 'mongoose';
import { inngest } from '@/services/inngest/client';
import Customer from '@/models/Customer';

export async function POST(req: Request) {
  try {
    // Twilio sends form data
    const formData = await req.formData();
    
    const messageSid = formData.get('MessageSid') as string;
    const from = formData.get('From') as string;
    const toPayload = formData.get('To') as string;
    const body = formData.get('Body') as string;
    const profileName = formData.get('ProfileName') as string;
    const numMedia = parseInt(formData.get('NumMedia') as string || '0', 10);

    if (!from) return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' }});

    const phone = from.replace('whatsapp:', '');
    const toPhone = toPayload ? toPayload.replace('whatsapp:', '') : '';
    
    await dbConnect();
    
    // Normalize the number — strip '+' so both '+14155238886' and '14155238886' match
    const normalizedToPhone = toPhone.replace(/\+/g, '').trim();
    console.log(`[webhook] Incoming To: ${toPayload} | searching for: ${normalizedToPhone}`);
    console.log(`[webhook] DB name: ${mongoose.connection.db?.databaseName}`);
    const bizCount = await Business.countDocuments();
    console.log(`[webhook] Total businesses in DB: ${bizCount}`);

    const business = await Business.findOne({
      $or: [
        { 'integrations.whatsappNumber': toPhone },
        { 'integrations.whatsappNumber': normalizedToPhone },
        { 'whatsappConfig.businessPhone': toPhone },
        { 'whatsappConfig.businessPhone': normalizedToPhone },
      ]
    });

    console.log(`[webhook] Business lookup result: ${business?._id ?? 'NOT FOUND'}`);

    if (!business) {
      console.error(`No business found mapped to WhatsApp number: ${toPayload}`);
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' }});
    }

    const tenantId = business.organizationId.toString();
    const businessId = business._id;

    // 1. Fetch or Create Lead
    let lead = await Lead.findOne({ phone, businessId });
    if (!lead) {
      lead = await Lead.create({
        tenantId,
        businessId,
        name: profileName || phone,
        phone,
        source: 'WhatsApp',
        pipelineStage: 'New',
        status: 'active'
      });
      
      // Trigger CRM module lead creation hook
      await inngest.send({
        name: 'crm/lead-created',
        data: { leadId: lead._id.toString() }
      });
    }

    // 2. Fetch or Create Conversation Thread
    let thread = await ConversationThread.findOne({ leadId: lead._id });
    if (!thread) {
      thread = await ConversationThread.create({
        tenantId,
        businessId,
        leadId: lead._id,
        unreadCount: 1,
        lastMessage: numMedia > 0 ? '[Media]' : body,
        aiEnabled: true // AI is ON by default
      });
    } else {
      thread.unreadCount += 1;
      thread.lastMessage = numMedia > 0 ? '[Media]' : body;
      thread.lastActivityAt = new Date();
      await thread.save();
    }

    // 2.5 Opt-out processing (Module 9)
    const normalizedBody = body.trim().toUpperCase();
    if (['STOP', 'UNSUBSCRIBE', 'CANCEL'].includes(normalizedBody)) {
      await Customer.findOneAndUpdate(
        { phone, businessId },
        { optedOut: true }
      );
      // We can also disable AI for the thread so the bot doesn't reply
      thread.aiEnabled = false;
      await thread.save();
    }

    // 3. Immediately queue async AI processing
    // Do NOT call Groq/OpenAI here. Just push to Inngest.
    await inngest.send({
      name: 'whatsapp/incoming',
      data: {
        messageSid,
        from,
        body,
        profileName,
        numMedia,
        leadId: lead._id.toString(),
        threadId: thread._id.toString(),
        tenantId,
        businessId: businessId.toString()
      }
    });

    // 4. Return instant 200 OK to Twilio (Empty TwiML)
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });

  } catch (error) {
    console.error('Webhook Error:', error);
    // Still return 200 to prevent Twilio retry loops
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
