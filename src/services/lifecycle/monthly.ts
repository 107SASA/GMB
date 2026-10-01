/**
 * Monthly optimization report — pure builders (no I/O; runs under `node --test`).
 *
 * Everything here is computed from two stored audits (previous comparable and
 * current) plus EXECUTION RECORDS read from the database (posts, review
 * replies, profile edits, photos, review requests). Rules:
 *  • a change is reported only with a previous value, a current value, a
 *    source and an actor — actor 'GrowwMatics' only with an execution record;
 *  • performance is compared only when both periods were measured;
 *  • rankings are compared only on identical searches (compareAudits);
 *  • nothing missing is replaced by 0, 21, an estimate or a projection.
 */

export type Actor = 'GrowwMatics' | 'Owner' | 'Unknown';

export interface GbpSnapshot {
  title?: string;
  description?: string;
  primaryPhone?: string;
  website?: string;
  primaryCategory?: string;
  additionalCategories?: string[];
}

export interface ExecutionRecords {
  /** ProfileActivity 'profile_updated' rows in the period. */
  profileEdits: Array<{ at: string; fields: string[]; values?: Record<string, string>; liveWriteApplied: boolean | null; actor: 'owner' | 'growwmatics'; by?: string }>;
  /** GbpMediaAsset rows published through GrowwMatics in the period. */
  photos: Array<{ at: string }>;
  /** Posts published through GrowwMatics in the period. */
  posts: Array<{ at: string; autopilot: boolean; title?: string }>;
  /** Review replies posted in the period (who posted them). */
  replies: Array<{ at: string | null; by: 'growwmatics_auto' | 'growwmatics_owner_approved' | 'external' }>;
  /** WhatsApp review requests sent through GrowwMatics in the period. */
  reviewRequests: { sent: number; failed: number; sentAt?: string[] };
  /** Reviews posted on Google in the period (synced). */
  newReviews: Array<{ at: string; rating: number; replied: boolean | null }>;
  /** Weekly content-engine posts due in the period (Sep 2026; absent on older records). */
  content?: ContentActivity;
}

/**
 * What the weekly content engine did in the period — from Post records only.
 * "published" = Google confirmed it (liveWriteApplied); "blocked" = scheduled in
 * GrowwMatics but live Google writes were off, so it never reached Google.
 */
export interface ContentActivity {
  planned: number;
  published: number;
  blocked: number;
  failed: number;
  drafts: number;
  stillScheduled: number;
  /** Published posts by purpose (seo_theme, service, local, festival, offer, education). */
  publishedByPurpose: Record<string, number>;
  servicesCovered: string[];
  themesCovered: string[];
  keywords: Array<{ keyword: string; measured: boolean }>;
  /**
   * Every keyword targeted by a post due this period (any status), how many
   * posts targeted it, and where the keyword came from. Rank before/after is
   * added by buildMonthlyReport from the two audits' measured keyword tables.
   */
  keywordsTargeted?: Array<{
    keyword: string;
    source: 'measured' | 'search_term' | 'proposed' | 'other';
    posts: number;
    published: number;
    rankBefore?: string | null;
    rankAfter?: string | null;
    comparable?: boolean;
  }>;
  customerPhotosUsed: number;
  /**
   * Images on published posts by origin (contentMeta.imageOrigin). Posts from
   * before origin was recorded are counted from their imageSource only when it
   * is unambiguous (generate → AI, branded_graphic → fallback).
   */
  images?: { aiGenerated: number; ownerSelected: number; fallback: number };
  /** Posts that carry an SEO plan id (planned from the plan) vs how many of those reached Google. */
  seoPlanPosts: { planned: number; published: number };
}

export interface Change {
  what: string;
  previous: string;
  current: string;
  at: string | null;
  source: string;
  actor: Actor;
  evidence: string;
}

const FIELD_LABEL: Record<keyof GbpSnapshot, string> = {
  title: 'Business name',
  description: 'Description',
  primaryPhone: 'Phone',
  website: 'Website',
  primaryCategory: 'Primary category',
  additionalCategories: 'Additional categories',
};

const show = (v: unknown) => {
  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return '(empty)';
  const s = Array.isArray(v) ? v.join(', ') : String(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) ||
  (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]));

