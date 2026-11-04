import dbConnect from '@/lib/mongodb';
import { fr5ProfileMutationAllowed } from '@/lib/gbpSafety';
import { collectExecutions } from './collect';
import { deriveActionStatus, editTouchesField, FIELD_OF, type ExecutionsSince } from './actions';
import { effectiveProfileEdits, type ExecutionRecords, type PlanActionView } from './monthly';
import { seenFixedOnGoogle, type SnapshotForCheck } from '../tasks/planTasks';

function executionsSince(ex: ExecutionRecords, since: string): ExecutionsSince {
  const after = (at: string | null) => !!at && at >= since;
  return {
    posts: ex.posts.filter((p) => after(p.at)).length,
    repliesByGrowwMatics: ex.replies.filter((r) => r.by !== 'external' && after(r.at)).length,
    reviewRequestsSent: (ex.reviewRequests.sentAt || []).filter((t) => after(t)).length,
    photos: ex.photos.filter((p) => after(p.at)).length,
    // A rolled-back change never counts as the fix (nor does its rollback).
    appliedEdits: effectiveProfileEdits(ex.profileEdits).filter((e) => after(e.at)).map((e) => ({ at: e.at, fields: e.fields })),
  };
}

/**
 * Upserts this audit's plan into OptimizationAction (one per finding, kept
 * across months) and re-derives every open action's status from execution
 * records + this audit's measurement. Connected baseline / monthly audits only.
 */
export async function syncOptimizationActions(opts: {
  businessId: string;
  auditId: string;
  auditAt: Date;
  plan: Array<{ findingId: string; evidence: string; evidenceState?: string; priority: 'high' | 'medium' | 'low'; action: string; ownerAction: string; growwmaticsAction: string | null; executor: string; requiresGbpConnection: boolean; measurement: string }>;
  currentFindingIds: Set<string>;
  gbpConnected: boolean;
}): Promise<PlanActionView[]> {
  await dbConnect();
  const { default: OptimizationAction } = await import('@/models/OptimizationAction');
  const at = opts.auditAt;

  // Reopen: this audit measured the issue again after it was confirmed,
  // marked done by the owner, or seen fixed on Google. It starts over as a
  // fresh plan item (executions before now no longer count for it).
  const existing: any[] = await OptimizationAction.find({ businessId: opts.businessId, findingId: { $in: opts.plan.map((p) => p.findingId) } })
    .select('findingId status ownerMarkedDoneAt seenFixedOnGoogleAt').lean();
  for (const e of existing) {
    if (e.status !== 'VERIFIED' && !e.ownerMarkedDoneAt && !e.seenFixedOnGoogleAt) continue;
    const reason = e.status === 'VERIFIED' ? 'Reopened — a later audit found the issue again' : 'Reopened — the audit still found the issue';
    await OptimizationAction.updateOne(
      { _id: e._id },
      {
        $set: { status: 'PLANNED', statusReason: reason, reopenedAt: at, plannedAt: at, plannedInAuditId: opts.auditId, ownerMarkedDoneAt: null, seenFixedOnGoogleAt: null },
        $unset: { verifiedAt: 1, verificationResult: 1, executedAt: 1, executionResult: 1 },
        $push: { history: { at, status: 'PLANNED', reason } },
      },
    );
  }

  for (const p of opts.plan) {
    const capability = p.executor.startsWith('growwmatics:') ? p.executor.slice('growwmatics:'.length) : null;
    await OptimizationAction.updateOne(
      { businessId: opts.businessId, findingId: p.findingId },
      {
        $setOnInsert: { plannedInAuditId: opts.auditId, plannedAt: at, status: 'PLANNED', history: [{ at, status: 'PLANNED', reason: 'Planned from audit' }] },
        $set: {
          description: p.action, evidence: p.evidence, evidenceState: p.evidenceState, priority: p.priority,
          ownerAction: p.ownerAction, growwmaticsAction: p.growwmaticsAction, capability,
          requiresGbpConnection: p.requiresGbpConnection, measurement: p.measurement,
        },
      },
      { upsert: true },
    );
  }
  return refreshActionStatuses(opts);
}

/**
 * Re-derives every open action's status from execution records and the
 * current audit's findings, and returns all actions (open + verified) with
 * their dates. Called BEFORE the new SEO plan is generated (so it knows what
 * was done) and again by syncOptimizationActions after the final findings.
 * Writes only when a status changes.
 */
