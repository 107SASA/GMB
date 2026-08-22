import twilio from 'twilio';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import MessageQueue from '@/models/MessageQueue';

export interface SendResult {
  success: boolean;
  sid?: string;
  error?: string;
  /**
   * True when the failure is Twilio error 63016 — "Failed to send freeform
   * message because you are outside the allowed window. Please use a
   * Message Template." Callers use this to decide whether a Content
   * Template retry is the right recovery, as opposed to a real failure.
   */
  outsideWindow?: boolean;
  /**
   * False when a business has its own Twilio credentials configured
   * (business.integrations.twilioSid/twilioAuthToken) — in that case the
   * send went out on THEIR number, not GrowwMatics' own. Content Template
   * SIDs registered on GrowwMatics' WABA are only valid to send from
   * GrowwMatics' own number, so callers must check this before retrying
   * with one.
   */
  isPlatformDefault?: boolean;
}

interface TwilioCredentials {
  sid: string;
  authToken: string;
  fromNumber: string;
  isPlatformDefault: boolean;
  /**
   * Set only for the platform default (never for a business's own number —
   * a Messaging Service groups senders on GrowwMatics' own Twilio account,
   * not a tenant's). When present, Content Template sends use this instead
   * of a raw `from` number — Twilio's own recommended fix for error 63027
   * ("template does not exist for a language and locale"), which a raw
   * direct-number send hit consistently (see scripts/debug-content-send.mjs).
   */
  messagingServiceSid?: string;
}

/**
 * Resolves which Twilio account/number a send should use: a business's own
 * credentials if configured, otherwise GrowwMatics' shared platform number.
 * `integrations.twilioSid`/`twilioAuthToken` aren't in the current Business
 * schema (no tenant has ever been able to set them), so isPlatformDefault is
 * effectively always true today — this stays defensive for when that lands.
 */
async function resolveTwilioCredentials(businessId?: string): Promise<TwilioCredentials | null> {
  let sid = process.env.TWILIO_ACCOUNT_SID;
  let authToken = process.env.TWILIO_AUTH_TOKEN;
  let fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  let isPlatformDefault = true;

  if (businessId) {
    const business = await Business.findById(businessId);
    if ((business?.integrations as any)?.twilioSid && (business?.integrations as any)?.twilioAuthToken) {
      sid = (business.integrations as any).twilioSid;
      authToken = (business.integrations as any).twilioAuthToken;
      fromNumber = business.integrations?.whatsappNumber || fromNumber;
      isPlatformDefault = false;
    }
  }

  if (!sid || !authToken || !fromNumber) return null;
  return {
    sid,
    authToken,
    fromNumber,
    isPlatformDefault,
    messagingServiceSid: isPlatformDefault ? process.env.TWILIO_MESSAGING_SERVICE_SID : undefined,
  };
}

export async function sendOutboundMessage(
  phone: string,
  body: string,
  leadId?: string,
  businessId?: string,
  mediaUrl?: string
): Promise<SendResult> {
  await dbConnect();

  const creds = await resolveTwilioCredentials(businessId);

  const msgLog = await MessageQueue.create({
    leadId,
    direction: 'OUTBOUND',
    status: 'PENDING',
    payload: { phone, body },
  });

  if (!creds) {
    const error = 'WhatsApp is not configured (missing Twilio credentials)';
    msgLog.status = 'FAILED';
    msgLog.error = error;
    await msgLog.save();
    console.error('Twilio Error:', error);
    return { success: false, error };
  }

  const client = twilio(creds.sid, creds.authToken);

  try {
    const message = await client.messages.create({
      body,
      from: `whatsapp:${creds.fromNumber}`,
      to: `whatsapp:${phone}`,
      ...(mediaUrl ? { mediaUrl: [mediaUrl] } : {}),
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
    return {
      success: false,
      error: e.message,
      outsideWindow: e.code === 63016,
      isPlatformDefault: creds.isPlatformDefault,
    };
  }
}

/**
 * Sends an approved Twilio Content Template (a `growwmatics_*` template —
 * see src/lib/whatsappTemplates.ts) instead of free-form text. Required for
 * any business-initiated first touch, since Twilio/Meta reject free-form
 * sends once 24h have passed since the customer last messaged in.
 *
 * `variables` keys are the template's numbered placeholders as strings,
 * e.g. { '1': leadName, '2': businessName } for a template whose body reads
 * "Hi {{1}}, ... {{2}} ...".
 */
export async function sendTemplateMessage(
  phone: string,
  contentSid: string,
  variables: Record<string, string>,
  businessId?: string
): Promise<SendResult> {
  await dbConnect();

  const creds = await resolveTwilioCredentials(businessId);

  const msgLog = await MessageQueue.create({
    direction: 'OUTBOUND',
    status: 'PENDING',
    payload: { phone, contentSid, variables },
  });

  if (!creds) {
    const error = 'WhatsApp is not configured (missing Twilio credentials)';
    msgLog.status = 'FAILED';
    msgLog.error = error;
    await msgLog.save();
    console.error('Twilio Error:', error);
    return { success: false, error };
  }

  // Content Template SIDs are scoped to the WABA they were approved under —
  // only valid to send from GrowwMatics' own number.
  if (!creds.isPlatformDefault) {
    const error = 'Cannot send a GrowwMatics-approved template from a business-owned Twilio number';
    msgLog.status = 'FAILED';
    msgLog.error = error;
    await msgLog.save();
    console.error('Twilio Error:', error);
    return { success: false, error };
  }

  const client = twilio(creds.sid, creds.authToken);

  try {
    // Prefer the Messaging Service over a raw `from` number when configured
    // — Twilio's own fix for error 63027 (see the messagingServiceSid
    // comment on TwilioCredentials above). Twilio's convention is to send
    // one or the other, not both, when a Messaging Service is in play.
    const message = await client.messages.create({
      to: `whatsapp:${phone}`,
      contentSid,
      contentVariables: JSON.stringify(variables),
      ...(creds.messagingServiceSid
        ? { messagingServiceSid: creds.messagingServiceSid }
        : { from: `whatsapp:${creds.fromNumber}` }),
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
