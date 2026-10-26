/**
 * Provider-agnostic WhatsApp outbound sender.
 *
 * Drop-in replacement for the old `@/services/twilio/client` import — same
 * function name and signature, so call sites only change the import path.
 *
 * Routing rules:
 *  1. WHATSAPP_PROVIDER=twilio forces Twilio globally.
 *  2. WHATSAPP_PROVIDER=meta forces Meta — and when Meta is NOT configured
 *     (META_WHATSAPP_ACCESS_TOKEN + META_WHATSAPP_PHONE_NUMBER_ID) every send
 *     fails visibly with PROVIDER_CONFIG_MISSING. It never switches to
 *     Twilio behind the operator's back.
 *  3. Unset: Meta when configured (a business whose whatsappConfig.provider
 *     is 'twilio' still goes through Twilio), else Twilio — the selection is
 *     logged once so it is never invisible.
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
import { logWhatsAppDiagnostic, redactPhone, templateConfigMissing } from '@/lib/whatsappDiagnostics';
import {
  buildNotificationVariables,
  notificationBodyForTemplate,
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

let autoProviderLogged = false;

async function resolveProvider(businessId?: string): Promise<'meta' | 'twilio' | 'unconfigured'> {
  const explicit = (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase();
  if (explicit === 'twilio') return 'twilio';
  if (!getMetaConfig()) {
    if (explicit === 'meta') return 'unconfigured';
    if (!autoProviderLogged) {
      autoProviderLogged = true;
      console.warn('[whatsapp] WHATSAPP_PROVIDER is not set and Meta is not configured — sending through Twilio. Set WHATSAPP_PROVIDER to make this explicit.');
    }
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
/**
 * Inbound messages received by this process in the last 24h, by phone key.
 * The webhook notes each one before replying, so a reply to someone with no
 * stored conversation yet (a first "Hi", a report-intake answer) is known to
 * be inside the 24h window — it used to be treated as outside it and the
 * template fallback refused for want of a name, so nothing was sent.
 */
const recentInbound = new Map<string, number>();
const WINDOW_MS = 24 * 60 * 60 * 1000;

export function noteInboundMessage(phone: string, at: Date = new Date()): void {
  const key = phoneDedupeKey(phone);
  if (!key) return;
  const now = Date.now();
  for (const [k, t] of recentInbound) if (now - t > WINDOW_MS) recentInbound.delete(k);
  recentInbound.set(key, Math.max(recentInbound.get(key) ?? 0, at.getTime()));
}

