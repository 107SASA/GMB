import dbConnect from '@/lib/mongodb';
import { runWithMeter } from '@/lib/providerMeter';
import { notifyBusinessUsers } from '@/services/notifications';
import { notifyOwner, ownerWhatsAppPrefs } from '@/services/ownerNotify';
import { collectExecutions } from './collect';
import { buildWeeklySummary, isoWeekKey, type WeeklyInput } from './weekly';
import { composeMonthlyWhatsApp } from './monthly';

const DAY = 86_400_000;
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || '').replace(/\/$/, '');

/** Monthly report ready: in-app notification + (opted-in) WhatsApp summary of verified values only. */
export async function notifyMonthlyReport(businessId: string, auditId: string, auditData: any): Promise<void> {
  const link = `/dashboard/audit/${auditId}`;
  const monthly = auditData?.monthly;
  await notifyBusinessUsers(businessId, {
    type: 'monthly_report',
    title: 'Your monthly report is ready',
    body: monthly
      ? `${monthly.reviews.newReviews} new review${monthly.reviews.newReviews === 1 ? '' : 's'}, ${monthly.planCompleted.length} plan action${monthly.planCompleted.length === 1 ? '' : 's'} done, ${monthly.planPending.length} pending.`
      : 'Your monthly Google Business Profile report is ready.',
    link,
  });
  const Business = (await import('@/models/Business')).default;
  const b: any = await Business.findById(businessId).select('name').lean();
  await notifyOwner(businessId, { event: 'monthly_report', text: composeMonthlyWhatsApp(monthly, b?.name || 'your business', `${appUrl()}${link}`) });
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

  const b: any = await Business.findById(businessId).select('name googleConnected googleLocationId googleReviewTotals subscriptionStatus').lean();
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
  let whatsapp = 'not_sent';
  const prefs = await ownerWhatsAppPrefs(businessId);
  if (!prefs?.phone) whatsapp = 'no_phone';
  else if (!summary.meaningful && !prefs.prefs.weeklyReportAlwaysWhatsApp) whatsapp = 'suppressed_nothing_new';
  else {
    await notifyOwner(businessId, { event: 'weekly_update', text: `${summary.whatsappText}\n${appUrl()}/dashboard` });
    whatsapp = 'sent_if_opted_in';
  }
  const paidCalls = Object.entries(counts).filter(([k]) => !/CacheHit$|Token$/.test(k) && k !== 'websiteFetch').reduce((a, [, n]) => a + (n || 0), 0);
  await WeeklyMonitor.updateOne(
    { businessId, weekKey },
    { $set: { status: 'done', lines: summary.lines, meaningful: summary.meaningful, notificationsCreated: summary.notifications.length, whatsappSent: whatsapp === 'sent_if_opted_in', whatsappSkipReason: whatsapp === 'sent_if_opted_in' ? undefined : whatsapp, inputs: summary.input, providerUsage: { counts, paidCalls } } },
  );
  return { status: 'done', weekKey, notifications: summary.notifications.length, whatsapp, paidCalls };
}

/**
 * Weekly content prompts (Sep 2026), each sent at most once:
 *  - "Anything to promote this week?" (in-app) when this week's WeeklyOffer is unanswered —
 *    once per week because this whole pass is idempotent per week;
 *  - festivals in the next 14 days from the stored calendar — one in-app +
 *    (opted-in) WhatsApp per business per festival (FestivalPrompt unique).
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
    const prefs = await ownerWhatsAppPrefs(businessId);
    let whatsapp: 'sent_if_opted_in' | 'no_phone' = 'no_phone';
    if (prefs?.phone) {
      await notifyOwner(businessId, { event: 'festival_prompt', text: `${f.name} is on ${when}. Would ${businessName} like to share a special offer or message on Google? Add it in your dashboard: ${appUrl()}/dashboard` });
      whatsapp = 'sent_if_opted_in';
    }
    await FestivalPrompt.updateOne({ businessId, festivalKey: f.key }, { $set: { inApp: true, whatsapp } });
    sent.push(f.key);
  }
  return { offerAsked: !answered, festivals: sent };
}

/** Weekly cron entry: every subscribed, Google-connected business. */
export async function runWeeklyMonitoringAll(now = new Date()): Promise<{ businesses: number; done: number; skipped: number; alreadyRan: number }> {
  await dbConnect();
  const Business = (await import('@/models/Business')).default;
  const list: any[] = await Business.find({ isDeleted: { $ne: true }, subscriptionStatus: 'active', googleConnected: true }).select('_id').lean();
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
