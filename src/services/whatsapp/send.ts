/**
 * Provider-agnostic WhatsApp outbound sender.
 *
 * Drop-in replacement for the old `@/services/twilio/client` import — same
 * function name and signature, so call sites only change the import path.
 *
 * Routing rules:
 *  1. WHATSAPP_PROVIDER=twilio forces Twilio globally.
 *  2. Otherwise Meta is used when configured (META_WHATSAPP_ACCESS_TOKEN +
 *     META_WHATSAPP_PHONE_NUMBER_ID); a business whose
 *     whatsappConfig.provider is 'twilio' still goes through Twilio.
 *  3. If Meta env vars are absent, falls back to Twilio so an existing
 *     Twilio/sandbox deployment keeps working before the Meta keys are set.
 *
 * Meta 24h-window handling: business-initiated messages (campaigns,
 * reminders, follow-ups) are rejected by Meta with a re-engagement error
 * when the customer hasn't written in the last 24 hours. When
 * META_UTILITY_TEMPLATE_NAME is set, the message is retried as that
 * approved template with the text as its single {{1}} body parameter.
 */
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import MessageQueue from '@/models/MessageQueue';
import { sendOutboundMessage as sendViaTwilio, sendListPicker, sendQuickReply, sendTemplateMessage, SendResult } from '@/services/twilio/client';
import { getMetaConfig, isReengagementError, sendMetaTemplate, sendMetaText, sendMetaImage } from './meta';
import { WA_TEMPLATES } from '@/lib/whatsappTemplates';
import { normalizePhoneE164, phoneDedupeKey } from '@/lib/phone';
import {
  buildNotificationVariables,
  outboundChannel,
  realInboundAtFromMessages,
  recipientFirstName,
} from '@/lib/whatsappOutbound';

export type { SendResult };

export interface OutboundMedia {
  url: string;
  type?: 'image' | 'document';
  caption?: string;
}

async function resolveProvider(businessId?: string): Promise<'meta' | 'twilio'> {
  const envProvider = (process.env.WHATSAPP_PROVIDER || 'meta').toLowerCase();
  if (envProvider === 'twilio') return 'twilio';
  if (!getMetaConfig()) {
    console.warn('[whatsapp] Meta provider selected but not configured — falling back to Twilio');
    return 'twilio';
  }
  if (businessId) {
    try {
      const business = await Business.findById(businessId).select('whatsappConfig.provider').lean() as any;
      if (business?.whatsappConfig?.provider === 'twilio') return 'twilio';
    } catch {
      // lookup is best-effort; default routing applies
    }
  }
  return 'meta';
}

/**
 * Last genuine inbound WhatsApp time for this phone, plus a first name
 * taken from the lead or a conversation the webhook actually wrote.
 * A website-form `via: 'form'` line is ignored.
 */
async function recipientWindow(phone: string, leadId?: string): Promise<{ lastInboundAt: Date | null; name: string }> {
  const normalized = normalizePhoneE164(phone) || phone;
  const key = phoneDedupeKey(phone);
  const { default: Lead } = await import('@/models/Lead');
  const { default: SalesConversation } = await import('@/models/SalesConversation');
  const { default: BookingConversation } = await import('@/models/BookingConversation');
  const { default: Conversation } = await import('@/models/Conversation');

  const phoneQuery = key ? { phoneKey: key } : { leadPhone: normalized };
  const [leadById, leadByPhone, sales, bookings] = await Promise.all([
    leadId ? Lead.findById(leadId).select('name').lean() as Promise<{ name?: string } | null> : null,
    Lead.findOne({ phone: normalized }).select('name _id').sort({ updatedAt: -1 }).lean() as Promise<{ name?: string; _id?: unknown } | null>,
    SalesConversation.find(phoneQuery).select('lastLeadReplyAt leadName').lean() as Promise<Array<{ lastLeadReplyAt?: Date; leadName?: string }>>,
    BookingConversation.find(phoneQuery).select('leadName messages').lean() as Promise<Array<{ leadName?: string; messages?: Array<{ role?: string; at?: Date; via?: string }> }>>,
  ]);

  const inboundStamps: Array<Date | string | null | undefined> = sales.map((row) => row.lastLeadReplyAt);
  for (const row of bookings) {
    inboundStamps.push(realInboundAtFromMessages(row.messages));
  }
  const leadIds = [leadId, leadByPhone?._id].filter(Boolean);
  if (leadIds.length) {
    const inbound = await Conversation.findOne({ leadId: { $in: leadIds }, direction: 'inbound' })
      .sort({ timestamp: -1 })
      .select('timestamp')
      .lean() as { timestamp?: Date } | null;
    if (inbound?.timestamp) inboundStamps.push(inbound.timestamp);
  }

  const name = recipientFirstName(leadById?.name)
    || recipientFirstName(leadByPhone?.name)
    || recipientFirstName(sales.find((row) => row.leadName)?.leadName)
    || recipientFirstName(bookings.find((row) => row.leadName)?.leadName);

  return {
    lastInboundAt: realInboundAtFromMessages(
      inboundStamps.filter(Boolean).map((at) => ({ role: 'lead', via: 'whatsapp', at })),
      null
    ),
    name,
  };
}