export async function refreshActionStatuses(opts: {
  businessId: string;
  auditId: string;
  auditAt: Date;
  currentFindingIds: Set<string>;
  gbpConnected: boolean;
}): Promise<PlanActionView[]> {
  await dbConnect();
  const { default: OptimizationAction } = await import('@/models/OptimizationAction');
  const at = opts.auditAt;
  const open: any[] = await OptimizationAction.find({ businessId: opts.businessId, status: { $ne: 'VERIFIED' } }).lean();
  const views: PlanActionView[] = [];
  if (open.length) {
  const earliest = new Date(Math.min(...open.map((a) => new Date(a.plannedAt).getTime())));
  const ex = await collectExecutions(opts.businessId, earliest, new Date(at.getTime() + 1));

  for (const a of open) {
    const plannedIso = new Date(a.plannedAt).toISOString();
    const plannedThisAudit = String(a.plannedInAuditId) === String(opts.auditId);
    const res = deriveActionStatus(
      { findingId: a.findingId, capability: a.capability, requiresGbpConnection: a.requiresGbpConnection, plannedAt: plannedIso, fields: a.capability ? [FIELD_OF[a.capability]].filter(Boolean) : [] },
      {
        gbpConnected: opts.gbpConnected,
        // Profile edits need the FR-5 switch as well as the global one (executeChange).
        liveWritesEnabled: fr5ProfileMutationAllowed(),
        executions: executionsSince(ex, plannedIso),
        // This audit re-measures only actions planned BEFORE it.
        findingStillPresent: plannedThisAudit ? null : opts.currentFindingIds.has(a.findingId),
        remeasuredAt: plannedThisAudit ? null : at.toISOString(),
      },
    );
    const update: any = {
      status: res.status, statusReason: res.statusReason, lastMeasuredAuditId: opts.auditId,
      ...(res.executedAt || res.executionResult ? { executedAt: res.executedAt ? new Date(res.executedAt) : a.executedAt ?? at, executionResult: res.executionResult } : {}),
      ...(res.status === 'VERIFIED' ? { verifiedAt: res.verifiedAt ? new Date(res.verifiedAt) : at, verificationResult: res.verificationResult, reopenedAt: null } : {}),
    };
    const changed = res.status !== a.status;
    await OptimizationAction.updateOne(
      { _id: a._id },
      { $set: update, ...(changed ? { $push: { history: { at, status: res.status, reason: res.statusReason } } } : {}) },
    );
    const executedAt = res.executedAt ?? (a.executedAt ? new Date(a.executedAt).toISOString() : undefined);
    views.push({
      findingId: a.findingId, action: a.description, status: res.status, executor: a.capability ? `growwmatics:${a.capability}` : 'owner', statusReason: res.statusReason,
      capability: a.capability ?? null, plannedAt: plannedIso, ...(executedAt ? { executedAt } : {}), ...(res.verifiedAt ? { verifiedAt: res.verifiedAt } : {}),
    });
  }
  }
  // Actions verified earlier stay in the report's "completed" list.
  const done: any[] = await OptimizationAction.find({ businessId: opts.businessId, status: 'VERIFIED' }).select('findingId description capability verificationResult plannedAt executedAt verifiedAt').lean();
  for (const d of done) {
    if (!views.some((v) => v.findingId === d.findingId)) {
      views.push({
        findingId: d.findingId, action: d.description, status: 'VERIFIED', executor: d.capability ? `growwmatics:${d.capability}` : 'owner', statusReason: d.verificationResult,
        capability: d.capability ?? null, plannedAt: d.plannedAt ? new Date(d.plannedAt).toISOString() : undefined,
        ...(d.executedAt ? { executedAt: new Date(d.executedAt).toISOString() } : {}), ...(d.verifiedAt ? { verifiedAt: new Date(d.verifiedAt).toISOString() } : {}),
      });
    }
  }
  return views;
}

/**
 * Between audits: moves tasks forward from what has happened since — a
 * verified Profile optimization change, a published post, a sent review
 * request (EXECUTED), or the live Google profile showing the issue fixed
 * (seenFixedOnGoogleAt). Never marks anything VERIFIED: only an audit that
 * re-measures the issue does. Called after a verified change and after each
 * GBP sync. Best-effort for its callers; writes only what changed.
 */
