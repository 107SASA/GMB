import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import MessageQueue from '@/models/MessageQueue';
import Conversation from '@/models/Conversation';
import ReviewRequest from '@/models/ReviewRequest';
import Campaign from '@/models/Campaign';
import Business from '@/models/Business';
import Customer from '@/models/Customer';
import { validateTwilioSignature } from '@/lib/twilioSignature';
import {
  chooseReviewTemplateRetry,
  interpretTwilioStatus,
  readTimestamps,
} from '@/lib/reviewRequestFlow';

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

async function retryAsApprovedTemplate(
  r: { _id: any; businessId: any; customerId: any; token?: string },
  failedSid: string,
  errorCode?: string
): Promise<boolean> {
  try {
    const originalLog = await MessageQueue.findOne({ 'payload.sid': failedSid })
      .select('payload.contentSid')
      .lean<{ payload?: { contentSid?: string } }>();
    const alreadyTemplate = !!originalLog?.payload?.contentSid;

    const [business, customer] = await Promise.all([
      Business.findById(r.businessId).select('name placeId').lean<{ name?: string; placeId?: string }>(),
      Customer.findById(r.customerId).select('name phone').lean<{ name?: string; phone?: string }>(),
    ]);
    if (!customer?.phone) return false;

    const { WA_TEMPLATES } = await import('@/lib/whatsappTemplates');
    const choice = chooseReviewTemplateRetry({
      errorCode,
      alreadyTemplate,
      utilitySid: WA_TEMPLATES.reviewRequestUtility,
      legacySid: WA_TEMPLATES.reviewRequest,
      token: r.token || '',
      placeId: business?.placeId || '',
      customerName: customer.name || 'there',
      businessName: business?.name || 'our business',
    });
    if (choice.mode === 'none') return false;

    const { sendTemplateMessage } = await import('@/services/twilio/client');
    const retry = await sendTemplateMessage(customer.phone, choice.contentSid, choice.variables, r.businessId.toString());
    if (!retry.success) return false;

    await ReviewRequest.updateOne(
      { _id: r._id },
      {
        status: 'Sent',
        lastMessageSid: retry.sid,
        templateSid: choice.contentSid,
        $unset: { failedReason: '', errorCode: '', errorMessage: '', failedAt: '' },
        $push: {
          messageSids: retry.sid,
          messageHistory: {
            sid: retry.sid,
            templateSid: choice.contentSid,
            templateKind: choice.mode,
            stage: 'retry',
            sentAt: new Date(),
            status: 'Sent',
          },
        },
      }
    );
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
    if (!log?.payload || log.payload.contentSid) return false;
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

    const interpreted = interpretTwilioStatus(messageStatus, errorCode, errorMessageRaw);
    const now = new Date();

    if (interpreted.kind === 'failed') {
      await MessageQueue.updateMany(
        { 'payload.sid': messageSid },
        { status: 'FAILED', failedReason: interpreted.failedReason, errorCode: interpreted.errorCode }
      );
    }

    if (interpreted.kind === 'delivered' || interpreted.kind === 'read' || interpreted.kind === 'failed') {
      await Conversation.updateMany(
        { twilioSid: messageSid },
        { messageStatus: interpreted.kind === 'failed' ? 'failed' : messageStatus }
      );
    }

    const affected = interpreted.kind === 'ignore'
      ? []
      : await ReviewRequest.find({
          $or: [{ lastMessageSid: messageSid }, { messageSids: messageSid }],
        }).select('_id businessId customerId campaignId followUpStage status lastMessageSid deliveredAt readAt token');

    for (const r of affected as any[]) {
      const isLatest = !r.lastMessageSid || r.lastMessageSid === messageSid;
      const historySet: Record<string, unknown> = {};

      if (interpreted.kind === 'delivered') {
        if (!isLatest || r.status === 'Failed' || r.status === 'Read' || r.status === 'Cancelled') {
          historySet['messageHistory.$[entry].status'] = 'Delivered';
          await ReviewRequest.updateOne(
            { _id: r._id },
            { $set: historySet },
            { arrayFilters: [{ 'entry.sid': messageSid }] }
          );
          continue;
        }
        await ReviewRequest.updateOne(
          { _id: r._id, status: { $in: ['Sent', 'Delivered'] } },
          {
            $set: {
              status: 'Delivered',
              ...(r.deliveredAt ? {} : { deliveredAt: now }),
              'messageHistory.$[entry].status': 'Delivered',
            },
          },
          { arrayFilters: [{ 'entry.sid': messageSid }] }
        );
      } else if (interpreted.kind === 'read') {
        if (!isLatest || r.status === 'Failed' || r.status === 'Cancelled') {
          await ReviewRequest.updateOne(
            { _id: r._id },
            { $set: { 'messageHistory.$[entry].status': 'Read' } },
            { arrayFilters: [{ 'entry.sid': messageSid }] }
          );
          continue;
        }
        const stamps = readTimestamps(now, r.deliveredAt);
        await ReviewRequest.updateOne(
          { _id: r._id, status: { $in: ['Sent', 'Delivered', 'Read'] } },
          {
            $set: {
              status: 'Read',
              readAt: r.readAt || stamps.readAt,
              deliveredAt: r.deliveredAt || stamps.deliveredAt,
              'messageHistory.$[entry].status': 'Read',
            },
          },
          { arrayFilters: [{ 'entry.sid': messageSid }] }
        );
      } else if (interpreted.kind === 'failed') {
        const retried = isLatest && r.status === 'Sent'
          ? await retryAsApprovedTemplate(r, messageSid, interpreted.errorCode)
          : false;

        if (retried) continue;

        if (isLatest && r.status === 'Sent') {
          await ReviewRequest.updateOne(
            { _id: r._id },
            {
              $set: {
                status: 'Failed',
                failedReason: interpreted.failedReason,
                errorCode: interpreted.errorCode,
                errorMessage: interpreted.errorMessage,
                failedAt: now,
                automationStatus: 'Stopped',
                'messageHistory.$[entry].status': 'Failed',
                'messageHistory.$[entry].errorCode': interpreted.errorCode,
                'messageHistory.$[entry].errorMessage': interpreted.errorMessage,
                'messageHistory.$[entry].failedAt': now,
              },
            },
            { arrayFilters: [{ 'entry.sid': messageSid }] }
          );
          if (r.campaignId && r.followUpStage === 0) {
            await Campaign.findByIdAndUpdate(r.campaignId, { $inc: { delivered: -1 } });
          }
          if (r.followUpStage === 0) {
            await Customer.findByIdAndUpdate(r.customerId, { reviewStatus: 'Failed' });
          }
        } else {
          await ReviewRequest.updateOne(
            { _id: r._id },
            {
              $set: {
                'messageHistory.$[entry].status': 'Failed',
                'messageHistory.$[entry].errorCode': interpreted.errorCode,
                'messageHistory.$[entry].errorMessage': interpreted.errorMessage,
                'messageHistory.$[entry].failedAt': now,
              },
            },
            { arrayFilters: [{ 'entry.sid': messageSid }] }
          );
        }
      }
    }

    if (!affected.length && interpreted.kind === 'failed' && interpreted.errorCode === '63016') {
      await retryGenericAsNotificationTemplate(messageSid);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[twilio-status-webhook] error:', error);
    return NextResponse.json({ ok: true });
  }
}
