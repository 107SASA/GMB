/**
 * Plan tasks — the customer-facing view of OptimizationAction (pure — runs
 * under `node --test`). One table here tells the web dashboard, the Android
 * app and the iOS app which screen fixes which audit finding, so the three
 * never drift.
 *
 * Status shown to the customer:
 *   open             nothing done yet
 *   waiting_approval a Profile optimization change is drafted, not yet applied
 *   done             applied by GrowwMatics, seen fixed on Google, or marked
 *                    done by the owner — the next audit confirms it
 *   confirmed        a later audit re-measured the issue as gone (VERIFIED)
 *   reopened         was done/confirmed, but a later audit found it again
 *   blocked          a prerequisite is missing (Google not connected, writes off)
 */

export type TaskDisplayStatus = 'open' | 'waiting_approval' | 'done' | 'confirmed' | 'reopened' | 'blocked';

/** Who acts: the owner approves a GrowwMatics change, GrowwMatics does it on its own, or the owner does it. */
export type TaskActor = 'approve' | 'automatic' | 'owner';

export interface FixTarget {
  /** Stable key the apps switch on. 'instructions' = done outside GrowwMatics. */
  screen: 'profile-optimization' | 'google-profile' | 'photos' | 'posts' | 'reviews' | 'review-requests' | 'instructions';
  /** Section to open/scroll to on that screen. */
  section?: string;
  /** Web dashboard path. */
  web: string | null;
  /** Expo Router path (Android and iOS). */
  mobile: string | null;
  /** Button label. */
  label: string;
}

const PO = (section: string, label: string): FixTarget => ({
  screen: 'profile-optimization',
  section,
  web: `/dashboard/profile-optimization?section=${section}`,
  mobile: `/profile-optimization?section=${section}`,
  label,
});

const BY_CAPABILITY: Record<string, FixTarget> = {
  update_services: PO('services', 'Add services'),
  update_categories: PO('categories', 'Set categories'),
  update_hours: PO('hours', 'Set opening hours'),
  update_attributes: PO('attributes', 'Choose attributes'),
  update_booking_link: PO('links', 'Add booking link'),
  update_description: PO('description', 'Review description'),
  update_title: { screen: 'google-profile', section: 'details', web: '/dashboard/gbp-profile?section=details', mobile: '/gbp?section=details', label: 'Review business name' },
  update_phone: { screen: 'google-profile', section: 'details', web: '/dashboard/gbp-profile?section=details', mobile: '/gbp?section=details', label: 'Add phone number' },
  update_website: { screen: 'google-profile', section: 'details', web: '/dashboard/gbp-profile?section=details', mobile: '/gbp?section=details', label: 'Add website' },
  photo_uploads: { screen: 'photos', web: '/dashboard/gbp-profile?section=photos', mobile: '/photos', label: 'Upload photos' },
  google_posts: { screen: 'posts', web: '/dashboard/posts', mobile: '/posts', label: 'See posts' },
  review_replies: { screen: 'reviews', web: '/dashboard/reviews', mobile: '/reviews', label: 'See reviews' },
  review_requests: { screen: 'review-requests', web: '/dashboard/review-requests', mobile: '/reviews', label: 'Ask for reviews' },
};

// The apps have no Google-updates view: they show the steps instead.
const GOOGLE_UPDATES: FixTarget = {
  screen: 'google-profile', section: 'google-updates', web: '/dashboard/gbp-profile?section=google-updates', mobile: null, label: 'Review Google’s changes',
};

const INSTRUCTIONS: FixTarget = { screen: 'instructions', web: null, mobile: null, label: 'How to do this' };

/** The screen that fixes a finding. Findings without a GrowwMatics screen get instructions. */
export function fixTargetFor(findingId: string, capability: string | null): FixTarget {
  if (capability && BY_CAPABILITY[capability]) return BY_CAPABILITY[capability];
  if (findingId.startsWith('gbp.change.') || findingId === 'gbp.health.google_updates') return GOOGLE_UPDATES;
  return INSTRUCTIONS;
}

/** Profile optimization / Google profile changes the owner approves before GrowwMatics applies them. */
const APPROVE_CAPABILITIES = new Set([
  'update_services', 'update_categories', 'update_hours', 'update_attributes', 'update_booking_link',
  'update_description', 'update_title', 'update_phone', 'update_website',
]);
/** GrowwMatics carries these out on its own schedule (weekly posts, review replies). */
const AUTOMATIC_CAPABILITIES = new Set(['google_posts', 'review_replies']);