/**
 * Verified GBP field changes between two live reads. The actor is GrowwMatics
 * or Owner ONLY when a profile-edit record for that field (with the live write
 * actually applied) exists in the period; otherwise Unknown — changed on
 * Google directly, by someone.
 */
export function diffGbpSnapshots(prev: GbpSnapshot | null | undefined, cur: GbpSnapshot | null | undefined, edits: ExecutionRecords['profileEdits'], curReadAt: string | null): Change[] {
  if (!prev || !cur) return [];
  const out: Change[] = [];
  for (const key of Object.keys(FIELD_LABEL) as Array<keyof GbpSnapshot>) {
    const a = prev[key];
    const b = cur[key];
    if (same(a, b)) continue;
    const edit = [...edits].reverse().find((e) => e.fields.includes(key) && e.liveWriteApplied === true);
    out.push({
      what: FIELD_LABEL[key],
      previous: show(a),
      current: show(b),
      at: edit?.at ?? curReadAt,
      source: 'Google Business Profile (live read in both audits)',
      actor: edit ? (edit.actor === 'growwmatics' ? 'GrowwMatics' : 'Owner') : 'Unknown',
      evidence: edit ? `Profile edit record${edit.by ? ` by ${edit.by}` : ''} via GrowwMatics` : 'No GrowwMatics record — changed directly on Google',
    });
  }
  return out;
}

export interface PerformanceWindow {
  status: string;
  periodStart?: string;
  periodEnd?: string;
  calls?: number;
  websiteClicks?: number;
  directionRequests?: number;
  profileViews?: number;
}

export interface MetricRow {
  metric: string;
  previous: number | null;
  current: number | null;
  change: number | null;
  pctChange: number | null;
  /** Why it is not compared, when it is not. */
  note?: string;
}

const pct = (a: number | null, b: number | null) => (a != null && b != null && a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : null);

/** Google performance: previous vs current window — only measured periods. */
export function comparePerformance(prev: PerformanceWindow | null | undefined, cur: PerformanceWindow | null | undefined): { status: 'compared' | 'current_only' | 'unavailable'; rows: MetricRow[]; previousPeriod?: string; currentPeriod?: string } {
  const ok = (w?: PerformanceWindow | null) => w?.status === 'verified';
  if (!ok(cur)) return { status: 'unavailable', rows: [] };
  const both = ok(prev);
  const rows: MetricRow[] = ([['Calls', 'calls'], ['Website clicks', 'websiteClicks'], ['Direction requests', 'directionRequests'], ['Profile views', 'profileViews']] as const).map(([metric, k]) => {
    const p = both ? (prev as any)[k] ?? null : null;
    const c = (cur as any)[k] ?? null;
    return { metric, previous: p, current: c, change: p != null && c != null ? c - p : null, pctChange: pct(p, c), ...(both ? {} : { note: 'No previous measured period' }) };
  });
  return {
    status: both ? 'compared' : 'current_only',
    rows,
    ...(both ? { previousPeriod: `${prev!.periodStart} to ${prev!.periodEnd}` } : {}),
    currentPeriod: `${cur!.periodStart} to ${cur!.periodEnd}`,
  };
}

export interface ReviewActivity {
  newReviews: number;
  averageNewRating: number | null;
  lifetimeBefore: number | null;
  lifetimeAfter: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  repliedByGrowwMatics: number;
  repliedByOwnerViaGrowwMatics: number;
  repliedOnGoogleDirectly: number;
  unanswered: number;
  replyUnknown: number;
  reviewRequestsSent: number;
}

export function reviewActivity(prevData: any, curData: any, ex: ExecutionRecords): ReviewActivity {
  const lt0 = prevData?.facts?.reviews?.lifetime;
  const lt1 = curData?.facts?.reviews?.lifetime;
  const ratings = ex.newReviews.map((r) => r.rating).filter((r) => typeof r === 'number' && r > 0);
  return {
    newReviews: ex.newReviews.length,
    averageNewRating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    lifetimeBefore: lt0?.status === 'verified' ? lt0.totalCount : null,
    lifetimeAfter: lt1?.status === 'verified' ? lt1.totalCount : null,
    ratingBefore: lt0?.status === 'verified' ? lt0.rating : null,
    ratingAfter: lt1?.status === 'verified' ? lt1.rating : null,
    repliedByGrowwMatics: ex.replies.filter((r) => r.by === 'growwmatics_auto').length,
    repliedByOwnerViaGrowwMatics: ex.replies.filter((r) => r.by === 'growwmatics_owner_approved').length,
    repliedOnGoogleDirectly: ex.replies.filter((r) => r.by === 'external').length,
    unanswered: ex.newReviews.filter((r) => r.replied === false).length,
    replyUnknown: ex.newReviews.filter((r) => r.replied === null).length,
    reviewRequestsSent: ex.reviewRequests.sent,
  };
}

