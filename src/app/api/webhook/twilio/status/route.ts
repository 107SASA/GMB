import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import MessageQueue from '@/models/MessageQueue';
import Conversation from '@/models/Conversation';
import { validateTwilioSignature } from '@/lib/twilioSignature';
import { classifyTwilioError, logWhatsAppDiagnostic } from '@/lib/whatsappDiagnostics';
import { interpretTwilioStatus } from '@/lib/reviewRequestFlow';
import { applyReviewDeliveryStatus, retryReviewViaTwilio } from '@/services/reviews/reviewDeliveryStatus';

export const dynamic = 'force-dynamic';

/**
 * Twilio status-callback receiver — set as `statusCallback` on every
 * outbound WhatsApp send in src/services/twilio/client.ts.
 *
 * Why this exists: `client.messages.create()` succeeding only means Twilio's
 * API *accepted* the send synchronously. It does NOT mean WhatsApp delivered
 * it — a cold-recipient template can still be throttled, bounced, or land on
 * a number that isn't on WhatsApp, and that only becomes known some time
 * later via this callback (MessageStatus: queued -> sent -> delivered/read,
 * or -> undelivered/failed). Before this route existed, nothing in the app
 * ever received that signal, so "status: Sent" was permanently indistinguishable
 * from "actually reached the customer" — this is what customers were hitting
 * when a review request (or an OTP) showed as sent but never arrived.
 *
 * Every outbound Twilio WhatsApp send is logged as a MessageQueue doc with
 * payload.sid = the Twilio SID (see client.ts), so that's the join key back
 * to whichever higher-level record (ReviewRequest, Conversation) needs to
 * reflect the real outcome.
 *
 * Read is stored separately from delivered. Error code and error message are
 * both stored. 63049 is a terminal failure for that attempt. 63016 on a
 * free-text send can still fall back to a template once.
 */

/**
 * Same idea as retryReviewViaTwilio (services/reviews/reviewDeliveryStatus.ts), for everything that ISN'T a review
 * request — OTP logins, AI-agent conversation replies, anything sent via
 * sendOutboundMessage as free text. Retries via the generic
 * `growwmatics_notification` template, reusing the original message body as
 * its {{2}} parameter, so the customer gets *something* instead of the send
 * silently vanishing (this is precisely what broke phone-login OTP: Twilio
 * accepted the code synchronously, rejected it async 2s later, and nothing
 * downstream knew to retry — the caller had already told the browser
 * "code sent"). Never retries a message that was already a template.
 */
async function retryGenericAsNotificationTemplate(failedSid: string): Promise<boolean> {
  try {
    const { shouldRetryFreeformAsTemplate } = await import('@/lib/whatsappOutbound');
    const log = await MessageQueue.findOne({ 'payload.sid': failedSid })
      .select('payload')
      .lean<{ payload?: { phone?: string; body?: string; contentSid?: string; templateRetried?: boolean } }>();
    if (!log?.payload?.phone || !log.payload.body) return false;
    if (!shouldRetryFreeformAsTemplate({
      errorCode: '63016',
      alreadyTemplate: !!log.payload.contentSid,
      alreadyRetried: !!log.payload.templateRetried,
    })) return false;

    // Claim before sending so a second callback cannot deliver another copy.
    const claimed = await MessageQueue.updateOne(
      { 'payload.sid': failedSid, 'payload.templateRetried': { $ne: true }, 'payload.contentSid': { $exists: false } },
      { $set: { 'payload.templateRetried': true } }
    );
    if (claimed.modifiedCount !== 1) return false;

    const { retryFreeformAsNotification } = await import('@/services/whatsapp/send');
    const retry = await retryFreeformAsNotification(log.payload.phone, log.payload.body);
    logWhatsAppDiagnostic({
      event: retry.success ? 'whatsapp_send_recovered' : 'whatsapp_send_failed',
      feature: 'free-text',
      kind: retry.success ? 'RECOVERED_AS_TEMPLATE' : (retry.errorKind || 'SEND_FAILED'),
      template: 'new_growwmatics_notification',
      errorCode: '63016',
      correlationId: retry.correlationId,
      detail: `async 63016 on ${failedSid}${retry.success ? '' : `: ${retry.error}`}`,
    });
    return retry.success;
  } catch (e) {
    console.error('[twilio-status-webhook] generic template retry failed:', e);
    return false;
  }
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const verification = await validateTwilioSignature(req, formData, process.env.TWILIO_AUTH_TOKEN);
    if (!verification.ok) return verification.response;

    const messageSid = formData.get('MessageSid') as string;
    const messageStatus = (formData.get('MessageStatus') as string || '').toLowerCase();
    const errorCode = formData.get('ErrorCode') as string | null;
    const errorMessageRaw = formData.get('ErrorMessage') as string | null;

    if (!messageSid || !messageStatus) return NextResponse.json({ ok: true });

    await dbConnect();

    const interpreted = interpretTwilioStatus(messageStatus, errorCode, errorMessageRaw);
    const now = new Date();

    // Billing recovery reminders: real delivery status (sent ≠ delivered).
    if (interpreted.kind !== 'ignore') {
      const { recordReminderDelivery } = await import('@/services/billing/recoveryRemindersService');
      await recordReminderDelivery(messageSid, interpreted.kind);
    }

    if (interpreted.kind === 'failed') {
      await MessageQueue.updateMany(
        { 'payload.sid': messageSid },
        { status: 'FAILED', failedReason: interpreted.failedReason, errorCode: interpreted.errorCode, errorKind: classifyTwilioError(interpreted.errorCode) }
      );
      logWhatsAppDiagnostic({ event: 'whatsapp_send_failed', feature: 'delivery-callback', kind: classifyTwilioError(interpreted.errorCode), errorCode: interpreted.errorCode || undefined, detail: `${messageSid}: ${interpreted.failedReason || ''}` });
    } else if (interpreted.kind === 'delivered') {
      // Evidence of delivery (status stays SENT — "accepted" — for existing counts).
      await MessageQueue.updateMany({ 'payload.sid': messageSid, deliveredAt: { $exists: false } }, { $set: { deliveredAt: now } });
    } else if (interpreted.kind === 'read') {
      await MessageQueue.updateMany({ 'payload.sid': messageSid, readAt: { $exists: false } }, { $set: { readAt: now } });
      await MessageQueue.updateMany({ 'payload.sid': messageSid, deliveredAt: { $exists: false } }, { $set: { deliveredAt: now } });
    }

    if (interpreted.kind === 'delivered' || interpreted.kind === 'read' || interpreted.kind === 'failed') {
      await Conversation.updateMany(
        { twilioSid: messageSid },
        { messageStatus: interpreted.kind === 'failed' ? 'failed' : messageStatus }
      );
    }

    // Review requests (shared with Meta's status webhook).
    const reviewMatches = await applyReviewDeliveryStatus(
      messageSid,
      interpreted,
      (r) => retryReviewViaTwilio(r, messageSid, interpreted.kind === 'failed' ? interpreted.errorCode : undefined),
      now
    );

    if (!reviewMatches && interpreted.kind === 'failed' && interpreted.errorCode === '63016') {
      await retryGenericAsNotificationTemplate(messageSid);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[twilio-status-webhook] error:', error);
    return NextResponse.json({ ok: true });
  }
}