export async function refreshTasksLive(businessId: string, opts: { snapshot?: SnapshotForCheck | null; now?: Date } = {}): Promise<{ updated: number }> {
  await dbConnect();
  const now = opts.now ?? new Date();
  const [{ default: OptimizationAction }, { default: Business }] = await Promise.all([import('@/models/OptimizationAction'), import('@/models/Business')]);
  const open: any[] = await OptimizationAction.find({ businessId, status: { $ne: 'VERIFIED' } }).lean();
  if (!open.length) return { updated: 0 };

  const business: any = await Business.findById(businessId).select('googleLocationId googleConnected').lean();
  const gbpConnected = !!business?.googleLocationId || !!business?.googleConnected;
  let snapshot = opts.snapshot;
  if (snapshot === undefined) {
    const { getGbpSnapshot } = await import('@/services/gbp/intelligence/runner');
    snapshot = (await getGbpSnapshot(businessId).catch(() => null)) as SnapshotForCheck | null;
  }
  const earliest = new Date(Math.min(...open.map((a) => new Date(a.plannedAt).getTime())));
  const ex = await collectExecutions(businessId, earliest, new Date(now.getTime() + 1));

  let updated = 0;
  for (const a of open) {
    const plannedIso = new Date(a.plannedAt).toISOString();
    const res = deriveActionStatus(
      { findingId: a.findingId, capability: a.capability, requiresGbpConnection: a.requiresGbpConnection, plannedAt: plannedIso },
      { gbpConnected, liveWritesEnabled: fr5ProfileMutationAllowed(), executions: executionsSince(ex, plannedIso), findingStillPresent: null, remeasuredAt: null },
    );
    const set: Record<string, unknown> = {};
    const statusChanged = res.status !== a.status && res.status !== 'VERIFIED';
    if (statusChanged) {
      set.status = res.status;
      set.statusReason = res.statusReason;
      if (res.executedAt || res.executionResult) {
        set.executedAt = res.executedAt ? new Date(res.executedAt) : now;
        set.executionResult = res.executionResult;
      }
    }
    const seen = seenFixedOnGoogle(a.findingId, a.capability, snapshot ?? null);
    if (seen === true && !a.seenFixedOnGoogleAt) set.seenFixedOnGoogleAt = now;
    if (seen === false && a.seenFixedOnGoogleAt) set.seenFixedOnGoogleAt = null;
    if (!Object.keys(set).length) continue;
    await OptimizationAction.updateOne(
      { _id: a._id },
      { $set: set, ...(statusChanged ? { $push: { history: { at: now, status: res.status, reason: res.statusReason } } } : {}) },
    );
    updated++;
  }
  return { updated };
}

/**
 * A verified Google profile change was rolled back: every plan task that
 * change could have completed — done, seen fixed on Google, or confirmed —
 * is open again at once, with the reason in its history. Earlier edits no
 * longer count for it (plannedAt moves to now; the rollback itself never
 * counts — effectiveProfileEdits). The stored GBP snapshot is not re-read
 * here: it still shows the pre-rollback value until the next sync.
 */
export async function reopenTasksAfterRollback(businessId: string, fields: string[], now = new Date()): Promise<{ reopened: number }> {
  await dbConnect();
  const { default: OptimizationAction } = await import('@/models/OptimizationAction');
  const candidates: any[] = await OptimizationAction.find({
    businessId,
    capability: { $in: Object.keys(FIELD_OF) },
    $or: [{ status: { $in: ['EXECUTED', 'VERIFIED'] } }, { seenFixedOnGoogleAt: { $ne: null } }],
  }).select('_id capability status').lean();
  const reason = 'Reopened — the change on Google was rolled back';
  let reopened = 0;
  for (const a of candidates) {
    if (!editTouchesField(fields, FIELD_OF[a.capability])) continue;
    await OptimizationAction.updateOne(
      { _id: a._id },
      {
        $set: { status: 'PLANNED', statusReason: reason, reopenedAt: now, plannedAt: now, seenFixedOnGoogleAt: null, ownerMarkedDoneAt: null },
        $unset: { executedAt: 1, executionResult: 1, verifiedAt: 1, verificationResult: 1 },
        $push: { history: { at: now, status: 'PLANNED', reason } },
      },
    );
    reopened++;
  }
  // READY / BLOCKED from the prerequisites, without the stale snapshot.
  if (reopened) await refreshTasksLive(businessId, { snapshot: null, now });
  return { reopened };
}