export interface PlanActionView {
  findingId: string;
  action: string;
  status: string;
  executor: string;
  statusReason?: string;
}

export interface MonthlyReport {
  period: { start: string; end: string };
  previousAuditId: string | null;
  baselineAuditId: string | null;
  changes: Change[];
  growwmaticsOptimized: Array<{ what: string; count: number; evidence: string }>;
  ownerOptimized: Array<{ what: string; count: number; evidence: string }>;
  performance: ReturnType<typeof comparePerformance>;
  ranking: Array<{ metric: string; before: string; after: string; change: string; note?: string }>;
  reviews: ReviewActivity;
  /** Weekly content execution (null when no content-engine posts were due this period). */
  contentActivity: ContentActivity | null;
  profileHealth: { completionPercentage: number | null; scope: string | null; missing: string[]; unknown: number };
  planCompleted: PlanActionView[];
  planPending: PlanActionView[];
  remainingIssues: string[];
  /** Deterministic "improved / declined" lines — the only change statements the AI may build on. */
  improved: string[];
  declined: string[];
}

export function buildMonthlyReport(input: {
  periodStart: string;
  periodEnd: string;
  previousAuditId: string | null;
  baselineAuditId: string | null;
  prevData: any;
  curData: any;
  executions: ExecutionRecords;
  actions: PlanActionView[];
}): MonthlyReport {
  const { prevData, curData, executions: ex } = input;
  const curRead = curData?.facts?.gbpProfile?.readAt ?? null;
  const changes: Change[] = diffGbpSnapshots(prevData?.facts?.gbpProfile?.fields, curData?.facts?.gbpProfile?.fields, ex.profileEdits, curRead);

  const autoPosts = ex.posts.filter((p) => p.autopilot).length;
  const ownerPosts = ex.posts.length - autoPosts;
  const autoReplies = ex.replies.filter((r) => r.by === 'growwmatics_auto').length;
  const approvedReplies = ex.replies.filter((r) => r.by === 'growwmatics_owner_approved').length;
  const ownerEdits = ex.profileEdits.filter((e) => e.actor === 'owner' && e.liveWriteApplied === true);
  const gmEdits = ex.profileEdits.filter((e) => e.actor === 'growwmatics' && e.liveWriteApplied === true);

  const growwmaticsOptimized = [
    { what: 'Google posts published automatically', count: autoPosts, evidence: 'Post records published by the content autopilot' },
    { what: 'Review replies posted automatically', count: autoReplies, evidence: 'Reply records posted by auto-reply' },
    { what: 'Review requests sent', count: ex.reviewRequests.sent, evidence: 'WhatsApp review-request records' },
    { what: 'Profile fields updated automatically', count: gmEdits.length, evidence: 'Profile edit records (live write applied)' },
  ].filter((x) => x.count > 0);
  const ownerOptimized = [
    { what: 'Google posts you scheduled through GrowwMatics', count: ownerPosts, evidence: 'Post records' },
    { what: 'Review replies you approved (posted by GrowwMatics)', count: approvedReplies, evidence: 'Reply records' },
    { what: 'Profile edits you made in GrowwMatics', count: ownerEdits.length, evidence: 'Profile edit records (live write applied)' },
    { what: 'Photos you published through GrowwMatics', count: ex.photos.length, evidence: 'Media records' },
  ].filter((x) => x.count > 0);

  const reviews = reviewActivity(prevData, curData, ex);
  if (reviews.newReviews > 0) {
    changes.push({ what: 'New Google reviews', previous: reviews.lifetimeBefore != null ? String(reviews.lifetimeBefore) : 'unknown', current: reviews.lifetimeAfter != null ? String(reviews.lifetimeAfter) : 'unknown', at: null, source: 'Review sync', actor: 'Unknown', evidence: `${reviews.newReviews} review(s) posted on Google this period` });
  }

  const cmpRows: any[] = curData?.comparison?.rows || [];
  const ranking = cmpRows
    .filter((r) => /search|position/i.test(r.metric))
    .map((r) => ({ metric: r.metric, before: r.before, after: r.after, change: r.change === 'not_comparable' ? 'Not directly comparable' : r.change, note: r.note }));

  const pc = curData?.profileCompletion;
  const checklist: any[] = pc?.checklist || [];
  const profileHealth = {
    completionPercentage: checklist.some((c) => c.status !== 'Unknown') ? pc?.completionPercentage ?? null : null,
    scope: pc?.completionScope ?? null,
    missing: checklist.filter((c) => c.status === 'Missing').map((c) => c.field),
    unknown: checklist.filter((c) => c.status === 'Unknown').length,
  };

  const performance = comparePerformance(prevData?.performanceBaseline, curData?.performanceBaseline);
  const improved: string[] = [];
  const declined: string[] = [];
  for (const r of performance.status === 'compared' ? performance.rows : []) {
    if (r.change == null || r.change === 0) continue;
    const line = `${r.metric}: ${r.previous} → ${r.current}${r.pctChange != null ? ` (${r.pctChange > 0 ? '+' : ''}${r.pctChange}%)` : ''}`;
    (r.change > 0 ? improved : declined).push(line);
  }
  for (const r of cmpRows.filter((x) => x.change === 'better' || x.change === 'worse')) {
    (r.change === 'better' ? improved : declined).push(`${r.metric}: ${r.before} → ${r.after}`);
  }

  return {
    period: { start: input.periodStart, end: input.periodEnd },
    previousAuditId: input.previousAuditId,
    baselineAuditId: input.baselineAuditId,
    changes,
    growwmaticsOptimized,
    ownerOptimized,
    performance,
    ranking,
    reviews,
    contentActivity: ex.content && ex.content.planned > 0 ? withKeywordRanks(ex.content, prevData, curData) : null,
    profileHealth,
    planCompleted: input.actions.filter((a) => a.status === 'VERIFIED' || a.status === 'EXECUTED'),
    planPending: input.actions.filter((a) => a.status === 'PLANNED' || a.status === 'READY' || a.status === 'BLOCKED'),
    remainingIssues: (curData?.findings || []).filter((f: any) => f.category !== 'data_quality' && !f.verificationOnly).map((f: any) => String(f.title)),
    improved,
    declined,
  };
}

