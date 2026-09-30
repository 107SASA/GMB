import dbConnect from '@/lib/mongodb';
import { gbpWritesEnabled } from '@/lib/gbpSafety';
import { collectExecutions } from './collect';
import { deriveActionStatus, type ExecutionsSince } from './actions';
import type { ExecutionRecords, PlanActionView } from './monthly';

const FIELD_OF: Record<string, string> = {
  update_title: 'title', update_description: 'description', update_phone: 'primaryPhone', update_website: 'website',
};

function executionsSince(ex: ExecutionRecords, since: string): ExecutionsSince {
  const after = (at: string | null) => !!at && at >= since;
  return {
    posts: ex.posts.filter((p) => after(p.at)).length,
    repliesByGrowwMatics: ex.replies.filter((r) => r.by !== 'external' && after(r.at)).length,
    reviewRequestsSent: (ex.reviewRequests.sentAt || []).filter((t) => after(t)).length,
    photos: ex.photos.filter((p) => after(p.at)).length,
    appliedEdits: ex.profileEdits.filter((e) => e.liveWriteApplied === true && after(e.at)).map((e) => ({ at: e.at, fields: e.fields })),
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

  const open: any[] = await OptimizationAction.find({ businessId: opts.businessId, status: { $ne: 'VERIFIED' } }).lean();
  if (!open.length) return [];
  const earliest = new Date(Math.min(...open.map((a) => new Date(a.plannedAt).getTime())));
  const ex = await collectExecutions(opts.businessId, earliest, new Date(at.getTime() + 1));
  const views: PlanActionView[] = [];

  for (const a of open) {
    const plannedIso = new Date(a.plannedAt).toISOString();
    const plannedThisAudit = String(a.plannedInAuditId) === String(opts.auditId);
    const res = deriveActionStatus(
      { findingId: a.findingId, capability: a.capability, requiresGbpConnection: a.requiresGbpConnection, plannedAt: plannedIso, fields: a.capability ? [FIELD_OF[a.capability]].filter(Boolean) : [] },
      {
        gbpConnected: opts.gbpConnected,
        liveWritesEnabled: gbpWritesEnabled(),
        executions: executionsSince(ex, plannedIso),
        // This audit re-measures only actions planned BEFORE it.
        findingStillPresent: plannedThisAudit ? null : opts.currentFindingIds.has(a.findingId),
        remeasuredAt: plannedThisAudit ? null : at.toISOString(),
      },
    );
    const update: any = {
      status: res.status, statusReason: res.statusReason, lastMeasuredAuditId: opts.auditId,
      ...(res.executedAt || res.executionResult ? { executedAt: res.executedAt ? new Date(res.executedAt) : a.executedAt ?? at, executionResult: res.executionResult } : {}),
      ...(res.status === 'VERIFIED' ? { verifiedAt: res.verifiedAt ? new Date(res.verifiedAt) : at, verificationResult: res.verificationResult } : {}),
    };
    const changed = res.status !== a.status;
    await OptimizationAction.updateOne(
      { _id: a._id },
      { $set: update, ...(changed ? { $push: { history: { at, status: res.status, reason: res.statusReason } } } : {}) },
    );
    views.push({ findingId: a.findingId, action: a.description, status: res.status, executor: a.capability ? `growwmatics:${a.capability}` : 'owner', statusReason: res.statusReason });
  }
  // Actions verified earlier stay in the report's "completed" list.
  const done: any[] = await OptimizationAction.find({ businessId: opts.businessId, status: 'VERIFIED' }).select('findingId description capability verificationResult').lean();
  for (const d of done) {
    if (!views.some((v) => v.findingId === d.findingId)) {
      views.push({ findingId: d.findingId, action: d.description, status: 'VERIFIED', executor: d.capability ? `growwmatics:${d.capability}` : 'owner', statusReason: d.verificationResult });
    }
  }
  return views;
}