export function taskActor(capability: string | null): TaskActor {
  if (capability && APPROVE_CAPABILITIES.has(capability)) return 'approve';
  if (capability && AUTOMATIC_CAPABILITIES.has(capability)) return 'automatic';
  return 'owner';
}

/** Measurement only (rank tracking) — never a task for the customer. */
export function isCustomerTask(a: { capability: string | null; findingId: string }): boolean {
  return a.capability !== 'rank_tracking' && !a.findingId.startsWith('data_quality.');
}

/** GbpProfileChange kinds that carry out each capability (a pending one = waiting for approval). */
export const CHANGE_KINDS_OF: Record<string, string[]> = {
  update_services: ['services'],
  update_categories: ['categories', 'primary_category'],
  update_hours: ['hours'],
  update_attributes: ['attribute'],
  update_booking_link: ['attribute'],
  update_description: ['description'],
  update_title: ['title'],
  update_phone: ['phone'],
  update_website: ['website'],
};

/** Change statuses that mean "drafted, not on Google yet". */
export const PENDING_CHANGE_STATUSES = ['PROPOSED', 'APPROVED'] as const;

export interface TaskActionInput {
  findingId: string;
  capability: string | null;
  status: 'PLANNED' | 'READY' | 'EXECUTED' | 'VERIFIED' | 'BLOCKED';
  ownerMarkedDoneAt?: Date | string | null;
  seenFixedOnGoogleAt?: Date | string | null;
  reopenedAt?: Date | string | null;
}

export function taskDisplayStatus(a: TaskActionInput, pendingChangeKinds: Set<string>): TaskDisplayStatus {
  if (a.status === 'VERIFIED') return 'confirmed';
  if (a.status === 'EXECUTED' || a.seenFixedOnGoogleAt || a.ownerMarkedDoneAt) return 'done';
  if (a.reopenedAt) return 'reopened';
  if (a.status === 'BLOCKED') return 'blocked';
  const kinds = a.capability ? CHANGE_KINDS_OF[a.capability] : undefined;
  if (kinds?.some((k) => pendingChangeKinds.has(k))) return 'waiting_approval';
  return 'open';
}

/** Statuses that still need the customer (popup, checklist, reminders). */
export function isOpenStatus(s: TaskDisplayStatus): boolean {
  return s === 'open' || s === 'waiting_approval' || s === 'reopened';
}

/** "I've done this" — only for work done outside GrowwMatics; everything else is detected. */
export function canMarkDone(a: { findingId: string; capability: string | null }): boolean {
  return fixTargetFor(a.findingId, a.capability).screen === 'instructions';
}

// ── Seen fixed on Google ────────────────────────────────────────────────────

/** The GBP snapshot sections this check reads (GbpSnapshotCore, structurally). */
export interface SnapshotForCheck {
  sections: {
    location?: { meta?: { status?: string }; data?: {
      primaryCategory: unknown | null;
      description: string | null;
      primaryPhone: string | null;
      websiteUri: string | null;
      regularHours: unknown[] | null;
      services: unknown[];
      metadata: { hasGoogleUpdated: boolean };
    } | null };
    attributes?: { meta?: { status?: string }; data?: Array<{ name: string }> | null };
  };
}

/**
 * Whether the live Google profile shows the finding resolved — catches a
 * change the owner made directly in Google between audits. true = fixed,
 * false = still there, null = this finding can't be judged from the snapshot
 * (or that section failed to read). Never used to mark something confirmed:
 * only the next audit does that.
 */
export function seenFixedOnGoogle(findingId: string, capability: string | null, snap: SnapshotForCheck | null): boolean | null {
  if (!snap) return null;
  const loc = snap.sections.location?.meta?.status === 'SUCCESS' ? snap.sections.location.data ?? null : null;
  const attrs = snap.sections.attributes?.meta?.status === 'SUCCESS' ? snap.sections.attributes.data ?? null : null;
  if (findingId.startsWith('gbp.change.') || findingId === 'gbp.health.google_updates') {
    return loc ? !loc.metadata.hasGoogleUpdated : null;
  }
  switch (capability) {
    case 'update_services': return loc ? loc.services.length > 0 : null;
    case 'update_hours': return loc ? !!loc.regularHours?.length : null;
    case 'update_phone': return loc ? !!loc.primaryPhone : null;
    case 'update_website': return loc ? !!loc.websiteUri : null;
    // Only the "no primary category" finding uses update_categories.
    case 'update_categories': return loc ? !!loc.primaryCategory : null;
    case 'update_attributes': return attrs ? attrs.some((x) => !x.name.startsWith('attributes/url_')) : null;
    case 'update_booking_link': return attrs ? attrs.some((x) => x.name === 'attributes/url_appointment') : null;
    default: return null;
  }
}

