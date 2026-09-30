/**
 * Weekly monitoring summary — pure builder (runs under `node --test`).
 *
 * Inputs come from data GrowwMatics ALREADY holds (synced reviews, GBP
 * performance rows from the nightly sync, execution records, action states,
 * the latest audit's comparison). Weekly monitoring never runs a paid audit.
 *
 * No-spam rule: notifications are created only for something new or
 * actionable; the WhatsApp summary is sent only when the week is meaningful
 * or the owner asked for a regular weekly report.
 */

export interface WeeklyInput {
  weekKey: string;
  reviews: {
    /** Reviews posted on Google in the last 7 days (synced). */
    newCount: number;
    newAverageRating: number | null;
    /** Reviews from the last 30 days whose reply state was read and that have no reply. */
    unanswered: number;
    ratingNow: number | null;
    ratingWeekAgo: number | null;
    /** Whether a review sync actually ran in the last 7 days — otherwise counts are not reliable. */
    syncedThisWeek: boolean;
    /** Review requests sent through GrowwMatics in the last 7 days (null = no record source). */
    requestsSent: number | null;
  };
  activity: { postsPublished: number; photosPublished: number; profileEditsApplied: number; repliesPosted: number };
  /** Only when an audit re-measured comparable searches this week. */
  ranking: { improved: number; declined: number; comparable: number } | null;
  plan: { blocked: number; awaitingOwner: number; overdue: number };
  /** Last 7 complete days vs the 7 before, from synced GBP performance (null = unavailable). */
  performance: { calls: [number, number]; websiteClicks: [number, number]; directionRequests: [number, number] } | null;
}

export interface WeeklyNotification {
  type: string;
  title: string;
  body: string;
  link: string;
}

export interface WeeklySummary {
  lines: string[];
  notifications: WeeklyNotification[];
  meaningful: boolean;
  whatsappText: string;
}

const pl = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildWeeklySummary(i: WeeklyInput): WeeklySummary {
  const lines: string[] = [];
  const notifications: WeeklyNotification[] = [];
  let meaningful = false;

  // Reviews
  if (!i.reviews.syncedThisWeek) {
    lines.push('Reviews: not checked this week (review sync did not run).');
  } else if (i.reviews.newCount > 0) {
    meaningful = true;
    const avg = i.reviews.newAverageRating != null ? ` (average ${i.reviews.newAverageRating}★)` : '';
    lines.push(`New reviews: ${i.reviews.newCount}${avg}`);
    notifications.push({ type: 'weekly_new_reviews', title: 'New Google reviews', body: `${pl(i.reviews.newCount, 'new Google review')} ${i.reviews.newCount === 1 ? 'was' : 'were'} detected this week.`, link: '/dashboard/reviews' });
  } else {
    lines.push('New reviews: 0 — no new Google reviews were detected this week.');
    // Only claim the owner sent no requests when the record says so.
    if (i.reviews.requestsSent === 0) lines.push('No review requests were sent through GrowwMatics this week — fresh reviews are an important local visibility signal.');
    // In-app only (the week stays non-"meaningful", so no WhatsApp for it).
    notifications.push({ type: 'weekly_no_new_reviews', title: 'No new Google reviews this week', body: 'No new Google reviews were detected this week.', link: '/dashboard/review-requests' });
  }
  if (i.reviews.syncedThisWeek && i.reviews.unanswered > 0) {
    meaningful = true;
    lines.push(`Unanswered reviews: ${i.reviews.unanswered}`);
    notifications.push({ type: 'weekly_unanswered_reviews', title: 'Reviews waiting for a reply', body: `${pl(i.reviews.unanswered, 'Google review')} ${i.reviews.unanswered === 1 ? 'is' : 'are'} still waiting for a response.`, link: '/dashboard/reviews' });
  }
  if (i.reviews.ratingNow != null && i.reviews.ratingWeekAgo != null && i.reviews.ratingNow !== i.reviews.ratingWeekAgo) {
    meaningful = true;
    lines.push(`Google rating: ${i.reviews.ratingWeekAgo}★ → ${i.reviews.ratingNow}★`);
  }

  // GrowwMatics / owner activity (execution records only)
  const a = i.activity;
  const act = [
    a.postsPublished && pl(a.postsPublished, 'post published', 'posts published'),
    a.repliesPosted && pl(a.repliesPosted, 'review reply posted', 'review replies posted'),
    a.photosPublished && pl(a.photosPublished, 'photo published', 'photos published'),
    a.profileEditsApplied && pl(a.profileEditsApplied, 'profile update applied', 'profile updates applied'),
  ].filter(Boolean);
  if (act.length) lines.push(`Activity: ${act.join(', ')}`);

  // Performance (measured only)
  if (i.performance) {
    const p = i.performance;
    const row = (label: string, [prev, cur]: [number, number]) => `${label}: ${cur}${prev !== cur ? ` (previous week ${prev})` : ''}`;
    lines.push(row('GBP calls', p.calls), row('Website clicks', p.websiteClicks), row('Direction requests', p.directionRequests));
    if (p.calls[0] !== p.calls[1] || p.websiteClicks[0] !== p.websiteClicks[1] || p.directionRequests[0] !== p.directionRequests[1]) meaningful = true;
    if (p.calls[1] > p.calls[0] && p.calls[0] > 0) {
      notifications.push({ type: 'weekly_performance', title: 'Calls from Google', body: `Your Google Business Profile received ${p.calls[1]} calls this week, up from ${p.calls[0]}.`, link: '/dashboard/insights' });
    }
  } else {
    lines.push('Google performance: unavailable for this week.');
  }

  // Ranking (only comparable re-measurements — weekly never runs a paid ranking check)
  if (i.ranking && i.ranking.comparable > 0 && (i.ranking.improved || i.ranking.declined)) {
    meaningful = true;
    lines.push(`Ranking: visibility improved for ${i.ranking.improved}, declined for ${i.ranking.declined} of ${i.ranking.comparable} comparable searches`);
    if (i.ranking.improved > 0) notifications.push({ type: 'weekly_ranking', title: 'Ranking visibility', body: `Your visibility improved for ${pl(i.ranking.improved, 'tracked search', 'tracked searches')}.`, link: '/dashboard/audit' });
  }

  // Plan
  if (i.plan.awaitingOwner > 0) {
    meaningful = true;
    lines.push(`Action needed: ${pl(i.plan.awaitingOwner, 'optimization')} waiting for you`);
    notifications.push({ type: 'weekly_action_required', title: 'Action required', body: `${pl(i.plan.awaitingOwner, 'optimization')} need${i.plan.awaitingOwner === 1 ? 's' : ''} your confirmation or action before ${i.plan.awaitingOwner === 1 ? 'it' : 'they'} can be completed.`, link: '/dashboard/seo-plan' });
  }
  if (i.plan.blocked > 0) lines.push(`Blocked: ${pl(i.plan.blocked, 'action')} (see the plan for why)`);
  if (i.plan.overdue > 0) lines.push(`Overdue: ${pl(i.plan.overdue, 'planned action')} older than 30 days`);

  const whatsappText = ['GrowwMatics Weekly Update', '', ...lines.map((l) => `• ${l}`), '', 'Open GrowwMatics to review your recommendations.'].join('\n');
  return { lines, notifications, meaningful, whatsappText };
}

/** ISO week key, e.g. "2026-W40" — one monitoring run per business per week. */
export function isoWeekKey(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
