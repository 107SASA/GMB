/**
 * Open-proposal key planning, shared by scripts/migrate-open-proposal-keys.ts
 * (which applies the plan) and scripts/fr5-open-proposal-diagnostic.ts (which
 * only explains it). The planner is pure; the reader below takes a collection
 * typed to find / aggregate / indexes only, so it cannot write.
 *
 * Rules (unchanged from the migration):
 *   - Candidates are PROPOSED / APPROVED records without a string openKey.
 *   - A record that already has a string openKey (written by the app) holds
 *     that key; candidates with the same key are left unchanged.
 *   - Otherwise, within each group of identical candidates (same business,
 *     kind, current value and proposed value) the newest (createdAt, then
 *     _id) is keyed and the rest are left unchanged.
 *   - Nothing is ever deleted or rewritten; "left unchanged" means exactly that.
 */
import { OPEN_KEY_STATUSES, canonicalFingerprint, openProposalKey } from '../src/services/gbp/changes/policy.ts';

export const BACKFILL_STATUSES = ['PROPOSED', 'APPROVED'];

export interface PlanRecord {
  id: string;
  businessId: string;
  kind: string;
  status: string;
  createdAt: string | null;
  beforeFingerprint?: string | null;
  proposed?: unknown;
  openKey?: string | null;
  source?: string | null;
}

export type PlanDecision =
  | { id: string; action: 'key'; key: string }
  | { id: string; action: 'duplicate'; key: string; of: string; reason: string }
  | { id: string; action: 'held'; key: string; of: string; reason: string };

export interface PlanGroup {
  businessId: string;
  kind: string;
  keyPrefix: string;
  members: Array<{ id: string; status: string; createdAt: string | null; source: string | null; keyed: boolean; outcome: string }>;
}

export function recordKey(r: PlanRecord): string {
  return openProposalKey(r.kind, String(r.beforeFingerprint ?? canonicalFingerprint(r.kind, null)), r.proposed);
}