/**
 * Monthly WhatsApp summary — every value comes from the MonthlyReport (itself
 * built from measured data). Missing data says so; no revenue, no projection.
 */
export function composeMonthlyWhatsApp(m: MonthlyReport | null | undefined, businessName: string, link: string): string {
  const lines = [`Your GrowwMatics monthly report for ${businessName} is ready.`, ''];
  if (!m) return [...lines, `Open the full report: ${link}`].join('\n');
  const r = m.reviews;
  lines.push(`• New Google reviews: ${r.newReviews}${r.ratingAfter != null ? ` (rating ${r.ratingAfter}★)` : ''}`);
  if (m.performance.status === 'compared') {
    for (const row of m.performance.rows.filter((x) => x.metric !== 'Profile views')) {
      lines.push(`• ${row.metric}: ${row.previous} → ${row.current}${row.pctChange != null ? ` (${row.pctChange > 0 ? '+' : ''}${row.pctChange}%)` : ''}`);
    }
  } else if (m.performance.status === 'current_only') {
    const calls = m.performance.rows.find((x) => x.metric === 'Calls');
    if (calls?.current != null) lines.push(`• Calls from Google this period: ${calls.current} (first measured period — no comparison yet)`);
  } else {
    lines.push('• Google performance data: unavailable for this period');
  }
  const gm = m.growwmaticsOptimized.map((x) => `${x.count} ${x.what.toLowerCase()}`);
  if (gm.length) lines.push(`• GrowwMatics this month: ${gm.join(', ')}`);
  lines.push(`• Plan: ${m.planCompleted.length} done, ${m.planPending.length} pending`);
  const rank = m.ranking.filter((x) => x.change !== 'Not directly comparable');
  if (rank.length) lines.push(`• Rankings: ${rank.map((x) => `${x.metric} ${x.before} → ${x.after}`).join('; ')}`);
  else if (m.ranking.length) lines.push('• Rankings: searches changed since last month — not directly comparable');
  return [...lines, '', `Open the full report: ${link}`].join('\n');
}

