/**
 * Delivery receipts → ReviewRequest status, for both WhatsApp providers.
 *
 * Twilio's status callback (api/webhook/twilio/status) and Meta's status
 * webhook (api/whatsapp/webhook) both land here, so a review request reads
 * Sent → Delivered → Read / Failed the same way whichever line sent it.
 *
 * A failed message gets one recovery attempt through Twilio:
 *  - Twilio free text refused for the 24h window (63016) → the approved
 *    Twilio review template (as before).
 *  - A Meta review template that Meta reports as failed → the same request
 *    through Twilio (the Meta → Twilio fallback). Claimed on the send log
 *    first, so a repeated webhook cannot send a second copy.
 */
import MessageQueue from '@/models/MessageQueue';
import ReviewRequest from '@/models/ReviewRequest';
import Campaign from '@/models/Campaign';
import Business from '@/models/Business';
import Customer from '@/models/Customer';
import { chooseReviewTemplateRetry, readTimestamps } from '@/lib/reviewRequestFlow';

export type InterpretedStatus =
  | { kind: 'ignore' }
  | { kind: 'delivered' }
  | { kind: 'read' }
  | { kind: 'failed'; errorCode?: string; errorMessage: string; failedReason: string };

type ReviewRow = { _id: any; businessId: any; customerId: any; token?: string };

/**
 * One retry of a failed review message through Twilio's approved template.
 * `fromMeta`: the failed message was a Meta send — retried regardless of the
 * error code (Twilio is the fallback line), once only.
 */
export async function retryReviewViaTwilio(
  r: ReviewRow,
  failedSid: string,
  errorCode: string | undefined,
  opts: { fromMeta?: boolean } = {}
): Promise<boolean> {
  try {
    if (opts.fromMeta) {
      const claimed = await MessageQueue.updateOne(
        { 'payload.sid': failedSid, 'payload.provider': 'meta', 'payload.twilioFallback': { $ne: true } },
        { $set: { 'payload.twilioFallback': true } }
      );
      if (claimed.modifiedCount !== 1) return false;
    }

    const originalLog = opts.fromMeta
      ? null
      : await MessageQueue.findOne({ 'payload.sid': failedSid })
        .select('payload.contentSid')
        .lean<{ payload?: { contentSid?: string } }>();
    const alreadyTemplate = !!originalLog?.payload?.contentSid;

    const [business, customer] = await Promise.all([
      Business.findById(r.businessId).select('name placeId').lean<{ name?: string; placeId?: string }>(),
      Customer.findById(r.customerId).select('name phone optedOut').lean<{ name?: string; phone?: string; optedOut?: boolean }>(),
    ]);
    if (!customer?.phone || customer.optedOut) return false;

    const { WA_TEMPLATES } = await import('@/lib/whatsappTemplates');
    const choice = chooseReviewTemplateRetry({
      // A Meta failure goes to Twilio's template the same way a 63016 does.
      errorCode: opts.fromMeta ? '63016' : errorCode,
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
    // A review request: not one of our chats, kept out of the WhatsApp Inbox.
    const { withWhatsAppSendContext } = await import('@/services/inbox/whatsappLog');
    const retry = await withWhatsAppSendContext({ exclude: 'review-request' }, () =>
      sendTemplateMessage(customer.phone!, choice.contentSid, choice.variables, r.businessId.toString()));
    if (!retry.success) {
      if (opts.fromMeta) console.warn(`[review-delivery] Twilio fallback for failed Meta message ${failedSid} also failed: ${retry.error}`);
      return false;
    }
    if (opts.fromMeta) console.info(`[review-delivery] Meta message ${failedSid} failed (${errorCode || 'no code'}) — resent through Twilio as ${retry.sid}`);

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
    console.error('[review-delivery] template retry failed:', e);
    return false;
  }
}

/**
 * Applies one delivery receipt to every ReviewRequest that sent `messageSid`.
 * Returns how many review requests matched (0 = not a review message).
 */
export async function applyReviewDeliveryStatus(
  messageSid: string,
  interpreted: InterpretedStatus,
  retry: (r: ReviewRow) => Promise<boolean>,
  now = new Date()
): Promise<number> {
  if (interpreted.kind === 'ignore') return 0;
  const affected = await ReviewRequest.find({
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
      const retried = isLatest && r.status === 'Sent' ? await retry(r) : false;

      if (retried) {
        // The failed attempt stays in the history as Failed; the retry is the new latest.
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
        continue;
      }

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
  return affected.length;
}