/** Newest first: createdAt descending, then _id (24-hex, so string order is ObjectId order) descending. */
function newestFirst(a: PlanRecord, b: PlanRecord): number {
  const ta = a.createdAt ? Date.parse(a.createdAt) : Number.NEGATIVE_INFINITY;
  const tb = b.createdAt ? Date.parse(b.createdAt) : Number.NEGATIVE_INFINITY;
  if (ta !== tb) return tb - ta;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function planOpenProposalKeys(candidates: PlanRecord[], keyed: PlanRecord[]): { decisions: PlanDecision[]; groups: PlanGroup[] } {
  const holders = new Map<string, PlanRecord>();
  for (const h of keyed) if (typeof h.openKey === 'string') holders.set(`${h.businessId}|${h.openKey}`, h);

  const decisions: PlanDecision[] = [];
  const keeper = new Map<string, string>();
  const members = new Map<string, PlanGroup['members']>();
  const meta = new Map<string, { businessId: string; kind: string; keyPrefix: string }>();
  const addMember = (scope: string, r: PlanRecord, keyedNow: boolean, outcome: string) => {
    if (!members.has(scope)) members.set(scope, []);
    members.get(scope)!.push({ id: r.id, status: r.status, createdAt: r.createdAt, source: r.source ?? null, keyed: keyedNow, outcome });
  };

  for (const r of [...candidates].filter((c) => BACKFILL_STATUSES.includes(c.status) && typeof c.openKey !== 'string').sort(newestFirst)) {
    const key = recordKey(r);
    const scope = `${r.businessId}|${key}`;
    meta.set(scope, { businessId: r.businessId, kind: r.kind, keyPrefix: key.slice(0, 12) });
    const holder = holders.get(scope);
    if (holder && !members.has(scope)) addMember(scope, holder, true, 'already holds the key (set by the app); unchanged');
    if (keeper.has(scope)) {
      decisions.push({ id: r.id, action: 'duplicate', key, of: keeper.get(scope)!, reason: 'an identical, newer open proposal in this group gets the key' });
      addMember(scope, r, false, `left unchanged: duplicate of ${keeper.get(scope)}`);
      continue;
    }
    if (holder) {
      keeper.set(scope, holder.id);
      decisions.push({ id: r.id, action: 'held', key, of: holder.id, reason: `record ${holder.id} (${holder.status}) already holds this key` });
      addMember(scope, r, false, `left unchanged: key held by ${holder.id}`);
      continue;
    }
    keeper.set(scope, r.id);
    decisions.push({ id: r.id, action: 'key', key });
    addMember(scope, r, false, 'would be keyed (newest in group)');
  }

  const groups: PlanGroup[] = [...members.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([scope, list]) => ({ ...meta.get(scope)!, members: list }));
  return { decisions, groups };
}

/** The only collection methods the reader may use. */
export type ReadOnlyCollection = Pick<import('mongodb').Collection, 'find' | 'aggregate' | 'indexes'>;

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
function toPlanRecord(d: Record<string, any>): PlanRecord {
  return {
    id: String(d._id),
    businessId: String(d.businessId),
    kind: String(d.kind),
    status: String(d.status),
    createdAt: iso(d.createdAt),
    beforeFingerprint: d.beforeFingerprint ?? null,
    proposed: d.proposed,
    openKey: typeof d.openKey === 'string' ? d.openKey : null,
    source: d.source ?? null,
  };
}

/** Read-only load of everything the plan needs. */
export async function readOpenProposalState(col: ReadOnlyCollection) {
  const projection = { businessId: 1, kind: 1, status: 1, beforeFingerprint: 1, proposed: 1, createdAt: 1, openKey: 1, source: 1, executedAt: 1 };
  const candidates = (await col.find({ status: { $in: BACKFILL_STATUSES }, openKey: { $not: { $type: 'string' } } }, { projection }).sort({ createdAt: -1, _id: -1 }).toArray()).map(toPlanRecord);
  const keyed = (await col.find({ openKey: { $type: 'string' } }, { projection }).toArray()).map(toPlanRecord);
  const executingRaw = await col.find({ status: 'EXECUTING' }, { projection: { _id: 1, businessId: 1, kind: 1, executedAt: 1, openKey: 1 } }).sort({ executedAt: 1, _id: 1 }).limit(50).toArray();
  const byStatus = await col.aggregate<{ _id: string; n: number }>([
    { $match: { status: { $in: [...BACKFILL_STATUSES, 'EXECUTING'] } } },
    { $group: { _id: { $concat: ['$status', { $cond: [{ $eq: [{ $type: '$openKey' }, 'string'] }, ':keyed', ':unkeyed'] }] }, n: { $sum: 1 } } },
  ]).toArray();
  return {
    candidates,
    keyed,
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.n]).sort()),
    executingNotKeyed: executingRaw.filter((d) => typeof d.openKey !== 'string').map((d) => ({ id: String(d._id), businessId: String(d.businessId), kind: String(d.kind), executedAt: iso(d.executedAt) })),
  };
}

/**
 * Problems with keys the app already wrote. Two records holding the same key
 * for one business would make the unique index build fail.
 */
export function keyIntegrity(keyed: PlanRecord[]) {
  const seen = new Map<string, string[]>();
  for (const r of keyed) {
    if (typeof r.openKey !== 'string') continue;
    const scope = `${r.businessId}|${r.openKey}`;
    seen.set(scope, [...(seen.get(scope) || []), r.id]);
  }
  return {
    sameKeyHeldTwice: [...seen.entries()].filter(([, ids]) => ids.length > 1).map(([scope, ids]) => ({ businessId: scope.split('|')[0], keyPrefix: scope.split('|')[1].slice(0, 12), ids })),
    closedButKeyed: keyed.filter((r) => typeof r.openKey === 'string' && !OPEN_KEY_STATUSES.has(r.status)).map((r) => ({ id: r.id, status: r.status })),
    keyDoesNotMatchContent: keyed.filter((r) => typeof r.openKey === 'string' && r.proposed !== undefined && recordKey(r) !== r.openKey).map((r) => ({ id: r.id, status: r.status })),
  };
}