async function recipientWindow(phone: string, leadId?: string): Promise<{ lastInboundAt: Date | null; name: string }> {
  const normalized = normalizePhoneE164(phone) || phone;
  const key = phoneDedupeKey(phone);
  const { default: Lead } = await import('@/models/Lead');
  const { default: SalesConversation } = await import('@/models/SalesConversation');
  const { default: BookingConversation } = await import('@/models/BookingConversation');
  const { default: Conversation } = await import('@/models/Conversation');
  const { default: SupportConversation } = await import('@/models/SupportConversation');

  const phoneQuery = key ? { phoneKey: key } : { leadPhone: normalized };
  const [leadById, leadByPhone, sales, bookings, support] = await Promise.all([
    leadId ? Lead.findById(leadId).select('name').lean() as Promise<{ name?: string } | null> : null,
    Lead.findOne({ phone: normalized }).select('name _id').sort({ updatedAt: -1 }).lean() as Promise<{ name?: string; _id?: unknown } | null>,
    SalesConversation.find(phoneQuery).select('lastLeadReplyAt leadName').lean() as Promise<Array<{ lastLeadReplyAt?: Date; leadName?: string }>>,
    BookingConversation.find(phoneQuery).select('leadName messages').lean() as Promise<Array<{ leadName?: string; messages?: Array<{ role?: string; at?: Date; via?: string }> }>>,
    // A support message just received over WhatsApp opens the window too (Segment 4A).
    SupportConversation.find({ ...phoneQuery, status: 'active' }).select('leadName messages').lean() as Promise<Array<{ leadName?: string; messages?: Array<{ role?: string; at?: Date; via?: string }> }>>,
  ]);

  const inboundStamps: Array<Date | string | null | undefined> = sales.map((row) => row.lastLeadReplyAt);
  const noted = key ? recentInbound.get(key) : undefined;
  if (noted) inboundStamps.push(new Date(noted));
  for (const row of [...bookings, ...support]) {
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
    || recipientFirstName(bookings.find((row) => row.leadName)?.leadName)
    || recipientFirstName(support.find((row) => row.leadName)?.leadName);

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
  names: { displayName?: string; personName?: string } = {}
): Promise<SendResult> {
  if (!WA_TEMPLATES.notification) {
    return templateConfigMissing({ feature: 'notification', template: 'new_growwmatics_notification', envKey: 'TWILIO_TEMPLATE_NOTIFICATION', recipient: phone });
  }
  // The template has its own "Hi {{1}}," — drop the body's greeting/sign-off.
  // {{1}}: an explicit display name (owner messages: the business name), else
  // the name the message's own greeting used, both as written; else the
  // recipient's first name from their lead/conversation.
  const forTemplate = notificationBodyForTemplate(body);
  const display = names.displayName || forTemplate.name;
  const built = display
    ? buildNotificationVariables(display, forTemplate.text, true)
    : buildNotificationVariables(names.personName || (await recipientWindow(phone, leadId)).name, forTemplate.text);
  if (!built.ok) {
    logWhatsAppDiagnostic({ event: 'whatsapp_send_failed', feature: 'notification', kind: 'CONTENT_VARIABLES_INVALID', template: 'new_growwmatics_notification', recipient: redactPhone(phone), detail: built.error });
    return { success: false, error: built.error, errorKind: 'CONTENT_VARIABLES_INVALID' };
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
  media?: OutboundMedia,
  /** {{1}} for the notification template when the window is closed (e.g. the business name for owner messages). */
  recipientName?: string
): Promise<SendResult> {
  await dbConnect();

  const provider = await resolveProvider(businessId);
  if (provider === 'unconfigured') return metaUnconfigured('message', phone);
  if (provider === 'twilio') {
    const window = await recipientWindow(phone, leadId);
    const channel = outboundChannel(window.lastInboundAt);

    // Outside the 24-hour window the free-form API is not called. Media has
    // no approved header template, so that case fails locally.
    if (channel === 'template') {
      if (media?.url) {
        return { success: false, error: 'Image sends have no template fallback outside the 24h window.' };
      }
      return sendNotificationTemplate(phone, body, leadId, businessId, { displayName: recipientName, personName: window.name });
    }

    const result = await sendViaTwilio(phone, body, leadId, businessId, media?.url);

    // Exceptional only: the local window said the customer was inside 24h
    // and Twilio still returned 63016. One sanitized template attempt, not
    // a second try if that attempt is invalid.
    // This is the documented WhatsApp channel switch, not a hidden substitute:
    // it is logged against the failed attempt, and its own failure is returned.
    if (!result.success && result.outsideWindow && result.isPlatformDefault && !media) {
      const retry = await sendNotificationTemplate(phone, body, leadId, businessId, { displayName: recipientName, personName: window.name });
      logWhatsAppDiagnostic({
        event: retry.success ? 'whatsapp_send_recovered' : 'whatsapp_send_failed',
        feature: 'free-text',
        kind: retry.success ? 'RECOVERED_AS_TEMPLATE' : (retry.errorKind || 'SEND_FAILED'),
        template: 'new_growwmatics_notification',
        errorCode: result.errorCode,
        correlationId: result.correlationId,
        recipient: redactPhone(phone),
        detail: retry.success ? `63016 outside window → notification template ${retry.correlationId}` : retry.error,
      });
      if (retry.success) return { ...retry, recoveredFrom: result.correlationId };
      return { ...result, error: `${result.error} (template fallback also failed: ${retry.error})`, errorKind: retry.errorKind || result.errorKind };
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
      logWhatsAppDiagnostic({ event: 'whatsapp_send_recovered', feature: 'free-text', kind: 'RECOVERED_AS_TEMPLATE', template: templateName, errorCode: result.errorCode != null ? String(result.errorCode) : undefined, correlationId: String(msgLog._id), recipient: redactPhone(phone), detail: 'Meta re-engagement → utility template' });
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
    msgLog.errorCode = result.errorCode;
    logWhatsAppDiagnostic({ event: 'whatsapp_send_failed', feature: 'meta', kind: 'SEND_FAILED', errorCode: result.errorCode != null ? String(result.errorCode) : undefined, correlationId: String(msgLog._id), recipient: redactPhone(phone), detail: result.error });
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
  if (provider === 'unconfigured') return metaUnconfigured('buttons', phone);
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
  if (provider === 'unconfigured') return metaUnconfigured('list', phone);
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
 * There is NO free-text fallback: without the approved auth template (or
 * without the bare code) this fails with TEMPLATE_CONFIG_MISSING, so the
 * login route answers with a visible error instead of sending the code as
 * ordinary text. `message` is kept in the signature for the callers.
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
  void message;
  const provider = await resolveProvider();
  if (provider === 'unconfigured') return metaUnconfigured('login-otp', phone);
  // Only Twilio has the approved authentication template.
  if (provider !== 'twilio' || !WA_TEMPLATES.loginOtp) {
    return templateConfigMissing({ feature: 'login-otp', template: 'growwmatics_login_otp', envKey: 'TWILIO_TEMPLATE_LOGIN_OTP (with WHATSAPP_PROVIDER=twilio)', recipient: phone });
  }
  if (!code) {
    logWhatsAppDiagnostic({ event: 'whatsapp_send_failed', feature: 'login-otp', kind: 'CONTENT_VARIABLES_INVALID', template: 'growwmatics_login_otp', recipient: redactPhone(phone), detail: 'no code given for {{1}}' });
    return { success: false, error: 'No code was given for the login template.', errorKind: 'CONTENT_VARIABLES_INVALID' };
  }
  const res = await sendTemplateMessage(phone, WA_TEMPLATES.loginOtp, { '1': code });
  if (!res.success) {
    logWhatsAppDiagnostic({ event: 'whatsapp_send_failed', feature: 'login-otp', kind: res.errorKind || 'SEND_FAILED', template: 'growwmatics_login_otp', errorCode: res.errorCode, correlationId: res.correlationId, recipient: redactPhone(phone) });
  }
  return res;
}

function metaUnconfigured(feature: string, phone: string): SendResult {
  const error = 'PROVIDER_CONFIG_MISSING: WHATSAPP_PROVIDER=meta but META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID are not set.';
  logWhatsAppDiagnostic({ event: 'whatsapp_send_failed', feature, kind: 'PROVIDER_CONFIG_MISSING', recipient: redactPhone(phone), detail: error });
  return { success: false, error, errorKind: 'PROVIDER_CONFIG_MISSING' };
}
