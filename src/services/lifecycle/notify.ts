import dbConnect from '@/lib/mongodb';
import { runWithMeter } from '@/lib/providerMeter';
import { notifyBusinessUsers } from '@/services/notifications';
import { notifyOwner, ownerWhatsAppPrefs } from '@/services/ownerNotify';
import { collectExecutions } from './collect';
import {
  buildWeeklySummary,
  composeWeeklyWhatsApp,
  isoWeekKey,
  reviewAttentionFilter,
  reviewAttentionText,
  REVIEW_ATTENTION_DRAFT_STATUSES,
  type WeeklyInput,
} from './weekly';
import { composeMonthlyWhatsApp } from './monthly';

const DAY = 86_400_000;
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');
/** An absolute link for a WhatsApp message, or null — a relative path is useless outside the app. */
const absoluteLink = (path: string): string | null => (/^https?:\/\//.test(appUrl()) ? `${appUrl()}${path}` : null);

/**
 * One "report ready" notice per report: atomically marks a COMPLETED audit as
 * announced. A retry, a duplicate job or a second caller for the same report
 * gets false and sends nothing.
 */
export async function claimReportOwnerNotice(auditId: string): Promise<boolean> {
  const { default: Audit } = await import('@/models/Audit');
  const claimed = await Audit.findOneAndUpdate(
    { _id: auditId, status: 'COMPLETED', ownerNotifiedAt: { $exists: false } },
    { $set: { ownerNotifiedAt: new Date() } },
    { projection: { _id: 1 } }
  ).lean();
  return !!claimed;
}

/**
 * Monthly report ready: in-app notification + (opted-in) WhatsApp. Sent once
 * per report — and there is one monthly report per business per month (the
 * Audit (businessId, auditKind, period) unique index) — only after the audit
 * completed, and the WhatsApp only with a real link to open it.
 */
export async function notifyMonthlyReport(businessId: string, auditId: string, auditData?: any): Promise<void> {
  const claimed = await claimReportOwnerNotice(auditId);
  // Claimed now or already announced: either way no deferred notice is owed any more.
  await clearPendingMonthlyNotice(businessId, auditId);
  if (!claimed) return;
  const link = `/dashboard/audit/${auditId}`;
  if (auditData === undefined) {
    const { default: Audit } = await import('@/models/Audit');
    auditData = ((await Audit.findById(auditId).select('auditData.monthly').lean()) as any)?.auditData;
  }
  const monthly = auditData?.monthly;
  // The claim is taken: an in-app failure must not also cost the WhatsApp.
  await notifyBusinessUsers(businessId, {
    type: 'monthly_report',
    title: 'Your monthly report is ready',
    body: monthly
      ? `${monthly.reviews.newReviews} new review${monthly.reviews.newReviews === 1 ? '' : 's'}, ${monthly.planCompleted.length} plan action${monthly.planCompleted.length === 1 ? '' : 's'} done, ${monthly.planPending.length} pending.`
      : 'Your monthly Google Business Profile report is ready.',
    link,
  }).catch((err: any) => console.error(`[monthlyReport] in-app notice failed for audit ${auditId}:`, err?.message));
  const reportLink = absoluteLink(link);
  if (!reportLink) {
    console.warn('[monthlyReport] NEXT_PUBLIC_APP_URL is not an absolute URL — WhatsApp skipped (no link to send).');
    return;
  }
  const Business = (await import('@/models/Business')).default;
  const b: any = await Business.findById(businessId).select('name').lean();
  await notifyOwner(businessId, { event: 'monthly_report', text: composeMonthlyWhatsApp(monthly, b?.name || 'your business', reportLink) });
}

export const MONTHLY_REPORT_NOTICE_EVENT = 'lifecycle/monthly-report.notice';
/** A deferred notice the sweep finds later than this is not sent — the owner has long seen the report in the dashboard. */
export const MONTHLY_NOTICE_SWEEP_MAX_AGE_MS = 3 * DAY;

async function clearPendingMonthlyNotice(businessId: string, auditId: string): Promise<void> {
  const { default: Business } = await import('@/models/Business');
  await Business.updateOne(
    { _id: businessId, 'monthlyReportNoticePending.auditId': auditId },
    { $unset: { monthlyReportNoticePending: '' } }
  ).catch((err: any) => console.error(`[monthlyReport] could not clear the pending notice for audit ${auditId}:`, err?.message));
}

/**
 * Entry point when a monthly report completes. The monthly audit runs on a
 * 30-day anchor that can fall at night, so between 21:00 and 09:00 IST the
 * notice (in-app + WhatsApp) is never sent immediately. It is deferred twice
 * over, so one failure cannot lose it:
 *  1. Business.monthlyReportNoticePending is written first (durable, in the
 *     database) — the hourly sweep (sendDueMonthlyReportNotices, run by
 *     audit-autopilot-cron) delivers it after 09:00 IST if nothing else did;
 *  2. the monthlyReportNotice Inngest job is queued — it sleeps until 09:00
 *     IST and delivers it on time. Its event id is per report, so a repeat
 *     is dropped by Inngest.
 * Whichever runs first claims the report (claimReportOwnerNotice) and clears
 * the pending record; the other sends nothing. If neither could be recorded
 * the failure is logged as an error and nothing is sent at night.
 */
export async function deliverMonthlyReportNotice(
  businessId: string,
  auditId: string,
  auditData: any,
  now = new Date()
): Promise<'sent' | 'deferred' | 'unscheduled'> {
  const { ownerQuietHoursDeferUntil } = await import('@/lib/istSchedule');
  const deferUntil = ownerQuietHoursDeferUntil(now);
  if (!deferUntil) {
    await notifyMonthlyReport(businessId, auditId, auditData);
    return 'sent';
  }
  let recorded = false;
  try {
    const { default: Business } = await import('@/models/Business');
    const res = await Business.updateOne({ _id: businessId }, { $set: { monthlyReportNoticePending: { auditId, dueAt: deferUntil } } });
    recorded = res.matchedCount > 0;
  } catch (err: any) {
    console.error(`[monthlyReport] could not record the pending notice for audit ${auditId}:`, err?.message);
  }
  let queued = false;
  try {
    const { inngest } = await import('@/services/inngest/client');
    await inngest.send({ id: `monthly-report-notice-${auditId}`, name: MONTHLY_REPORT_NOTICE_EVENT, data: { businessId, auditId } });
    queued = true;
  } catch (err: any) {
    console.error(`[monthlyReport] could not queue the 09:00 IST notice for audit ${auditId}${recorded ? ' — the hourly sweep will deliver it' : ''}:`, err?.message);
  }
  if (!recorded && !queued) {
    console.error(`[monthlyReport] NOTICE NOT SCHEDULED for audit ${auditId} (business ${businessId}): neither the pending record nor the job could be saved; not sending during quiet hours.`);
    return 'unscheduled';
  }
  return 'deferred';
}

/**
 * Hourly safety net for deferred monthly notices (called by
 * audit-autopilot-cron). Never sends in quiet hours; sends each due notice
 * through notifyMonthlyReport, whose claim keeps it to one per report even
 * when the queued job runs too. Notices overdue by more than
 * MONTHLY_NOTICE_SWEEP_MAX_AGE_MS are dropped instead of sent late.
 */
export async function sendDueMonthlyReportNotices(now = new Date()): Promise<{ due: number; processed: number; expired: number; skipped?: 'quiet_hours' }> {
  const { ownerQuietHoursDeferUntil } = await import('@/lib/istSchedule');
  if (ownerQuietHoursDeferUntil(now)) return { due: 0, processed: 0, expired: 0, skipped: 'quiet_hours' };
  await dbConnect();
  const { default: Business } = await import('@/models/Business');
  const due: any[] = await Business.find({ 'monthlyReportNoticePending.dueAt': { $lte: now } })
    .select('_id monthlyReportNoticePending').limit(100).lean();
  let processed = 0;
  let expired = 0;
  for (const b of due) {
    const { auditId, dueAt } = b.monthlyReportNoticePending || {};
    if (!auditId) continue;
    if (now.getTime() - new Date(dueAt).getTime() > MONTHLY_NOTICE_SWEEP_MAX_AGE_MS) {
      await clearPendingMonthlyNotice(String(b._id), String(auditId));
      expired++;
      continue;
    }
    try {
      await notifyMonthlyReport(String(b._id), String(auditId));
      processed++;
    } catch (err: any) {
      console.error(`[monthlyReport] sweep failed for audit ${auditId}:`, err?.message);
    }
  }
  return { due: due.length, processed, expired };
}

/**
 * The weekly reviews-need-attention reminder. Reads the review data fresh,
 * right before sending; nothing is sent unless at least one review meets the
 * definition in reviewAttentionFilter (lifecycle/weekly.ts). notifyOwner
 * enforces once per ISO week and the owner's reviewReplyWhatsApp preference.
 */
export async function sendReviewAttentionReminder(
  businessId: string,
  businessName: string,
  now = new Date()
): Promise<{ status: 'nothing_pending' | 'sent' | 'skipped' | 'failed'; pending: number; reason?: string }> {
  const { default: Review } = await import('@/models/Review');
  const filter = reviewAttentionFilter(businessId, now);
  const [pending, drafted] = await Promise.all([
    Review.countDocuments(filter),
    Review.countDocuments({ ...filter, replyStatus: { $in: [...REVIEW_ATTENTION_DRAFT_STATUSES] } }),
  ]);
  const weekKey = isoWeekKey(now);
  const text = reviewAttentionText({ businessName, pending, drafted, weekKey, reviewsLink: absoluteLink('/dashboard/reviews') });
  if (!text) return { status: 'nothing_pending', pending };
  const res = await notifyOwner(businessId, { event: 'review_attention', text, weekKey });
  return res.status === 'skipped' ? { status: 'skipped', pending, reason: res.reason } : { status: res.status, pending };
}

/**
 * One weekly monitoring pass for a business. Reads only what GrowwMatics
 * already stores — no ranking re-check, no audit, no paid provider call
 * (verified by running inside the provider meter). Idempotent per ISO week.
 */
export async function runWeeklyMonitoring(businessId: string, now = new Date()): Promise<{ status: string; weekKey: string; notifications?: number; whatsapp?: string; paidCalls?: number }> {
  await dbConnect();
  const [{ default: WeeklyMonitor }, { default: Business }, { default: Review }, { default: ReviewRequest }, { default: GBPInsights }, { default: Audit }, { default: OptimizationAction }] = await Promise.all([
    import('@/models/WeeklyMonitor'), import('@/models/Business'), import('@/models/Review'), import('@/models/ReviewRequest'),
    import('@/models/GBPInsights'), import('@/models/Audit'), import('@/models/OptimizationAction'),
  ]);
  const weekKey = isoWeekKey(now);
  try {
    await WeeklyMonitor.create({ businessId, weekKey, status: 'running' });
  } catch (err: any) {
    if (err?.code === 11000) return { status: 'already_ran', weekKey };
    throw err;
  }

  const b: any = await Business.findById(businessId).select('name googleConnected googleLocationId googleReviewTotals subscriptionStatus googlePlaceId placeId').lean();
  if (!b?.googleConnected) {
    await WeeklyMonitor.updateOne({ businessId, weekKey }, { $set: { status: 'skipped', skipReason: 'Google Business Profile not connected — verified weekly monitoring needs a connection' } });
    return { status: 'skipped', weekKey };
  }

  const { result: summary, counts } = await runWithMeter(async () => {
    const weekAgo = new Date(now.getTime() - 7 * DAY);
    const monthAgo = new Date(now.getTime() - 30 * DAY);
    const [newReviews, unanswered, requestsSent, prevRun, recentAudit, blocked, awaitingOwner, overdue] = await Promise.all([
      Review.find({ businessId, postedAt: { $gte: weekAgo, $lt: now } }).select('rating').lean(),
      Review.countDocuments({ businessId, postedAt: { $gte: monthAgo }, replyCheckedAt: { $exists: true }, replyStatus: { $ne: 'POSTED' }, $or: [{ response: { $exists: false } }, { response: '' }] }),
      ReviewRequest.countDocuments({ businessId, status: { $in: ['Sent', 'Delivered'] }, sentAt: { $gte: weekAgo, $lt: now } }),
      WeeklyMonitor.findOne({ businessId, weekKey: { $ne: weekKey }, status: 'done' }).sort({ createdAt: -1 }).select('inputs').lean(),
      Audit.findOne({ businessId, status: 'COMPLETED', fastMode: { $ne: true }, createdAt: { $gte: weekAgo } }).sort({ createdAt: -1 }).select('auditData.comparison').lean(),
      OptimizationAction.countDocuments({ businessId, status: 'BLOCKED' }),
      OptimizationAction.countDocuments({ businessId, status: 'PLANNED', capability: null }),
      OptimizationAction.countDocuments({ businessId, status: { $in: ['PLANNED', 'READY'] }, plannedAt: { $lt: monthAgo } }),
    ]);
    const ex = await collectExecutions(businessId, weekAgo, now);

    // Performance: last 7 complete days vs the 7 before (GBP data lags ~3 days).
    const end = new Date(now.getTime() - 3 * DAY);
    const mid = new Date(end.getTime() - 7 * DAY);
    const start = new Date(mid.getTime() - 7 * DAY);
    const rows: any[] = await GBPInsights.find({ businessId, date: { $gte: start, $lt: end } }).select('date callClicks websiteClicks directionRequests').lean();
    const sum = (from: Date, to: Date, k: string) => rows.filter((r) => r.date >= from && r.date < to).reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const hasPrev = rows.some((r) => r.date >= start && r.date < mid);
    const hasCur = rows.some((r) => r.date >= mid && r.date < end);
    const performance: WeeklyInput['performance'] = hasPrev && hasCur
      ? { calls: [sum(start, mid, 'callClicks'), sum(mid, end, 'callClicks')], websiteClicks: [sum(start, mid, 'websiteClicks'), sum(mid, end, 'websiteClicks')], directionRequests: [sum(start, mid, 'directionRequests'), sum(mid, end, 'directionRequests')] }
      : null;

    const rankRows: any[] = (recentAudit as any)?.auditData?.comparison?.rows?.filter((r: any) => /search|position/i.test(r.metric)) || [];
    const comparable = rankRows.filter((r) => r.change !== 'not_comparable');
    const ratingNow = typeof b.googleReviewTotals?.rating === 'number' ? b.googleReviewTotals.rating : null;
    const syncedAt = b.googleReviewTotals?.capturedAt ? new Date(b.googleReviewTotals.capturedAt) : null;
    const ratings = (newReviews as any[]).map((r) => r.rating).filter((r) => r > 0);

    const input: WeeklyInput = {
      weekKey,
      reviews: {
        newCount: newReviews.length,
        newAverageRating: ratings.length ? Math.round((ratings.reduce((a, c) => a + c, 0) / ratings.length) * 10) / 10 : null,
        unanswered,
        ratingNow,
        ratingWeekAgo: (prevRun as any)?.inputs?.reviews?.ratingNow ?? null,
        syncedThisWeek: !!syncedAt && syncedAt >= weekAgo,
        requestsSent,
      },
      activity: {
        postsPublished: ex.posts.length,
        photosPublished: ex.photos.length,
        profileEditsApplied: ex.profileEdits.filter((e) => e.liveWriteApplied === true).length,
        repliesPosted: ex.replies.filter((r) => r.by !== 'external').length,
      },
      ranking: comparable.length ? { improved: comparable.filter((r) => r.change === 'better').length, declined: comparable.filter((r) => r.change === 'worse').length, comparable: comparable.length } : null,
      plan: { blocked, awaitingOwner, overdue },
      performance,
    };
    return { input, ...buildWeeklySummary(input) };
  });

  for (const n of summary.notifications) await notifyBusinessUsers(businessId, n);
  await contentPrompts(businessId, now, b?.name || 'your business').catch((err) => console.error('[weeklyMonitor] content prompts failed:', err?.message));
  // At most ONE WhatsApp from the weekly run. Reviews that verifiably need a
  // reply come first (the weekly reminder); otherwise a meaningful week sends
  // the performance update, which notifyOwner caps at 2 per rolling 15 days.
  // "No new reviews this week" is in-app only (summary.notifications above).
  let whatsapp = 'not_sent';
  const businessName = b?.name || 'your business';
  const prefs = await ownerWhatsAppPrefs(businessId);
  if (!prefs?.phone) whatsapp = 'no_phone';
  else {
    const attention = await sendReviewAttentionReminder(businessId, businessName, now);
    if (attention.status === 'sent') whatsapp = 'review_attention_sent';
    else if (!summary.meaningful && !prefs.prefs.weeklyReportAlwaysWhatsApp) whatsapp = 'suppressed_nothing_new';
    else {
      const res = await notifyOwner(businessId, { event: 'weekly_update', text: composeWeeklyWhatsApp(summary, businessName, absoluteLink('/dashboard')) });
      whatsapp = res.status === 'sent' ? 'sent' : res.status === 'skipped' ? `skipped_${res.reason}` : 'failed';
    }
  }
  const paidCalls = Object.entries(counts).filter(([k]) => !/CacheHit$|Token$/.test(k) && k !== 'websiteFetch').reduce((a, [, n]) => a + (n || 0), 0);
  await WeeklyMonitor.updateOne(
    { businessId, weekKey },
    { $set: { status: 'done', lines: summary.lines, meaningful: summary.meaningful, notificationsCreated: summary.notifications.length, whatsappSent: whatsapp === 'sent' || whatsapp === 'review_attention_sent', whatsappSkipReason: whatsapp === 'sent' ? undefined : whatsapp, inputs: summary.input, providerUsage: { counts, paidCalls } } },
  );
  return { status: 'done', weekKey, notifications: summary.notifications.length, whatsapp, paidCalls };
}

/**
 * Weekly content prompts (Sep 2026), each sent at most once:
 *  - "Anything to promote this week?" (in-app) when this week's WeeklyOffer is unanswered —
 *    once per week because this whole pass is idempotent per week;
 *  - festivals in the next 14 days from the stored calendar — one in-app
 *    notification per business per festival (FestivalPrompt unique). Not sent
 *    over WhatsApp: it is an optional prompt, and a greeting is posted anyway.
 */
export async function contentPrompts(businessId: string, now: Date, businessName: string): Promise<{ offerAsked: boolean; festivals: string[] }> {
  const [{ default: WeeklyOffer }, { default: FestivalPrompt }, { festivalsBetween }, { contentWeekKey }] = await Promise.all([
    import('@/models/WeeklyOffer'), import('@/models/FestivalPrompt'), import('@/lib/festivalCalendar'), import('@/services/content/plan'),
  ]);
  const answered = await WeeklyOffer.exists({ businessId, weekKey: contentWeekKey(now) });
  if (!answered) {
    await notifyBusinessUsers(businessId, {
      type: 'weekly_offer_question',
      title: 'Anything to promote this week?',
      body: 'Tell us about an offer, new service or announcement and we’ll make it one of this week’s Google posts — using only your words.',
      link: '/dashboard',
    });
  }
  const sent: string[] = [];
  for (const f of festivalsBetween(now, 14)) {
    try {
      await FestivalPrompt.create({ businessId, festivalKey: f.key, festivalName: f.name, festivalDate: f.date });
    } catch (err: any) {
      if (err?.code === 11000) continue; // already asked about this festival
      throw err;
    }
    const when = `${f.date}${f.approximate ? ' (date may shift by a day)' : ''}`;
    await notifyBusinessUsers(businessId, {
      type: 'festival_prompt',
      title: `${f.name} is coming up`,
      body: `${f.name} is on ${when}. Want a special offer or message in your Google posts? Add it from the dashboard — otherwise we’ll post a simple greeting.`,
      link: '/dashboard',
    });
    await FestivalPrompt.updateOne({ businessId, festivalKey: f.key }, { $set: { inApp: true, whatsapp: 'not_sent' } });
    sent.push(f.key);
  }
  return { offerAsked: !answered, festivals: sent };
}

/**
 * 15-day Google performance update over WhatsApp. At most once per 15 days
 * per business (atomic claim on Business.performanceDigestLastSentAt before
 * sending, so reruns never duplicate). Stored GBPInsights only — no API call.
 */
export async function sendPerformanceDigest(businessId: string, now = new Date()): Promise<{ status: string }> {
  await dbConnect();
  const [{ default: Business }, { default: GBPInsights }, { buildPerformanceDigest, composePerformanceDigest, DIGEST_DAYS, DATA_LAG_DAYS }] = await Promise.all([
    import('@/models/Business'), import('@/models/GBPInsights'), import('./performanceDigest'),
  ]);
  const b: any = await Business.findById(businessId).select('name performanceDigestLastSentAt').lean();
  if (!b) return { status: 'no_business' };
  const since = new Date(now.getTime() - (2 * DIGEST_DAYS + DATA_LAG_DAYS + 2) * DAY);
  const rows: any[] = await GBPInsights.find({ businessId, date: { $gte: since } })
    .select('date views viewsSearch viewsMaps callClicks websiteClicks directionRequests conversations').lean();
  const insightsLink = absoluteLink('/dashboard/insights');
  if (!insightsLink) return { status: 'no_app_url' };
  const text = composePerformanceDigest(buildPerformanceDigest(rows, now), b.name || 'your business', insightsLink);
  if (!text) return { status: 'not_enough_data' };
  // Claim the 15-day slot first (half a day of slack so a daily cron isn't pushed later each cycle).
  const due = new Date(now.getTime() - (DIGEST_DAYS * DAY - 12 * 3_600_000));
  const claimed = await Business.findOneAndUpdate(
    { _id: businessId, $or: [{ performanceDigestLastSentAt: { $exists: false } }, { performanceDigestLastSentAt: null }, { performanceDigestLastSentAt: { $lte: due } }] },
    { $set: { performanceDigestLastSentAt: now } },
  );
  if (!claimed) return { status: 'not_due' };
  const res = await notifyOwner(businessId, { event: 'performance_digest', text });
  // Held back by the 2-per-15-days performance-update limit (or a failed
  // send): give the 15-day slot back so tomorrow's cron can try again.
  if (res.status === 'failed' || (res.status === 'skipped' && res.reason === 'performance_update_limit')) {
    await Business.updateOne(
      { _id: businessId, performanceDigestLastSentAt: now },
      b.performanceDigestLastSentAt ? { $set: { performanceDigestLastSentAt: b.performanceDigestLastSentAt } } : { $unset: { performanceDigestLastSentAt: '' } },
    );
    return { status: res.status === 'failed' ? 'failed' : 'performance_update_limit' };
  }
  return { status: res.status === 'sent' ? 'sent' : `skipped_${res.reason}` };
}

/** Daily cron entry: subscribed, Google-connected businesses whose 15-day update is due. */
export async function runPerformanceDigestAll(now = new Date()): Promise<{ businesses: number; sent: number }> {
  await dbConnect();
  const Business = (await import('@/models/Business')).default;
  const due = new Date(now.getTime() - (15 * DAY - 12 * 3_600_000));
  const { planAccessWorkspaceFilter } = await import('@/lib/billing/entitlements');
  const list: any[] = await Business.find({
    isDeleted: { $ne: true }, googleConnected: true,
    googleLocationId: { $exists: true, $nin: [null, ''] },
    // Paid, or an authorized free trial within its window.
    $and: [
      planAccessWorkspaceFilter(now),
      { $or: [{ performanceDigestLastSentAt: { $exists: false } }, { performanceDigestLastSentAt: null }, { performanceDigestLastSentAt: { $lte: due } }] },
    ],
  }).select('_id').lean();
  let sent = 0;
  for (const b of list) {
    try {
      if ((await sendPerformanceDigest(String(b._id), now)).status === 'sent') sent++;
    } catch (err: any) {
      console.error(`[performanceDigest] business ${b._id} failed:`, err?.message);
    }
  }
  return { businesses: list.length, sent };
}

/** Weekly cron entry: every subscribed, Google-connected business. */
export async function runWeeklyMonitoringAll(now = new Date()): Promise<{ businesses: number; done: number; skipped: number; alreadyRan: number }> {
  await dbConnect();
  const Business = (await import('@/models/Business')).default;
  const { planAccessWorkspaceFilter } = await import('@/lib/billing/entitlements');
  const list: any[] = await Business.find({
    isDeleted: { $ne: true }, googleConnected: true,
    googleLocationId: { $exists: true, $nin: [null, ''] },
    ...planAccessWorkspaceFilter(now), // paid, or an authorized free trial
  }).select('_id').lean();
  let done = 0; let skipped = 0; let alreadyRan = 0;
  for (const b of list) {
    try {
      const r = await runWeeklyMonitoring(b._id.toString(), now);
      if (r.status === 'done') done++; else if (r.status === 'already_ran') alreadyRan++; else skipped++;
    } catch (err: any) {
      console.error(`[weeklyMonitor] business ${b._id} failed:`, err?.message);
    }
  }
  return { businesses: list.length, done, skipped, alreadyRan };
}
