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
import { sendOutboundMessage as sendViaTwilio, SendResult } from '@/services/twilio/client';
import { getMetaConfig, isReengagementError, sendMetaTemplate, sendMetaText } from './meta';

export type { SendResult };

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
  businessId?: string
): Promise<SendResult> {
  await dbConnect();

  const provider = await resolveProvider(businessId);
  if (provider === 'twilio') {
    return sendViaTwilio(phone, body, leadId, businessId);
  }

  const msgLog = await MessageQueue.create({
    leadId,
    direction: 'OUTBOUND',
    status: 'PENDING',
    payload: { phone, body, provider: 'meta' },
  });

  let result = await sendMetaText(phone, body);

  if (!result.success && isReengagementError(result.errorCode, result.error)) {
    const templateName = process.env.META_UTILITY_TEMPLATE_NAME;
    if (templateName) {
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
