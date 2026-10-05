import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import OwnerNotifyDigest from '@/models/OwnerNotifyDigest';
import { sendOutboundMessage } from '@/services/whatsapp/send';
import { isBillingOwnerEvent, ownerBusinessWhatsAppAllowed, type OwnerBusinessEvent } from '@/services/ownerNotifyEligibility';

/**
 * Owner-facing WhatsApp notification layer.
 *
 * This is PURELY the WhatsApp channel — it does not touch the in-app bell
 * (notifyBusinessUsers) or mobile push (sendPushToBusinessUsers). Call sites
 * keep their existing in-app/push calls; notifyOwner() is added alongside
 * them so the workspace owner also gets a WhatsApp message about what the
 * platform is doing on their account (posts published, review replies sent,
 * their report being ready, billing, a critical review, a new CRM lead).
 *
 * Two delivery modes:
 *  - immediate: sent right now via the platform WhatsApp number. Used for
 *    high-value, time-sensitive events (new lead, demo booking, critical
 *    review, report ready, billing).
 *  - digest (immediate: false): queued to OwnerNotifyDigest; the once-a-day
 *    ownerWhatsAppDigestCron (~7pm IST) sends one consolidated message. Used
 *    for routine automation activity that would be spammy one-by-one.
 *
 * Every send/queue respects the owner's User.notificationPreferences:
 *  - `whatsAppNotificationsEnabled` is the master switch (off → nothing).
 *  - each event maps to one per-event toggle (below).
 *  - digest events additionally require `dailyDigestWhatsApp`.
 *
 * Best-effort: never throws. A missing owner phone, an opted-out owner, or a
 * send failure is logged (where useful) and swallowed — this can never break
 * the workflow that produced the activity.
 */

export type OwnerNotifyEvent = OwnerBusinessEvent;

interface EventMeta {
  /** notificationPreferences key gating this event. */
  pref:
    | 'newLeadWhatsApp'
    | 'demoBookingWhatsApp'
    | 'criticalReviewWhatsApp'
    | 'billingWhatsApp'
    | 'postPublishedWhatsApp'
    | 'reviewReplyWhatsApp'
    | 'reportReadyWhatsApp'
    | 'weeklyUpdateWhatsApp'
    | 'performanceDigestWhatsApp'
    | 'whatsAppNotificationsEnabled';
  /** false → queued to the daily digest instead of sent immediately. */
  immediate: boolean;
}

const EVENT_META: Record<OwnerNotifyEvent, EventMeta> = {
  new_lead: { pref: 'newLeadWhatsApp', immediate: true },
  demo_booking: { pref: 'demoBookingWhatsApp', immediate: true },
  critical_review: { pref: 'criticalReviewWhatsApp', immediate: true },
  report_ready: { pref: 'reportReadyWhatsApp', immediate: true },
  billing_activated: { pref: 'billingWhatsApp', immediate: true },
  billing_past_due: { pref: 'billingWhatsApp', immediate: true },
  billing_canceled: { pref: 'billingWhatsApp', immediate: true },
  profile_incomplete: { pref: 'whatsAppNotificationsEnabled', immediate: true },
  monthly_report: { pref: 'reportReadyWhatsApp', immediate: true },
  weekly_update: { pref: 'weeklyUpdateWhatsApp', immediate: true },
  festival_prompt: { pref: 'weeklyUpdateWhatsApp', immediate: true },
  review_reminder: { pref: 'weeklyUpdateWhatsApp', immediate: true },
  performance_digest: { pref: 'performanceDigestWhatsApp', immediate: true },
  post_published: { pref: 'postPublishedWhatsApp', immediate: false },
  photo_published: { pref: 'postPublishedWhatsApp', immediate: false },
  review_reply_sent: { pref: 'reviewReplyWhatsApp', immediate: false },
  review_reply_drafted: { pref: 'reviewReplyWhatsApp', immediate: false },
  content_batch_generated: { pref: 'postPublishedWhatsApp', immediate: false },
};

/** Defaults for every WhatsApp-notification preference (all opt-out). */
export const OWNER_NOTIFY_PREF_DEFAULTS = {
  whatsAppNotificationsEnabled: true,
  dailyDigestWhatsApp: true,
  newLeadWhatsApp: true,
  demoBookingWhatsApp: true,
  criticalReviewWhatsApp: true,
  billingWhatsApp: true,
  postPublishedWhatsApp: true,
  reviewReplyWhatsApp: true,
  reportReadyWhatsApp: true,
  weeklyUpdateWhatsApp: true,
  weeklyReportAlwaysWhatsApp: false,
  performanceDigestWhatsApp: true,
} as const;

export interface NotifyOwnerInput {
  event: OwnerNotifyEvent;
  /** Full WhatsApp message text (immediate) / one-line summary (digest). */
  text: string;
  /** How many underlying items this represents — collapses a batch to one digest line. */
  count?: number;
}

interface ResolvedOwner {
  businessId: string;
  businessName: string;
  userId?: string;
  phone?: string;
  prefs: Record<string, boolean>;
  subscriptionStatus?: string;
  googleConnected?: boolean;
  googleLocationId?: string;
}

