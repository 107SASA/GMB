import twilio from 'twilio';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';

const client = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

export const sendSMS = async (businessId: string, to: string, customerName: string, service: string, reviewLink: string, businessName: string) => {
  await dbConnect();
  const business = await Business.findById(businessId);
  
  if (!business || !business.integrations?.twilioSid || !business.integrations?.twilioAuthToken) {
    console.warn(`Twilio client not initialized for business ${businessId}. Mocking SMS send.`);
    return { success: true, sid: 'mock_sid_sms' };
  }

  const client = twilio(business.integrations.twilioSid, business.integrations.twilioAuthToken);
  const fromNumber = business.integrations.whatsappNumber || process.env.TWILIO_FROM_NUMBER;

  try {
    const body = `Hi ${customerName}! Thank you for visiting ${businessName} for your ${service || 'visit'}. Would you mind leaving us a quick Google review? ${reviewLink} (Reply STOP to opt out)`;

    const msg = await client.messages.create({
      body,
      from: fromNumber,
      to,
    });

    console.log(`✅ SMS sent to ${to}: ${msg.sid}`);
    return { success: true, sid: msg.sid };
  } catch (error: any) {
    console.error('❌ SMS error:', error.message);
    return { success: false, error: error.message };
  }
};

export const sendTwilioVerify = async (phone: string) => {
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!client || !verifyServiceSid) {
    console.warn(`[Mock Twilio Verify] Sent OTP to ${phone}`);
    return { success: true };
  }
  
  try {
    const verification = await client.verify.v2.services(verifyServiceSid)
      .verifications
      .create({ to: phone, channel: 'sms' });
      
    return { success: true, status: verification.status };
  } catch (error: any) {
    console.error('Twilio Verify Send Error:', error);
    return { success: false, error: error.message };
  }
};

export const checkTwilioVerify = async (phone: string, code: string) => {
  const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!client || !verifyServiceSid) {
    console.warn(`[Mock Twilio Verify] Checked OTP ${code} for ${phone}`);
    return { success: true, valid: code.length === 6 }; // naive mock validation
  }

  try {
    const verificationCheck = await client.verify.v2.services(verifyServiceSid)
      .verificationChecks
      .create({ to: phone, code });
      
    return { success: true, valid: verificationCheck.status === 'approved' };
  } catch (error: any) {
    console.error('Twilio Verify Check Error:', error);
    return { success: false, error: error.message };
  }
};