const PURPOSE_LABEL: Record<string, string> = {
  seo_theme: 'SEO-plan theme', service: 'service', local: 'local', festival: 'festival greeting', offer: 'your offer', education: 'educational',
};

/** Content-activity lines for the monthly report (dashboard + PDF share this). Counts only — no engagement or revenue claims. */
export function contentActivityLines(c: ContentActivity | null | undefined): string[] {
  if (!c || !c.planned) return [];
  const lines = [`Weekly posts planned: ${c.planned} · published to Google: ${c.published}`];
  if (c.blocked) lines.push(`Not sent to Google (live publishing was off): ${c.blocked}`);
  if (c.failed) lines.push(`Google rejected: ${c.failed}`);
  if (c.drafts) lines.push(`Saved as draft for your review (did not pass the fact check): ${c.drafts}`);
  if (c.stillScheduled) lines.push(`Still scheduled: ${c.stillScheduled}`);
  const byPurpose = Object.entries(c.publishedByPurpose).map(([k, n]) => `${n} ${PURPOSE_LABEL[k] ?? k}`);
  if (byPurpose.length) lines.push(`Published posts by type: ${byPurpose.join(', ')}`);
  if (c.servicesCovered.length) lines.push(`Services featured: ${c.servicesCovered.join(', ')}`);
  if (c.themesCovered.length) lines.push(`SEO-plan themes covered: ${c.themesCovered.join('; ')}`);
  if (c.seoPlanPosts.planned) lines.push(`SEO-plan posts: ${c.seoPlanPosts.published} of ${c.seoPlanPosts.planned} reached Google`);
  if (c.keywordsTargeted?.length) {
    const label = (k: NonNullable<ContentActivity['keywordsTargeted']>[number]) => {
      const src = k.source === 'search_term' ? ' (customer search on Google)' : k.source === 'proposed' ? ' (proposed, not measured)' : '';
      const rank = k.comparable ? `, rank ${k.rankBefore} → ${k.rankAfter}` : k.source === 'measured' ? ', rank change not comparable' : '';
      return `${k.keyword}${src} — ${k.posts} post${k.posts === 1 ? '' : 's'}${rank}`;
    };
    lines.push(`Keywords targeted: ${c.keywordsTargeted.map(label).join('; ')}`);
  } else if (c.keywords.length) {
    lines.push(`Keywords used: ${c.keywords.map((k) => `${k.keyword}${k.measured ? '' : ' (proposed, not measured)'}`).join(', ')}`);
  }
  if (c.images && (c.images.aiGenerated || c.images.ownerSelected || c.images.fallback)) {
    const parts = [
      c.images.aiGenerated && `${c.images.aiGenerated} new AI-generated`,
      c.images.ownerSelected && `${c.images.ownerSelected} photo${c.images.ownerSelected === 1 ? '' : 's'} you chose`,
      c.images.fallback && `${c.images.fallback} branded graphic${c.images.fallback === 1 ? '' : 's'} (AI image unavailable)`,
    ].filter(Boolean);
    lines.push(`Post images: ${parts.join(', ')}`);
  }
  if (c.customerPhotosUsed) lines.push(`Your photos used in published posts: ${c.customerPhotosUsed}`);
  return lines;
}

