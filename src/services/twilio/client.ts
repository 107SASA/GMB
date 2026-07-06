import twilio from 'twilio';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import MessageQueue from '@/models/MessageQueue';

export interface SendResult {
  success: boolean;
  sid?: string;
  error?: string;
}

export async function sendOutboundMessage(
  phone: string,
  body: string,
  leadId?: string,
  businessId?: string
): Promise<SendResult> {
  await dbConnect();

  let twilioSid = process.env.TWILIO_ACCOUNT_SID;
  let twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  let fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (businessId) {
    const business = await Business.findById(businessId);
    if (business?.integrations?.twilioSid && business?.integrations?.twilioAuthToken) {
      twilioSid = business.integrations.twilioSid;
      twilioAuthToken = business.integrations.twilioAuthToken;
      fromNumber = business.integrations.whatsappNumber || fromNumber;
    }
  }

  const msgLog = await MessageQueue.create({
    leadId,
    direction: 'OUTBOUND',
    status: 'PENDING',
    payload: { phone, body },
  });

  if (!twilioSid || !twilioAuthToken || !fromNumber) {
    const error = 'WhatsApp is not configured (missing Twilio credentials)';
    msgLog.status = 'FAILED';
    msgLog.error = error;
    await msgLog.save();
    console.error('Twilio Error:', error);
    return { success: false, error };
  }

  const client = twilio(twilioSid, twilioAuthToken);

  try {
    const message = await client.messages.create({
      body,
      from: `whatsapp:${fromNumber}`,
      to: `whatsapp:${phone}`
    });
    msgLog.status = 'SENT';
    msgLog.sentAt = new Date();
    await msgLog.save();
    return { success: true, sid: message.sid };
  } catch (e: any) {
    msgLog.status = 'FAILED';
    msgLog.error = e.message;
    await msgLog.save();
    console.error('Twilio Error:', e);
    return { success: false, error: e.message };
  }
}
