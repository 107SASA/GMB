/**
 * Review requests over Meta's WhatsApp Cloud API (step 1 of the Twilio → Meta
 * move, Nov 2026). Only review requests go through Meta; every other
 * WhatsApp send stays on Twilio (WHATSAPP_PROVIDER), and Twilio stays the
 * fallback for review requests too:
 *  - Meta refuses the send → the caller sends the same request through Twilio.
 *  - Meta accepts, then reports the message as failed (status webhook) →
 *    services/reviews/reviewDeliveryStatus.ts retries it once through Twilio.
 *
 * Switched on only when all of these are set — anything missing keeps
 * review requests on Twilio, with one warning in the log:
 *   REVIEW_WHATSAPP_PROVIDER=meta
 *   META_WHATSAPP_ACCESS_TOKEN, META_WHATSAPP_PHONE_NUMBER_ID
 *   META_TEMPLATE_REVIEW_REQUEST   the approved Meta template's name
 *   META_TEMPLATE_LANGUAGE         optional, defaults to "en"
 *
 * The Meta template takes the same three body variables as the Twilio
 * utility template: {{1}} customer name, {{2}} business name, {{3}} the
 * ReviewRequest token (https://growwmatics.com/review/{{3}}?src=wa).
 */
import dbConnect from '@/lib/mongodb';
import MessageQueue from '@/models/MessageQueue';
import { buildUtilityReviewVariables } from '@/lib/reviewRequestFlow';
import { logWhatsAppDiagnostic, redactPhone } from '@/lib/whatsappDiagnostics';
import { getMetaConfig, sendMetaTemplate } from './meta';

/** Prefix of the template reference stored for a Meta send (Twilio refs are "HX…" SIDs). */
export const META_TEMPLATE_REF_PREFIX = 'meta:';

export function metaReviewTemplateName(): string {
  return (process.env.META_TEMPLATE_REVIEW_REQUEST || '').trim();
}

let fallbackWarned = false;

/** 'meta' only when switched on and fully configured; otherwise 'twilio'. */
export function reviewWhatsAppProvider(): 'meta' | 'twilio' {
  const wanted = (process.env.REVIEW_WHATSAPP_PROVIDER || '').trim().toLowerCase();
  if (wanted !== 'meta') return 'twilio';
  const missing = [
    !getMetaConfig() && 'META_WHATSAPP_ACCESS_TOKEN / META_WHATSAPP_PHONE_NUMBER_ID',
    !metaReviewTemplateName() && 'META_TEMPLATE_REVIEW_REQUEST',
  ].filter(Boolean);
  if (missing.length) {
    if (!fallbackWarned) {
      fallbackWarned = true;
      console.warn(`[review-whatsapp] REVIEW_WHATSAPP_PROVIDER=meta but ${missing.join(' and ')} not set — review requests stay on Twilio.`);
    }
    return 'twilio';
  }
  return 'meta';
}

/** What ReviewRequest.templateSid / messageHistory record for a Meta send. Empty when Meta is off. */
export function metaReviewTemplateRef(): string {
  return reviewWhatsAppProvider() === 'meta' ? `${META_TEMPLATE_REF_PREFIX}${metaReviewTemplateName()}` : '';
}

/**
 * Every template reference that carries the approved review-request text —
 * the Twilio utility SID and the Meta template. Both say the same thing, so
 * the "same message at most twice" cap counts them together.
 */
export function reviewUtilityTemplateRefs(twilioUtilitySid: string): string[] {
  return [twilioUtilitySid?.trim() || '', metaReviewTemplateRef()].filter(Boolean);
}

export interface MetaReviewSendResult {
  success: boolean;
  /** WhatsApp message id (wamid…). */
  sid?: string;
  error?: string;
  errorCode?: string;
  /** MessageQueue row for this attempt. */
  correlationId?: string;
  templateSid: string;
}

/** One review request as the approved Meta template. Logged in MessageQueue like every other send. */
export async function sendReviewRequestViaMeta(
  phone: string,
  vars: { name: string; business: string; token: string }
): Promise<MetaReviewSendResult> {
  const templateName = metaReviewTemplateName();
  const templateSid = `${META_TEMPLATE_REF_PREFIX}${templateName}`;
  const variables = buildUtilityReviewVariables(vars.name, vars.business, vars.token);
  const language = (process.env.META_TEMPLATE_LANGUAGE || 'en').trim() || 'en';

  await dbConnect();
  const msgLog = await MessageQueue.create({
    direction: 'OUTBOUND',
    status: 'PENDING',
    payload: { phone, provider: 'meta', contentSid: templateSid, variables },
  });
  const correlationId = String(msgLog._id);

  const result = await sendMetaTemplate(phone, templateName, language, [variables['1'], variables['2'], variables['3']]);
  const errorCode = result.errorCode != null ? String(result.errorCode) : undefined;

  if (result.success) {
    msgLog.status = 'SENT';
    msgLog.sentAt = new Date();
    msgLog.payload = { ...msgLog.payload, sid: result.sid };
  } else {
    msgLog.status = 'FAILED';
    msgLog.failedReason = result.error;
    msgLog.errorCode = errorCode;
    logWhatsAppDiagnostic({ event: 'whatsapp_send_failed', feature: 'review-request-meta', kind: 'SEND_FAILED', template: templateName, errorCode, correlationId, recipient: redactPhone(phone), detail: result.error });
  }
  msgLog.markModified('payload');
  await msgLog.save();

  return { success: result.success, sid: result.sid, error: result.error, errorCode, correlationId, templateSid };
}
