import twilio from 'twilio';
import dbConnect from '@/lib/mongodb';
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
   * Always true whenever present — kept as a field (not removed outright)
   * because downstream template-retry gates (services/whatsapp/send.ts,
   * services/inngest/functions.ts) genuinely depend on "did this send go
   * out from GrowwMatics' own number" as a real precondition for retrying
   * as an approved Content Template, which is only valid on GrowwMatics'
   * own WABA. There is currently only one number this can ever be sent
   * from, so any send that got far enough to actually attempt one sets
   * this true — see resolveTwilioCredentials's own comment for the
   * cleanup history (a per-tenant Twilio credential path was removed here;
   * Business.integrations never actually had twilioSid/twilioAuthToken
   * fields to read). Omitted (not false) on early-exit failures (missing
   * platform credentials entirely) where no account was ever resolved.
   */
  isPlatformDefault?: true;
}

interface TwilioCredentials {
  sid: string;
  authToken: string;
  fromNumber: string;
  isPlatformDefault: true;
  /**
   * A Messaging Service groups senders on GrowwMatics' own Twilio account.
   * When present, Content Template sends use this instead of a raw `from`
   * number — Twilio's own recommended fix for error 63027 ("template does
   * not exist for a language and locale"), which a raw direct-number send
   * hit consistently (see scripts/debug-content-send.mjs).
   */
  messagingServiceSid?: string;
}

/**
 * Resolves the platform's Twilio account/number for a send. Previously
 * took a `businessId` and checked business.integrations.twilioSid/
 * twilioAuthToken for a per-tenant override — removed (cleanup item, see
 * PRODUCTION_READINESS notes) because that schema field never actually
 * existed on Business.integrations, so the branch was permanently dead:
 * every tenant has always sent from GrowwMatics' own number regardless of
 * what this function's old code implied was possible. If tenant-owned
 * WhatsApp numbers become a real near-term feature, this needs a proper
 * schema field, a settings UI, and a credential-storage decision — not a
 * silent re-add of the old dead branch.
 */
async function resolveTwilioCredentials(): Promise<TwilioCredentials | null> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!sid || !authToken || !fromNumber) return null;
  return {
    sid,
    authToken,
    fromNumber,
    isPlatformDefault: true,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  };
}

export async function sendOutboundMessage(
  phone: string,
  body: string,
  leadId?: string,
  businessId?: string, // no longer consulted for credentials — see resolveTwilioCredentials's doc comment. Kept in the signature so existing call sites across the codebase don't need to change their argument list.
  mediaUrl?: string
): Promise<SendResult> {
  await dbConnect();

  const creds = await resolveTwilioCredentials();

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
  const statusCallback = statusCallbackUrl();

  try {
    const message = await client.messages.create({
      body,
      from: `whatsapp:${creds.fromNumber}`,
      to: `whatsapp:${phone}`,
      ...(mediaUrl ? { mediaUrl: [mediaUrl] } : {}),
      ...(statusCallback ? { statusCallback } : {}),
    });
    msgLog.status = 'SENT';
    msgLog.sentAt = new Date();
    msgLog.payload = { ...msgLog.payload, sid: message.sid };
    msgLog.markModified('payload');
    await msgLog.save();
    return { success: true, sid: message.sid, isPlatformDefault: creds.isPlatformDefault };
  } catch (e: any) {
    msgLog.status = 'FAILED';
    msgLog.failedReason = e.message;
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
 * Twilio needs a publicly reachable URL to POST delivery receipts
 * (queued/sent/delivered/undelivered/failed) to — without this, a message
 * that Twilio *accepted* synchronously but WhatsApp later failed to deliver
 * (throttling, unreachable number, cold-recipient template rejected, etc.)
 * is indistinguishable from one that actually arrived. Handled by
 * src/app/api/webhook/twilio/status/route.ts. Requires NEXT_PUBLIC_BASE_URL
 * to be the real HTTPS domain (already required elsewhere — see
 * .env.production.example); returns undefined (omit statusCallback rather
 * than point Twilio at localhost) if it isn't set.
 */
function statusCallbackUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_BASE_URL;
  if (!base || base.includes('localhost')) return undefined;
  return `${base.replace(/\/$/, '')}/api/webhook/twilio/status`;
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
  businessId?: string // no longer consulted for credentials — see resolveTwilioCredentials's doc comment. Kept in the signature so existing call sites across the codebase don't need to change their argument list.
): Promise<SendResult> {
  await dbConnect();

  const creds = await resolveTwilioCredentials();

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
  // only ever valid to send from GrowwMatics' own number, which is the only
  // number resolveTwilioCredentials() can return today (see its doc
  // comment) — no runtime check needed here anymore since there is no
  // other kind of credential this could resolve to.

  const client = twilio(creds.sid, creds.authToken);
  const statusCallback = statusCallbackUrl();

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
      ...(statusCallback ? { statusCallback } : {}),
    });
    msgLog.status = 'SENT';
    msgLog.sentAt = new Date();
    msgLog.payload = { ...msgLog.payload, sid: message.sid };
    msgLog.markModified('payload');
    await msgLog.save();
    return { success: true, sid: message.sid, isPlatformDefault: creds.isPlatformDefault };
  } catch (e: any) {
    msgLog.status = 'FAILED';
    msgLog.failedReason = e.message;
    await msgLog.save();
    console.error('Twilio Error:', e);
    return { success: false, error: e.message };
  }
}
