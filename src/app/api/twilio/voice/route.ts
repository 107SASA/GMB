import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import Lead from '@/models/Lead';
import Activity from '@/models/Activity';
import { inngest } from '@/services/inngest/client';

// Twilio calls this endpoint when someone calls the business's Twilio number.
// We log the caller as a Lead in the CRM and return empty TwiML.
// NOTE: This requires a real Twilio voice-capable number (not the WhatsApp sandbox).
//       In Twilio Console → Phone Numbers → your number → Voice Configuration →
//       set "A call comes in" webhook to: https://your-domain.com/api/twilio/voice
export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const callSid     = formData.get('CallSid') as string;
    const from        = formData.get('From') as string;       // caller's number e.g. +919876543210
    const toPayload   = formData.get('To') as string;         // business's Twilio number e.g. +14155238886
    const callerName  = formData.get('CallerName') as string; // CNAM lookup result, may be empty
    const callStatus  = formData.get('CallStatus') as string; // ringing | in-progress | etc.

    if (!from) {
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    await dbConnect();

    // Look up the business by the number that was called
    const normalizedTo = toPayload?.replace(/\+/g, '').trim() ?? '';
    const business = await Business.findOne({
      $or: [
        { 'integrations.whatsappNumber': toPayload },
        { 'integrations.whatsappNumber': normalizedTo },
        { 'whatsappConfig.businessPhone': toPayload },
        { 'whatsappConfig.businessPhone': normalizedTo },
      ],
    });

    if (!business) {
      console.error(`[voice-webhook] No business found for called number: ${toPayload}`);
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    const tenantId   = business.organizationId.toString();
    const businessId = business._id;

    // Find or create the lead from the caller's number
    let lead = await Lead.findOne({ phone: from, businessId });
    const isNewLead = !lead;

    if (!lead) {
      lead = await Lead.create({
        tenantId,
        businessId,
        name: callerName?.trim() || from,
        phone: from,
        source: 'Phone Call',
        pipelineStage: 'New',
        status: 'active',
      });

      // Trigger AI lead scoring + follow-up scheduling
      await inngest.send({
        name: 'crm/lead-created',
        data: { leadId: lead._id.toString() },
      });
    }

    // Log the inbound call as a CRM activity
    await Activity.create({
      tenantId,
      leadId: lead._id,
      type: 'call',
      content: `Inbound call${callerName ? ` from ${callerName}` : ''} (${from}) — status: ${callStatus || 'ringing'}`,
      metadata: {
        callSid,
        direction: 'inbound',
        callerName: callerName || null,
        callStatus,
        isNewLead,
      },
    });

    console.log(`[voice-webhook] Lead ${isNewLead ? 'created' : 'updated'}: ${lead._id} | caller: ${from} | business: ${businessId}`);

    // Return empty TwiML — Twilio will follow its own call-handling rules
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });

  } catch (error) {
    console.error('[voice-webhook] Error:', error);
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