async function sendNotificationTemplate(
  phone: string,
  body: string,
  leadId?: string,
  businessId?: string,
  name?: string
): Promise<SendResult> {
  if (!WA_TEMPLATES.notification) {
    return { success: false, error: 'Notification template is not configured (TWILIO_TEMPLATE_NOTIFICATION).' };
  }
  const resolved = name || (await recipientWindow(phone, leadId)).name;
  const built = buildNotificationVariables(resolved, body);
  if (!built.ok) {
    console.error('[whatsapp] notification template refused:', built.error);
    return { success: false, error: built.error };
  }
  return sendTemplateMessage(phone, WA_TEMPLATES.notification, built.variables, businessId);
}

/** Status-callback recovery. Sanitizes {{2}} and does not call Twilio when the variables are invalid. */
export async function retryFreeformAsNotification(phone: string, body: string): Promise<SendResult> {
  return sendNotificationTemplate(phone, body);
}

export async function sendOutboundMessage(
  phone: string,
  body: string,
  leadId?: string,
  businessId?: string,
  media?: OutboundMedia
): Promise<SendResult> {
  await dbConnect();

  const provider = await resolveProvider(businessId);
  if (provider === 'twilio') {
    const window = await recipientWindow(phone, leadId);
    const channel = outboundChannel(window.lastInboundAt);

    // Outside the 24-hour window the free-form API is not called. Media has
    // no approved header template, so that case fails locally.
    if (channel === 'template') {
      if (media?.url) {
        return { success: false, error: 'Image sends have no template fallback outside the 24h window.' };
      }
      return sendNotificationTemplate(phone, body, leadId, businessId, window.name);
    }

    const result = await sendViaTwilio(phone, body, leadId, businessId, media?.url);

    // Exceptional only: the local window said the customer was inside 24h
    // and Twilio still returned 63016. One sanitized template attempt, not
    // a second try if that attempt is invalid.
    if (!result.success && result.outsideWindow && result.isPlatformDefault && !media) {
      const retry = await sendNotificationTemplate(phone, body, leadId, businessId, window.name);
      if (retry.success) return retry;
      return { ...result, error: `${result.error} (template fallback also failed: ${retry.error})` };
    }

    return result;
  }

  const msgLog = await MessageQueue.create({
    leadId,
    direction: 'OUTBOUND',
    status: 'PENDING',
    payload: { phone, body, provider: 'meta', ...(media ? { mediaUrl: media.url } : {}) },
  });

  let result = media
    ? await sendMetaImage(phone, media.url, media.caption ?? body)
    : await sendMetaText(phone, body);

  // Template fallback is text-only (no header-media template configured),
  // so a media send outside the 24h window just fails with a clear reason.
  if (!result.success && isReengagementError(result.errorCode, result.error)) {
    const templateName = process.env.META_UTILITY_TEMPLATE_NAME;
    if (media) {
      result.error = `${result.error} (image sends have no template fallback outside the 24h window)`;
    } else if (templateName) {
      const language = process.env.META_TEMPLATE_LANGUAGE || 'en';
      result = await sendMetaTemplate(phone, templateName, language, [body]);
      msgLog.payload = { ...msgLog.payload, sentAsTemplate: templateName };
      msgLog.markModified('payload');
    } else {
      result.error = `${result.error} (set META_UTILITY_TEMPLATE_NAME to auto-retry business-initiated messages as an approved template)`;
    }
  }

  if (result.success) {
    msgLog.status = 'SENT';
    msgLog.sentAt = new Date();
    msgLog.payload = { ...msgLog.payload, sid: result.sid };
    msgLog.markModified('payload');
  } else {
    msgLog.status = 'FAILED';
    msgLog.failedReason = result.error;
    console.error('[whatsapp][meta] send failed:', result.error);
  }
  await msgLog.save();

  return { success: result.success, sid: result.sid, error: result.error };
}