// ── The task list sent to web, Android and iOS ──────────────────────────────

export interface TaskView {
  id: string;
  findingId: string;
  title: string;
  evidence: string;
  priority: 'high' | 'medium' | 'low';
  status: TaskDisplayStatus;
  /** Why it is in this state, in plain words. */
  statusReason: string;
  actor: TaskActor;
  /** What the owner does (approve / provide / do). */
  ownerAction: string;
  /** What GrowwMatics does, when it can. */
  growwmaticsAction: string | null;
  target: FixTarget;
  canMarkDone: boolean;
  doneAt: string | null;
  confirmedAt: string | null;
}

export interface TaskActionDoc extends TaskActionInput {
  _id: unknown;
  description: string;
  evidence?: string;
  priority?: 'high' | 'medium' | 'low';
  ownerAction?: string;
  growwmaticsAction?: string | null;
  statusReason?: string;
  executedAt?: Date | string | null;
  verifiedAt?: Date | string | null;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

const REASON: Record<TaskDisplayStatus, (a: TaskActionDoc) => string> = {
  open: (a) => (taskActor(a.capability) === 'approve' ? 'Ready for your approval in GrowwMatics' : taskActor(a.capability) === 'automatic' ? 'GrowwMatics is on it' : 'Waiting for you'),
  waiting_approval: () => 'Drafted — approve it to send it to Google',
  done: (a) => (a.ownerMarkedDoneAt ? 'Marked done by you — the next report confirms it'
    : a.seenFixedOnGoogleAt && a.status !== 'EXECUTED' ? 'Fixed on your Google profile — the next report confirms it'
    : 'Done — the next report confirms it'),
  confirmed: () => 'Confirmed fixed by the latest report',
  reopened: () => 'Found again in the latest report',
  blocked: (a) => a.statusReason || 'Blocked',
};

export function buildTaskView(a: TaskActionDoc, pendingChangeKinds: Set<string>): TaskView {
  const status = taskDisplayStatus(a, pendingChangeKinds);
  return {
    id: String(a._id),
    findingId: a.findingId,
    title: a.description,
    evidence: a.evidence || '',
    priority: a.priority || 'medium',
    status,
    statusReason: REASON[status](a),
    actor: taskActor(a.capability),
    ownerAction: a.ownerAction || '',
    growwmaticsAction: a.growwmaticsAction ?? null,
    target: fixTargetFor(a.findingId, a.capability),
    canMarkDone: isOpenStatus(status) && canMarkDone(a),
    doneAt: status === 'done' ? iso(a.executedAt) || iso(a.seenFixedOnGoogleAt) || iso(a.ownerMarkedDoneAt) : null,
    confirmedAt: status === 'confirmed' ? iso(a.verifiedAt) : null,
  };
}

const STATUS_ORDER: Record<TaskDisplayStatus, number> = { reopened: 0, open: 1, waiting_approval: 1, blocked: 2, done: 3, confirmed: 4 };
// Quickest wins first: one-tap approvals, then owner work, then what GrowwMatics runs itself.
const ACTOR_ORDER: Record<TaskActor, number> = { approve: 0, owner: 1, automatic: 2 };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function sortTasks(tasks: TaskView[]): TaskView[] {
  return [...tasks].sort((x, y) =>
    STATUS_ORDER[x.status] - STATUS_ORDER[y.status]
    || ACTOR_ORDER[x.actor] - ACTOR_ORDER[y.actor]
    || PRIORITY_ORDER[x.priority] - PRIORITY_ORDER[y.priority]);
}

export interface TaskSummary {
  total: number;
  /** done + confirmed */
  completed: number;
  open: number;
}

export function summarizeTasks(tasks: TaskView[]): TaskSummary {
  const completed = tasks.filter((t) => t.status === 'done' || t.status === 'confirmed').length;
  return { total: tasks.length, completed, open: tasks.filter((t) => isOpenStatus(t.status)).length };
}

/** The "fixes ready" popup: once per report, while something needs the owner. */
export function shouldShowTaskPopup(summary: TaskSummary, latestAuditId: string | null, dismissedAuditId: string | null | undefined): boolean {
  return !!latestAuditId && summary.open > 0 && dismissedAuditId !== latestAuditId;
}
