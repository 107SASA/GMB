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
 * Sends an OTP code (login, signup, resend) — always via the approved
 * growwmatics_notification Content Template rather than free text.
 *
 * Why: OTP requests are cold, business-initiated sends almost by definition
 * (a user asking to log in or sign up has usually never messaged the
 * platform's WhatsApp number, so there's no open 24h session). Twilio can
 * accept a free-text send at the API level and only reject it *later*,
 * asynchronously, once it reaches the carrier (error 63016) — by which point
 * the synchronous outsideWindow fallback in sendOutboundMessage() above has
 * already returned "success" to the caller, since no delivery-status webhook
 * is configured to report that later failure back. Sending the template
 * directly sidesteps the window check entirely instead of gambling on it.
 *
 * Falls back to a plain-text send only if the template SID isn't configured,
 * so OTPs still go out (best-effort) in an environment where it's unset.
 */
export async function sendOtpMessage(phone: string, message: string): Promise<SendResult> {
  if (WA_TEMPLATES.notification) {
    const result = await sendTemplateMessage(phone, WA_TEMPLATES.notification, { '1': 'there', '2': message });
    if (result.success) return result;
    console.warn('[whatsapp] OTP template send failed, falling back to free text:', result.error);
  }
  return sendOutboundMessage(phone, message);
}