async function resolveOwner(businessId: string): Promise<ResolvedOwner | null> {
  const business = await Business.findById(businessId)
    .select('name userId phone subscriptionStatus googleConnected googleLocationId')
    .lean<{
      name?: string;
      userId?: { toString(): string };
      phone?: string;
      subscriptionStatus?: string;
      googleConnected?: boolean;
      googleLocationId?: string;
    }>();
  if (!business) return null;

  let phone = business.phone || undefined;
  let userId: string | undefined;
  let prefs: Record<string, boolean> = { ...OWNER_NOTIFY_PREF_DEFAULTS };

  if (business.userId) {
    userId = business.userId.toString();
    const owner = await User.findById(userId)
      .select('phone notificationPreferences')
      .lean<{ phone?: string; notificationPreferences?: Record<string, boolean> }>();
    if (owner) {
      // Owner's account phone wins; fall back to the business phone on file.
      phone = owner.phone || phone;
      prefs = { ...OWNER_NOTIFY_PREF_DEFAULTS, ...(owner.notificationPreferences || {}) };
    }
  }

  return {
    businessId,
    businessName: business.name || 'your workspace',
    userId,
    phone,
    prefs,
    subscriptionStatus: business.subscriptionStatus,
    googleConnected: business.googleConnected,
    googleLocationId: business.googleLocationId,
  };
}

/** Whether the owner has opted into this specific event over WhatsApp. */
function isOptedIn(prefs: Record<string, boolean>, meta: EventMeta): boolean {
  if (prefs.whatsAppNotificationsEnabled === false) return false;
  if (prefs[meta.pref] === false) return false;
  if (!meta.immediate && prefs.dailyDigestWhatsApp === false) return false;
  return true;
}

/** Human label for each digest event, used to headline its section. */
const DIGEST_EVENT_LABEL: Partial<Record<OwnerNotifyEvent, string>> = {
  post_published: 'Posts published',
  photo_published: 'Photos published',
  review_reply_sent: 'Review replies sent',
  review_reply_drafted: 'Review replies awaiting your approval',
  content_batch_generated: 'New content scheduled',
};

/**
 * Composes + sends the once-a-day WhatsApp digest for every workspace that
 * has unsent OwnerNotifyDigest rows, then stamps those rows `sentAt`. Called
 * by ownerWhatsAppDigestCron (~7pm IST). Best-effort per workspace — one
 * failure never blocks the rest.
 */
export async function sendPendingOwnerDigests(): Promise<{ businesses: number; sent: number }> {
  await dbConnect();

  const businessIds: any[] = await OwnerNotifyDigest.distinct('businessId', { sentAt: null });
  let sent = 0;

  for (const businessId of businessIds) {
    try {
      const rows = await OwnerNotifyDigest.find({ businessId, sentAt: null })
        .sort({ createdAt: 1 })
        .lean<Array<{ _id: any; event: string; text: string; count: number }>>();
      if (rows.length === 0) continue;

      const rowIds = rows.map((r) => r._id);

      const owner = await resolveOwner(businessId.toString());
      // A free-report lead is not a customer. Drop the queued lines instead of
      // sending them later, the day they subscribe.
      if (
        !owner ||
        !owner.phone ||
        !ownerBusinessWhatsAppAllowed(owner, 'post_published') ||
        owner.prefs.whatsAppNotificationsEnabled === false ||
        owner.prefs.dailyDigestWhatsApp === false
      ) {
        await OwnerNotifyDigest.updateMany({ _id: { $in: rowIds } }, { $set: { sentAt: new Date() } });
        continue;
      }

      // Group by event, summing counts.
      const byEvent = new Map<string, { count: number; samples: string[] }>();
      for (const r of rows) {
        const g = byEvent.get(r.event) || { count: 0, samples: [] };
        g.count += r.count || 1;
        if (g.samples.length < 3) g.samples.push(r.text);
        byEvent.set(r.event, g);
      }

      const lines: string[] = [`📊 *Today on GrowwMatics — ${owner.businessName}*`, ''];
      for (const [event, g] of byEvent) {
        const label = DIGEST_EVENT_LABEL[event as OwnerNotifyEvent] || event;
        lines.push(`*${label}* (${g.count})`);
        for (const s of g.samples) lines.push(`• ${s}`);
        if (g.count > g.samples.length) lines.push(`• …and ${g.count - g.samples.length} more`);
        lines.push('');
      }
      lines.push('Open your dashboard for details.');

      const res = await sendOutboundMessage(owner.phone!, lines.join('\n').trim(), undefined, businessId.toString());
      await OwnerNotifyDigest.updateMany({ _id: { $in: rowIds } }, { $set: { sentAt: new Date() } });
      if (res.success) sent++;
    } catch (err: any) {
      console.error('[ownerNotify] digest send failed for business', String(businessId), err?.message);
    }
  }

  return { businesses: businessIds.length, sent };
}

/** The owner's resolved WhatsApp preferences (defaults applied), for callers that gate on them. */
export async function ownerWhatsAppPrefs(businessId: string): Promise<{ phone?: string; prefs: Record<string, boolean> } | null> {
  await dbConnect();
  const o = await resolveOwner(businessId);
  return o ? { phone: o.phone, prefs: o.prefs } : null;
}

export async function notifyOwner(businessId: string, input: NotifyOwnerInput): Promise<void> {
  try {
    await dbConnect();
    const meta = EVENT_META[input.event];
    if (!meta) return;

    const owner = await resolveOwner(businessId);
    if (!owner) return;
    if (!ownerBusinessWhatsAppAllowed(owner, input.event)) return;
    // Billing reminders are not business-activity notifications.
    if (!isBillingOwnerEvent(input.event) && !isOptedIn(owner.prefs, meta)) return;

    if (meta.immediate) {
      if (!owner.phone) return;
      await sendOutboundMessage(owner.phone, input.text, undefined, businessId);
      return;
    }

    // Digest — queue a line; the cron composes + sends the daily message.
    await OwnerNotifyDigest.create({
      businessId,
      userId: owner.userId,
      event: input.event,
      text: input.text,
      count: input.count ?? 1,
    });
  } catch (err: any) {
    console.error(`[ownerNotify] ${input.event} for business ${businessId} failed:`, err?.message);
  }
}