/** Up to 3 tap buttons in an open WhatsApp session. Callers fall back to plain text when this fails. */
export async function sendButtonChoice(
  phone: string,
  body: string,
  actions: { id: string; title: string }[],
  leadId?: string,
  businessId?: string,
): Promise<SendResult> {
  const provider = await resolveProvider(businessId);
  if (provider !== 'twilio') return { success: false, error: 'Buttons are sent through Twilio.' };
  return sendQuickReply(phone, body, actions, leadId);
}

/** A tap-to-pick list (up to 10 rows) in an open WhatsApp session. Callers fall back to plain text when this fails. */
export async function sendListChoice(
  phone: string,
  body: string,
  button: string,
  items: { id: string; item: string; description?: string }[],
  leadId?: string,
  businessId?: string,
): Promise<SendResult> {
  const provider = await resolveProvider(businessId);
  if (provider !== 'twilio') return { success: false, error: 'Lists are sent through Twilio.' };
  return sendListPicker(phone, body, button, items, leadId);
}

/**
 * Sends an OTP code (login, signup, resend).
 *
 * PRIMARY PATH (2026-09): a dedicated WhatsApp AUTHENTICATION-category
 * template — WA_TEMPLATES.loginOtp / TWILIO_TEMPLATE_LOGIN_OTP. Auth
 * templates are the compliant way to deliver an OTP and, crucially, are NOT
 * subject to the 24h customer-session window, so a cold login/signup (the
 * common case — the user isn't mid-conversation with our WhatsApp number)
 * delivers reliably. Sent DIRECTLY as a template — no free-text attempt
 * first (every login is a cold send by definition, so leading with free
 * text just guarantees a 63016 rejection and wastes a Twilio call).
 *
 * `code` is the bare numeric OTP for the template's single {{1}} variable.
 * When the auth template is configured this is a SINGLE Twilio call — it does
 * NOT then chase a failure with the free-text + generic-notification-template
 * fallback the way general messages do. That cascade is 2 extra sequential
 * Twilio round-trips (pushing the login request past ~6-9s and risking a
 * gateway/proxy timeout that surfaces to the browser as "Network error") and
 * neither leg helps a cold login: free text needs an open 24h session, and
 * the generic `notification` template send is itself broken (21656). So on a
 * template failure this returns that failure straight away and the route
 * answers fast with a real 502 the user can see and retry.
 *
 * `message` (the full human-readable line) is only used when the auth
 * template SID isn't configured at all (local/dev before approval) — then it
 * falls back to a best-effort free-text send, which still lands for a
 * recipient inside a 24h window.
 *
 * HISTORY: this previously went out only as free text (reliable ONLY inside a
 * 24h window) after an earlier attempt via the GENERIC growwmatics_notification
 * template was reverted — that template failed ~100% here (Twilio 63027, then
 * 21656 "ContentVariables invalid"). A purpose-built auth template sidesteps both.
 */
export async function sendOtpMessage(
  phone: string,
  message: string,
  code?: string
): Promise<SendResult> {
  const provider = await resolveProvider();

  // Twilio auth-template path — the reliable one, and the only send attempted
  // when it's available. Content Template SIDs are WABA-scoped so this is
  // platform-Twilio-number only; needs the bare code for {{1}}.
  if (provider === 'twilio' && code && WA_TEMPLATES.loginOtp) {
    const res = await sendTemplateMessage(phone, WA_TEMPLATES.loginOtp, { '1': code });
    if (!res.success) {
      console.error('[whatsapp] login-OTP auth template send failed:', res.error);
    }
    return res;
  }

  // No auth template configured — best-effort free text (works inside a 24h window).
  return sendOutboundMessage(phone, message);
}
