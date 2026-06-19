import twilio from 'twilio';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import MessageQueue from '@/models/MessageQueue';

export async function sendOutboundMessage(phone: string, body: string, leadId?: string, businessId?: string) {
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

  if (!twilioSid || !twilioAuthToken) return;

  const client = twilio(twilioSid, twilioAuthToken);
  
  const msgLog = await MessageQueue.create({
    leadId,
    direction: 'OUTBOUND',
    status: 'PENDING',
    payload: { phone, body },
  });

  try {
    const message = await client.messages.create({
      body,
      from: `whatsapp:${fromNumber}`,
      to: `whatsapp:${phone}`
    });
    msgLog.status = 'SENT';
    msgLog.sentAt = new Date();
    await msgLog.save();
    return message.sid;
  } catch (e: any) {
    msgLog.status = 'FAILED';
    msgLog.error = e.message;
    await msgLog.save();
    console.error('Twilio Error:', e);
  }
}
