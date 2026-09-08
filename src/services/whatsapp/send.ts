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
import { sendOutboundMessage as sendViaTwilio, sendTemplateMessage, SendResult } from '@/services/twilio/client';
import { getMetaConfig, isReengagementError, sendMetaTemplate, sendMetaText, sendMetaImage } from './meta';
import { WA_TEMPLATES } from '@/lib/whatsappTemplates';

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
    const result = await sendViaTwilio(phone, body, leadId, businessId, media?.url);

    // Twilio 63016 = business-initiated send rejected because we're outside
    // the 24h customer-session window. growwmatics_notification is the
    // generic approved-template fallback for exactly this case — same idea
    // as the Meta branch's META_UTILITY_TEMPLATE_NAME retry below, but only
    // usable when the send went out on GrowwMatics' own number (a business's
    // own Twilio number can't use a GrowwMatics-scoped Content Template) and
    // never for media (no header-media template configured).
    if (!result.success && result.outsideWindow && result.isPlatformDefault && !media && WA_TEMPLATES.notification) {
      const retry = await sendTemplateMessage(phone, WA_TEMPLATES.notification, { '1': 'there', '2': body }, businessId);
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
