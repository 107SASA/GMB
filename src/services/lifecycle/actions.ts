/**
 * Optimization-action lifecycle — pure status rules (runs under `node --test`).
 *
 *   PLANNED → READY → EXECUTED → VERIFIED        PLANNED → BLOCKED
 *
 *  • READY     prerequisites met (Google connected where needed, live writes on).
 *  • EXECUTED  an EXECUTION RECORD exists after the action was planned
 *              (a post published, a reply posted, a review request sent, a
 *              profile edit whose live write was applied). A successful API
 *              call alone is not "completed".
 *  • VERIFIED  a LATER audit re-measured the problem and it is gone.
 *  • BLOCKED   a prerequisite is missing (reason stored).
 * Owner-only actions have no GrowwMatics execution record: they stay PLANNED
 * until an audit shows the problem resolved (then VERIFIED, actor unknown).
 */

export type ActionStatus = 'PLANNED' | 'READY' | 'EXECUTED' | 'VERIFIED' | 'BLOCKED';

export interface ActionInput {
  findingId: string;
  capability: string | null;
  requiresGbpConnection: boolean;
  plannedAt: string;
  /** Profile field(s) an update_* capability changes. */
  fields?: string[];
}

export interface ExecutionsSince {
  posts: number;
  repliesByGrowwMatics: number;
  reviewRequestsSent: number;
  photos: number;
  /** Profile edits with the live Google write applied, by field. */
  appliedEdits: Array<{ at: string; fields: string[] }>;
}

export interface ActionStatusResult {
  status: ActionStatus;
  statusReason: string;
  executedAt?: string;
  executionResult?: string;
  verifiedAt?: string;
  verificationResult?: string;
}

const FIELD_OF: Record<string, string> = {
  update_title: 'title',
  update_description: 'description',
  update_phone: 'primaryPhone',
  update_website: 'website',
};

export function deriveActionStatus(
  a: ActionInput,
  ctx: {
    gbpConnected: boolean;
    liveWritesEnabled: boolean;
    executions: ExecutionsSince;
    /** From the most recent audit AFTER plannedAt: true = still found, false = gone, null = not re-measured yet. */
    findingStillPresent: boolean | null;
    remeasuredAt: string | null;
  },
): ActionStatusResult {
  const resolved = ctx.findingStillPresent === false;
  const verified = (result: string): ActionStatusResult => ({
    status: 'VERIFIED', statusReason: 'Re-measured in a later audit', verifiedAt: ctx.remeasuredAt ?? undefined, verificationResult: result,
  });

  // Owner action — GrowwMatics never claims it.
  if (!a.capability) {
    return resolved
      ? verified('The issue no longer appears in the latest audit (change made outside GrowwMatics)')
      : { status: 'PLANNED', statusReason: 'Owner action — waiting for you' };
  }
  if (a.requiresGbpConnection && !ctx.gbpConnected) {
    return { status: 'BLOCKED', statusReason: 'Google Business Profile is not connected' };
  }

  let executed: { at?: string; result: string } | null = null;
  const e = ctx.executions;
  switch (a.capability) {
    case 'update_title':
    case 'update_description':
    case 'update_phone':
    case 'update_website': {
      if (!ctx.liveWritesEnabled) return { status: 'BLOCKED', statusReason: 'Live Google profile writes are turned off' };
      const field = FIELD_OF[a.capability];
      const edit = [...e.appliedEdits].reverse().find((x) => x.fields.includes(field));
      if (edit) executed = { at: edit.at, result: `${field} update sent to Google and accepted` };
      break;
    }
    case 'google_posts':
      if (e.posts > 0) executed = { result: `${e.posts} Google post(s) published` };
      break;
    case 'review_replies':
      if (e.repliesByGrowwMatics > 0) executed = { result: `${e.repliesByGrowwMatics} review reply(ies) posted` };
      break;
    case 'review_requests':
      if (e.reviewRequestsSent > 0) executed = { result: `${e.reviewRequestsSent} review request(s) sent` };
      break;
    case 'photo_uploads':
      if (e.photos > 0) executed = { result: `${e.photos} photo(s) published` };
      break;
    default:
      break;
  }

  if (!executed) {
    return resolved ? verified('The issue no longer appears in the latest audit') : { status: 'READY', statusReason: 'Ready — waiting to be carried out' };
  }
  const base = { executedAt: executed.at, executionResult: executed.result };
  if (resolved) {
    return { ...verified(a.capability.startsWith('update_') ? 'Google profile re-read: the field now matches' : 'The issue no longer appears in the latest audit'), ...base };
  }
  return { status: 'EXECUTED', statusReason: ctx.findingStillPresent === true ? 'Done — the issue is still measured; re-checked next audit' : 'Done — awaiting re-measurement', ...base };
}