/** Summarise content-engine Post rows (pure; exported for tests). */
export function summarizeContent(rows: Array<{ status: string; liveWriteApplied?: boolean; contentMeta?: any }>): ContentActivity {
  const pub = rows.filter((p) => p.status === 'published' && p.liveWriteApplied === true);
  const byPurpose: Record<string, number> = {};
  for (const p of pub) { const k = p.contentMeta?.purpose || 'other'; byPurpose[k] = (byPurpose[k] || 0) + 1; }
  const uniq = (xs: Array<string | undefined>) => Array.from(new Set(xs.filter((x): x is string => !!x)));
  const kw = new Map<string, boolean>();
  for (const p of pub) if (p.contentMeta?.keyword) kw.set(p.contentMeta.keyword, !!p.contentMeta.keywordMeasured);
  const withPlan = rows.filter((p) => !!p.contentMeta?.seoPlanId);
  const targeted = new Map<string, { keyword: string; source: 'measured' | 'search_term' | 'proposed' | 'other'; posts: number; published: number }>();
  for (const p of rows) {
    const k = p.contentMeta?.keyword;
    if (!k) continue;
    const key = String(k).toLowerCase().trim();
    const src = p.contentMeta?.keywordSource;
    const e = targeted.get(key) ?? {
      keyword: k,
      source: src === 'measured' || src === 'search_term' || src === 'proposed' ? src : (p.contentMeta?.keywordMeasured ? 'measured' : 'other'),
      posts: 0,
      published: 0,
    };
    e.posts++;
    if (p.status === 'published' && p.liveWriteApplied === true) e.published++;
    targeted.set(key, e);
  }
  return {
    planned: rows.length,
    published: pub.length,
    blocked: rows.filter((p) => p.status === 'blocked').length,
    failed: rows.filter((p) => p.status === 'failed').length,
    drafts: rows.filter((p) => p.status === 'draft').length,
    stillScheduled: rows.filter((p) => p.status === 'scheduled' || p.status === 'approved' || p.status === 'publishing').length,
    publishedByPurpose: byPurpose,
    servicesCovered: uniq(pub.map((p) => p.contentMeta?.service)),
    themesCovered: uniq(pub.map((p) => p.contentMeta?.seoTheme)),
    keywords: Array.from(kw.entries()).map(([keyword, measured]) => ({ keyword, measured })),
    keywordsTargeted: Array.from(targeted.values()),
    // Legacy: photos picked automatically before Oct 2026 (no imageOrigin recorded).
    customerPhotosUsed: pub.filter((p) => !p.contentMeta?.imageOrigin && p.contentMeta?.imageSource === 'customer_photo').length,
    images: {
      aiGenerated: pub.filter((p) => (p.contentMeta?.imageOrigin ?? (p.contentMeta?.imageSource === 'generate' ? 'AI_GENERATED' : null)) === 'AI_GENERATED').length,
      ownerSelected: pub.filter((p) => p.contentMeta?.imageOrigin === 'OWNER_SELECTED').length,
      fallback: pub.filter((p) => (p.contentMeta?.imageOrigin ?? (p.contentMeta?.imageSource === 'branded_graphic' ? 'FALLBACK' : null)) === 'FALLBACK').length,
    },
    seoPlanPosts: { planned: withPlan.length, published: withPlan.filter((p) => p.status === 'published' && p.liveWriteApplied === true).length },
  };
}

/** "#8" / "not in top 20" from a measured keyword-table row, or null when the check didn't run. */
function measuredRankText(row: any): string | null {
  if (!row || (row.rankStatus ?? 'ok') !== 'ok') return null;
  const r = row.rank ?? row.mapsRank;
  if (row.found === false) return 'not in top 20';
  return typeof r === 'number' && r >= 1 && r <= 20 ? `#${Math.round(r * 10) / 10}` : null;
}

/**
 * Adds the measured rank before/after to each targeted keyword — only from
 * the two audits' keyword tables, only when both measured it. No rank is
 * inferred, and a change is shown as an observation, not as caused by posts.
 */
export function withKeywordRanks(content: ContentActivity, prevData: any, curData: any): ContentActivity {
  if (!content.keywordsTargeted?.length) return content;
  const table = (d: any) => new Map<string, any>(((d?.keywordTable as any[]) || []).map((r) => [String(r.keyword).toLowerCase().trim(), r]));
  const prev = table(prevData);
  const cur = table(curData);
  return {
    ...content,
    keywordsTargeted: content.keywordsTargeted.map((k) => {
      const key = k.keyword.toLowerCase().trim();
      const before = measuredRankText(prev.get(key));
      const after = measuredRankText(cur.get(key));
      return { ...k, rankBefore: before, rankAfter: after, comparable: before != null && after != null };
    }),
  };
}
