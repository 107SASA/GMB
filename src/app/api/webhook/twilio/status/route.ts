import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import MessageQueue from '@/models/MessageQueue';
import Conversation from '@/models/Conversation';
import ReviewRequest from '@/models/ReviewRequest';
import Campaign from '@/models/Campaign';
import Business from '@/models/Business';
import Customer from '@/models/Customer';
import { validateTwilioSignature } from '@/lib/twilioSignature';

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
 */
/**
 * Retries a review request as the approved `growwmatics_review_request`
 * Content Template after learning — only via this async callback — that the
 * free-text send it replaces actually failed outside the 24h window. Mirrors
 * the sync-path fallback in sendReviewRequest() (functions.ts): same
 * requirements (Place ID on file, template configured), same template, same
 * variables. Returns false (leaving the caller to record a real failure) for
 * anything that isn't safely retryable — never retries a message that was
 * already a template (would loop), and never retries without a Place ID.
 */
async function retryAsApprovedTemplate(
  r: { _id: any; businessId: any; customerId: any },
  failedSid: string
): Promise<boolean> {
  try {
    const originalLog = await MessageQueue.findOne({ 'payload.sid': failedSid })
      .select('payload.contentSid')
      .lean<{ payload?: { contentSid?: string } }>();
    if (originalLog?.payload?.contentSid) return false; // already a template — don't loop

    const [business, customer] = await Promise.all([
      Business.findById(r.businessId).select('name placeId').lean<{ name?: string; placeId?: string }>(),
      Customer.findById(r.customerId).select('name phone').lean<{ name?: string; phone?: string }>(),
    ]);
    if (!business?.placeId || !customer?.phone) return false;

    const { WA_TEMPLATES } = await import('@/lib/whatsappTemplates');
    if (!WA_TEMPLATES.reviewRequest) return false;

    const { sendTemplateMessage } = await import('@/services/twilio/client');
    const retry = await sendTemplateMessage(customer.phone, WA_TEMPLATES.reviewRequest, {
      '1': customer.name || 'there',
      '2': business.name || 'our business',
      '3': business.placeId,
    }, r.businessId.toString());

    if (!retry.success) return false;

    // Back to Sent, tracking the retry's SID — this same webhook will get a
    // fresh receipt for it (delivered, or a real failure this time).
    await ReviewRequest.updateOne({ _id: r._id }, { status: 'Sent', lastMessageSid: retry.sid, $unset: { failedReason: '' } });
    return true;
  } catch (e) {
    console.error('[twilio-status-webhook] async template retry failed:', e);
    return false;
  }
}

/**
 * Same idea as retryAsApprovedTemplate, for everything that ISN'T a review
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
    const log = await MessageQueue.findOne({ 'payload.sid': failedSid })
      .select('payload')
      .lean<{ payload?: { phone?: string; body?: string; contentSid?: string } }>();
    if (!log?.payload || log.payload.contentSid) return false; // already a template — don't loop
    const { phone, body } = log.payload;
    if (!phone || !body) return false;

    const { WA_TEMPLATES } = await import('@/lib/whatsappTemplates');
    if (!WA_TEMPLATES.notification) return false;

    const { sendTemplateMessage } = await import('@/services/twilio/client');
    const retry = await sendTemplateMessage(phone, WA_TEMPLATES.notification, { '1': 'there', '2': body });
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

    const isFailure = messageStatus === 'failed' || messageStatus === 'undelivered';
    const isDelivered = messageStatus === 'delivered' || messageStatus === 'read';
    const reason = errorMessageRaw || (errorCode ? `Twilio error ${errorCode}` : 'Delivery failed');

    // Generic outbound log — every Twilio send goes through here regardless
    // of which feature triggered it (review campaign, OTP, AI conversation reply...).
    if (isFailure) {
      await MessageQueue.updateMany({ 'payload.sid': messageSid }, { status: 'FAILED', failedReason: reason });
    }

    // Inbox/AI-conversation thread status (mirrors applyMetaStatus in
    // src/app/api/whatsapp/webhook/route.ts, same field, same convention).
    if (isDelivered || isFailure) {
      await Conversation.updateMany({ twilioSid: messageSid }, { messageStatus: isFailure ? 'failed' : messageStatus });
    }

    // Review-campaign truth: this is what the owner and the customer actually
    // care about. Only move a request that's still in-flight (Sent) — never
    // overwrite a terminal state (Cancelled, or a Failed/Delivered from an
    // earlier receipt for this same SID).
    if (isDelivered) {
      await ReviewRequest.updateMany(
        { lastMessageSid: messageSid, status: 'Sent' },
        { status: 'Delivered' }
      );
    } else if (isFailure) {
      const errorCodeNum = errorCode ? parseInt(errorCode, 10) : undefined;
      const affected = await ReviewRequest.find({ lastMessageSid: messageSid, status: 'Sent' })
        .select('_id businessId customerId campaignId followUpStage')
        .lean();
      if (affected.length) {
        for (const r of affected as any[]) {
          // Twilio doesn't always catch "outside the 24h window" synchronously
          // — sometimes it accepts a free-text send's API call optimistically
          // and only rejects it later, right here, via this same callback. By
          // then sendReviewRequest() (src/services/inngest/functions.ts) has
          // already returned "success" and moved on, so its template-fallback
          // never got a chance to run. Retry it now, from the one place that
          // actually knows the send failed.
          const retried = errorCodeNum === 63016
            ? await retryAsApprovedTemplate(r, messageSid)
            : false;

          if (!retried) {
            await ReviewRequest.updateOne(
              { _id: r._id },
              { status: 'Failed', failedReason: reason, automationStatus: 'Stopped' }
            );
            // The "delivered" counter on the campaign was incremented optimistically
            // at send time for the initial message only (see processReviewCampaign) —
            // correct it now that we know it never actually arrived. Reminders never
            // incremented it, so only followUpStage 0 needs the compensating decrement.
            if (r.campaignId && r.followUpStage === 0) {
              await Campaign.findByIdAndUpdate(r.campaignId, { $inc: { delivered: -1 } });
            }
            // Mirrors the sync-failure branch in processReviewCampaign's initial
            // send — surfaces the failure on the customer row too, which is what
            // makes the dashboard's "Retry" button appear. Only for the initial
            // message, matching that same convention (a reminder's async failure
            // doesn't flip it — the initial send already succeeded by then).
            if (r.followUpStage === 0) {
              await Customer.findByIdAndUpdate(r.customerId, { reviewStatus: 'Failed' });
            }
          }
        }
      } else if (errorCodeNum === 63016) {
        // Not a review request — OTP, an AI-agent reply, etc. Same async
        // "accepted then rejected" gap, different feature. Best-effort retry;
        // MessageQueue above already recorded the real failure either way.
        await retryGenericAsNotificationTemplate(messageSid);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[twilio-status-webhook] error:', error);
    // Still 200 — a malformed/unexpected callback shouldn't make Twilio retry forever.
    return NextResponse.json({ ok: true });
  }
}
