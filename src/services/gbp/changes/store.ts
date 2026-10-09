/**
 * Persists FR-5 changes and is the only profile-write executor.
 * SEO plan generation and the audit do not call this module's execute path.
 */
import dbConnect from '@/lib/mongodb';
import GbpProfileChange, { type IGbpProfileChange } from '@/models/GbpProfileChange';
import GBPToken from '@/models/GBPToken';
import User from '@/models/User';
import { fr5ProfileMutationAllowed } from '@/lib/gbpSafety';
import { logProfileActivity } from '@/lib/logProfileActivity';
import {
  mirrorVerifiedProfile,
  patchLocationAttributes,
  patchLocationRaw,
  readLocationAttributes,
  readLocationRaw,
  updateLocationProfile,
  type GbpProfilePatch,
} from '@/lib/gbpClient';
import { canRollbackAttribute, canonicalFingerprint, classifyReadBack, idempotencyResult, locationGuard, rollbackRecheck } from './policy.ts';
import { applyAndVerify, approve, executionClaim, failClosed, markReverted, markUnresolved, markVerified, rollbackDecision, WriteNotAccepted, type ChangeRecord } from './machine.ts';

export class ProposalConflictError extends Error {
  constructor() {
    super('This request id was already used for a different proposal.');
    this.name = 'ProposalConflictError';
  }
}

const SENSITIVE_KINDS = new Set(['title', 'primary_category', 'address']);

function toRecord(doc: IGbpProfileChange): ChangeRecord {
  return {
    id: doc._id.toString(),
    businessId: doc.businessId.toString(),
    organizationId: doc.organizationId,
    locationId: doc.locationId,
    kind: doc.kind,
    fields: doc.fields,
    sensitive: doc.sensitive,
    source: doc.source,
    before: doc.before,
    proposed: doc.proposed,
    after: doc.after,
    beforeFingerprint: doc.beforeFingerprint,
    afterFingerprint: doc.afterFingerprint ?? null,
    status: doc.status,
    validation: doc.validation,
    requestedBy: doc.requestedBy,
    approvedBy: doc.approvedBy ?? null,
    approvedAt: doc.approvedAt ? doc.approvedAt.toISOString() : null,
    executedAt: doc.executedAt ? doc.executedAt.toISOString() : null,
    verifiedAt: doc.verifiedAt ? doc.verifiedAt.toISOString() : null,
    googleResult: doc.googleResult ?? null,
    error: doc.error ?? null,
    rollbackStatus: doc.rollbackStatus ?? null,
    rolledBackBy: doc.rolledBackBy ?? null,
    rolledBackAt: doc.rolledBackAt ? doc.rolledBackAt.toISOString() : null,
    recommendationRef: doc.recommendationRef ?? null,
  };
}

async function saveRecord(doc: IGbpProfileChange, next: ChangeRecord): Promise<IGbpProfileChange> {
  doc.status = next.status;
  doc.after = next.after;
  doc.afterFingerprint = next.afterFingerprint;
  doc.approvedBy = next.approvedBy;
  doc.approvedAt = next.approvedAt ? new Date(next.approvedAt) : null;
  doc.executedAt = next.executedAt ? new Date(next.executedAt) : null;
  doc.verifiedAt = next.verifiedAt ? new Date(next.verifiedAt) : null;
  doc.googleResult = next.googleResult;
  doc.error = next.error;
  doc.rollbackStatus = next.rollbackStatus;
  doc.rolledBackBy = next.rolledBackBy;
  doc.rolledBackAt = next.rolledBackAt ? new Date(next.rolledBackAt) : null;
  await doc.save();
  return doc;
}

const ACTIVITY_FIELDS: Record<string, string[]> = {
  title: ['title'],
  description: ['description'],
  phone: ['primaryPhone'],
  website: ['website'],
  primary_category: ['primaryCategory', 'additionalCategories'],
  categories: ['additionalCategories'],
  services: ['services'],
  hours: ['regularHours', 'specialHours'],
  service_area: ['serviceArea'],
};

async function noteVerifiedEdit(change: IGbpProfileChange, actorUserId: string): Promise<void> {
  let fields = ACTIVITY_FIELDS[change.kind] || [];
  if (change.kind === 'attribute') {
    const name = String((change.proposed as { name?: string })?.name || '');
    const id = name.split('/').pop();
    fields = id ? [`attribute:${id}`] : [];
  }
  if (!fields.length) return;
  const user = await User.findById(actorUserId).select('fullName email').lean<{ fullName?: string; email?: string }>();
  await logProfileActivity({
    businessId: change.businessId.toString(),
    organizationId: change.organizationId || undefined,
    type: 'profile_updated',
    title: 'Google profile change verified',
    detail: change.kind,
    updatedBy: user?.fullName || user?.email || actorUserId,
    metadata: { liveWriteApplied: true, fields, changeId: change._id.toString() },
  });
}

export async function createChange(input: {
  businessId: string;
  organizationId?: string | null;
  locationId: string;
  kind: string;
  fields: string[];
  source: string;
  before: unknown;
  proposed: unknown;
  validation: { valid: boolean; violations: Array<{ code: string; message: string }> };
  requestedBy: string;
  recommendationRef?: Record<string, unknown> | null;
  clientRequestId?: string | null;
}): Promise<IGbpProfileChange> {
  await dbConnect();
  if (input.clientRequestId) {
    const existing = await GbpProfileChange.findOne({ businessId: input.businessId, clientRequestId: input.clientRequestId });
    const decision = idempotencyResult(existing, input);
    if (decision === 'reuse' && existing) return existing;
    if (decision === 'conflict') throw new ProposalConflictError();
  }
  if (input.kind === 'address') {
    return GbpProfileChange.create({
      ...input,
      sensitive: true,
      beforeFingerprint: canonicalFingerprint(input.kind, input.before),
      status: 'BLOCKED',
      validation: { valid: false, violations: [{ code: 'address', message: 'Address has no unattended edit path.' }] },
      error: 'Address edits are not offered.',
    });
  }
  const status = input.validation.valid ? 'PROPOSED' : 'BLOCKED';
  try {
    return await GbpProfileChange.create({
      ...input,
      sensitive: SENSITIVE_KINDS.has(input.kind),
      beforeFingerprint: canonicalFingerprint(input.kind, input.before),
      status,
      error: input.validation.valid ? null : input.validation.violations.map((v) => v.message).join(' '),
    });
  } catch (err: any) {
    if (err?.code === 11000 && input.clientRequestId) {
      const existing = await GbpProfileChange.findOne({ businessId: input.businessId, clientRequestId: input.clientRequestId });
      const decision = idempotencyResult(existing, input);
      if (decision === 'reuse' && existing) return existing;
      if (decision === 'conflict') throw new ProposalConflictError();
    }
    throw err;
  }
}

export async function approveChange(id: string, actor: { userId: string; businessId: string }, confirmSensitive = false) {
  await dbConnect();
  const doc = await GbpProfileChange.findOne({ _id: id, businessId: actor.businessId });
  if (!doc) return { ok: false as const, error: 'Change not found.' };
  const result = approve(toRecord(doc), actor, { confirmSensitive, now: new Date().toISOString() });
  if (!result.ok) return result;
  const claimed = await GbpProfileChange.findOneAndUpdate(
    { _id: id, businessId: actor.businessId, status: 'PROPOSED' },
    { $set: { status: 'APPROVED', approvedBy: actor.userId, approvedAt: new Date(result.change.approvedAt || Date.now()) } },
    { new: true },
  );
  if (!claimed) return { ok: false as const, error: 'This proposal is no longer waiting for approval.' };
  return { ok: true as const, change: claimed };
}

function sliceOf(raw: any, kind: string): unknown {
  if (!raw) return null;
  switch (kind) {
    case 'title': return raw.title ?? null;
    case 'description': return raw.profile?.description ?? null;
    case 'phone': return raw.phoneNumbers?.primaryPhone ?? null;
    case 'website': return raw.websiteUri ?? null;
    case 'categories':
    case 'primary_category': return raw.categories ?? null;
    case 'services': return raw.serviceItems ?? null;
    case 'hours': return { regularHours: raw.regularHours ?? null, specialHours: raw.specialHours ?? null };
    case 'service_area': return raw.serviceArea ?? null;
    default: return null;
  }
}

const READ_MASK: Record<string, string> = {
  title: 'title',
  description: 'profile',
  phone: 'phoneNumbers',
  website: 'websiteUri',
  categories: 'categories',
  primary_category: 'categories',
  services: 'serviceItems,metadata',
  hours: 'regularHours,specialHours',
  service_area: 'serviceArea',
};

async function connectedLocationId(businessId: string): Promise<string | null> {
  const token = await GBPToken.findOne({ businessId }).select('locationId').lean<{ locationId?: string }>();
  return token?.locationId || null;
}

async function readKind(businessId: string, kind: string, proposed: unknown): Promise<unknown> {
  if (kind === 'attribute') {
    const name = String((proposed as { name?: string })?.name || '');
    const raw = await readLocationAttributes(businessId);
    return (raw?.attributes || []).find((item: { name?: string }) => item.name === name) || null;
  }
  const mask = READ_MASK[kind];
  if (!mask) return null;
  return sliceOf(await readLocationRaw(businessId, mask), kind);
}

async function writeKind(businessId: string, kind: string, proposed: any) {
  if (kind === 'title' || kind === 'description' || kind === 'phone' || kind === 'website') {
    const patch: GbpProfilePatch = {};
    if (kind === 'title') patch.title = proposed;
    if (kind === 'description') patch.description = proposed;
    if (kind === 'phone') patch.primaryPhone = proposed;
    if (kind === 'website') patch.website = proposed;
    return updateLocationProfile(businessId, patch);
  }
  if (kind === 'categories' || kind === 'primary_category') {
    return patchLocationRaw(businessId, 'categories', { categories: proposed });
  }
  if (kind === 'services') return patchLocationRaw(businessId, 'serviceItems', { serviceItems: proposed });
  if (kind === 'hours') return patchLocationRaw(businessId, 'regularHours,specialHours', proposed);
  if (kind === 'service_area') return patchLocationRaw(businessId, 'serviceArea', { serviceArea: proposed });
  return { liveWriteApplied: false, googleBody: { error: 'This change kind cannot be written.' } };
}

function mirrorSimple(kind: string, after: unknown): GbpProfilePatch {
  const patch: GbpProfilePatch = {};
  if (kind === 'title') patch.title = String(after ?? '');
  if (kind === 'description') patch.description = String(after ?? '');
  if (kind === 'phone') patch.primaryPhone = String(after ?? '');
  if (kind === 'website') patch.website = String(after ?? '');
  return patch;
}

async function settleOutcome(
  claimed: IGbpProfileChange,
  actor: { userId: string; businessId: string },
  outcome: { status: 'VERIFIED' | 'FAILED' | 'CONFLICT' | 'UNRESOLVED'; after: unknown; googleBody: unknown; error: string | null },
  now: string,
) {
  if (outcome.status === 'VERIFIED') {
    const verified = markVerified(toRecord(claimed), outcome.after, outcome.googleBody, now);
    await saveRecord(claimed, verified);
    const patch = mirrorSimple(claimed.kind, outcome.after);
    if (Object.keys(patch).length) await mirrorVerifiedProfile(actor.businessId, patch);
    await noteVerifiedEdit(claimed, actor.userId);
    return { ok: true as const, change: claimed };
  }
  if (outcome.status === 'UNRESOLVED') {
    const unresolved = markUnresolved(toRecord(claimed), outcome.error || 'The Google result is unresolved.', now);
    unresolved.googleResult = outcome.googleBody;
    await saveRecord(claimed, unresolved);
    return { ok: false as const, error: unresolved.error, change: claimed };
  }
  const closed = failClosed(toRecord(claimed), outcome.status, outcome.error || 'The Google write was not verified.', now);
  closed.googleResult = outcome.googleBody;
  await saveRecord(claimed, closed);
  return { ok: false as const, error: closed.error, change: claimed };
}

async function recoverUnresolved(doc: IGbpProfileChange, actor: { userId: string; businessId: string }) {
  const guard = locationGuard(doc.locationId, await connectedLocationId(actor.businessId));
  if (!guard.ok) return { ok: false as const, error: guard.error, change: doc };
  const now = new Date().toISOString();
  try {
    const actual = await readKind(actor.businessId, doc.kind, doc.proposed);
    const status = classifyReadBack(doc.kind, doc.before, doc.proposed, actual);
    return settleOutcome(doc, actor, {
      status,
      after: status === 'VERIFIED' ? actual : null,
      googleBody: doc.googleResult ?? null,
      error: status === 'VERIFIED' ? null : status === 'FAILED'
        ? 'The read-back still shows the previous value. Nothing was sent again.'
        : 'The value on Google does not match the approved proposal. Nothing was sent again.',
    }, now);
  } catch {
    return { ok: false as const, error: 'The read-back is still unavailable. Nothing was sent to Google again.', change: doc };
  }
}

export async function executeChange(id: string, actor: { userId: string; businessId: string }) {
  await dbConnect();
  const pending = await GbpProfileChange.findOne({ _id: id, businessId: actor.businessId });
  if (!pending) return { ok: false as const, error: 'Change not found.' };
  if (pending.status === 'UNRESOLVED') return recoverUnresolved(pending, actor);
  const claimed = await GbpProfileChange.findOneAndUpdate(
    { _id: id, businessId: actor.businessId, status: 'APPROVED' },
    { $set: { status: 'EXECUTING', executedAt: new Date() } },
    { new: true },
  );
  if (!claimed) {
    const existing = await GbpProfileChange.findOne({ _id: id, businessId: actor.businessId }).select('status').lean();
    if (!existing) return { ok: false as const, error: 'Change not found.' };
    const claim = executionClaim(existing.status);
    return { ok: false as const, error: claim === 'duplicate' ? 'This change is already executing or finished.' : 'Approve the change before applying it.' };
  }
  const now = new Date().toISOString();
  const guard = locationGuard(claimed.locationId, await connectedLocationId(actor.businessId));
  if (!guard.ok) {
    claimed.status = 'APPROVED';
    claimed.error = guard.error;
    await claimed.save();
    return { ok: false as const, error: guard.error, change: claimed };
  }
  if (!fr5ProfileMutationAllowed()) {
    const blocked = failClosed(toRecord(claimed), 'BLOCKED', 'Live Google writes are disabled.', now);
    await saveRecord(claimed, blocked);
    return { ok: false as const, error: blocked.error, change: claimed };
  }
  try {
    if (claimed.kind === 'attribute') {
      const spec = claimed.proposed as { name?: string; attribute?: Record<string, unknown> };
      if (!spec?.name || !spec.attribute) {
        const blocked = failClosed(toRecord(claimed), 'BLOCKED', 'An attribute cannot be written without an explicit value.', now);
        await saveRecord(claimed, blocked);
        return { ok: false as const, error: blocked.error, change: claimed };
      }
    }
    let current = await readKind(actor.businessId, claimed.kind, claimed.proposed);
    if (claimed.kind === 'services') {
      const raw = await readLocationRaw(actor.businessId, 'serviceItems,metadata');
      current = raw?.serviceItems ?? [];
      if (raw?.metadata?.canModifyServiceList === false) {
        const blocked = failClosed(toRecord(claimed), 'BLOCKED', 'Google says this service list cannot be modified.', now);
        await saveRecord(claimed, blocked);
        return { ok: false as const, error: blocked.error, change: claimed };
      }
    }
    if (canonicalFingerprint(claimed.kind, current) !== claimed.beforeFingerprint) {
      const conflict = failClosed(toRecord(claimed), 'CONFLICT', 'Google changed this field after the proposal was created.', now);
      await saveRecord(claimed, conflict);
      return { ok: false as const, error: conflict.error, change: claimed };
    }
    const outcome = await applyAndVerify({
      kind: claimed.kind,
      before: claimed.before,
      proposed: claimed.proposed,
      patch: async () => {
        if (!fr5ProfileMutationAllowed()) throw new WriteNotAccepted(null);
        const written = claimed.kind === 'attribute'
          ? await patchLocationAttributes(actor.businessId, String((claimed.proposed as { name?: string }).name), [(claimed.proposed as { attribute: unknown }).attribute])
          : await writeKind(actor.businessId, claimed.kind, claimed.proposed);
        if (!written.liveWriteApplied) throw new WriteNotAccepted(written.googleBody ?? null);
        return written.googleBody ?? null;
      },
      read: () => readKind(actor.businessId, claimed.kind, claimed.proposed),
    });
    return settleOutcome(claimed, actor, outcome, now);
  } catch (err: any) {
    if (err instanceof WriteNotAccepted) {
      const blocked = failClosed(toRecord(claimed), 'BLOCKED', 'Google did not accept the write.', now);
      blocked.googleResult = err.googleBody ?? null;
      await saveRecord(claimed, blocked);
      return { ok: false as const, error: blocked.error, change: claimed };
    }
    const unresolved = markUnresolved(toRecord(claimed), 'The Google write did not return a readable result. It was not retried.', now);
    await saveRecord(claimed, unresolved);
    return { ok: false as const, error: unresolved.error, change: claimed };
  }
}

async function restorePrevious(claimed: IGbpProfileChange, actor: { userId: string; businessId: string }) {
  const now = new Date().toISOString();
  try {
    const outcome = await applyAndVerify({
      kind: claimed.kind,
      before: claimed.after,
      proposed: claimed.before,
      patch: async () => {
        if (!fr5ProfileMutationAllowed()) throw new WriteNotAccepted(null);
        const written = claimed.kind === 'attribute'
          ? await patchLocationAttributes(actor.businessId, String((claimed.proposed as { name?: string }).name), [claimed.before])
          : await writeKind(actor.businessId, claimed.kind, claimed.before);
        if (!written.liveWriteApplied) throw new WriteNotAccepted(written.googleBody ?? null);
        return written.googleBody ?? null;
      },
      read: () => readKind(actor.businessId, claimed.kind, claimed.proposed),
    });
    if (outcome.status === 'VERIFIED') {
      const reverted = markReverted(toRecord(claimed), actor.userId, outcome.googleBody, now);
      await saveRecord(claimed, reverted);
      const patch = mirrorSimple(claimed.kind, outcome.after);
      if (Object.keys(patch).length) await mirrorVerifiedProfile(actor.businessId, patch);
      await noteVerifiedEdit(claimed, actor.userId);
      return { ok: true as const, change: claimed };
    }
    if (outcome.status === 'UNRESOLVED') {
      const unresolved = markUnresolved(toRecord(claimed), outcome.error || 'Rollback could not be read back. It was not retried.', now);
      unresolved.googleResult = outcome.googleBody;
      await saveRecord(claimed, unresolved);
      return { ok: false as const, error: unresolved.error, change: claimed };
    }
    if (outcome.status === 'FAILED') {
      claimed.status = 'VERIFIED';
      claimed.error = 'Rollback did not change Google. The verified edit is unchanged.';
      claimed.googleResult = outcome.googleBody;
      await claimed.save();
      return { ok: false as const, error: claimed.error, change: claimed };
    }
    claimed.status = 'FAILED';
    claimed.error = outcome.error;
    claimed.googleResult = outcome.googleBody;
    await claimed.save();
    return { ok: false as const, error: claimed.error, change: claimed };
  } catch (err: any) {
    if (err instanceof WriteNotAccepted) {
      claimed.status = 'VERIFIED';
      claimed.error = 'Rollback was not accepted by Google. The verified edit is unchanged.';
      claimed.googleResult = err.googleBody ?? null;
      await claimed.save();
      return { ok: false as const, error: claimed.error, change: claimed };
    }
    const unresolved = markUnresolved(toRecord(claimed), 'Rollback did not return a readable result. It was not retried.', now);
    await saveRecord(claimed, unresolved);
    return { ok: false as const, error: unresolved.error, change: claimed };
  }
}

export async function rollbackChange(id: string, actor: { userId: string; businessId: string }) {
  await dbConnect();
  const doc = await GbpProfileChange.findOne({ _id: id, businessId: actor.businessId });
  if (!doc) return { ok: false as const, error: 'Change not found.' };
  const guard = locationGuard(doc.locationId, await connectedLocationId(actor.businessId));
  if (!guard.ok) return { ok: false as const, error: guard.error, change: doc };
  if (doc.kind === 'attribute' && !canRollbackAttribute(doc.before)) {
    return { ok: false as const, error: 'This attribute had no previous Google value, so it cannot be removed automatically.' };
  }
  if (doc.kind !== 'attribute' && !READ_MASK[doc.kind]) return { ok: false as const, error: 'This change cannot be rolled back.' };
  if (!fr5ProfileMutationAllowed()) return { ok: false as const, error: 'Live Google writes are disabled.' };
  const live = await readKind(actor.businessId, doc.kind, doc.proposed);
  const decision = rollbackDecision(toRecord(doc), canonicalFingerprint(doc.kind, live));
  if (decision === 'conflict') {
    doc.status = 'CONFLICT';
    doc.rollbackStatus = 'CONFLICT';
    doc.error = 'Google changed this field after the edit. Rollback was not applied.';
    await doc.save();
    return { ok: false as const, error: doc.error, change: doc };
  }
  if (decision !== 'ok') return { ok: false as const, error: decision === 'duplicate' ? 'Already rolled back.' : 'Only a verified change can be rolled back.' };
  const claimed = await GbpProfileChange.findOneAndUpdate(
    { _id: id, businessId: actor.businessId, status: 'VERIFIED' },
    { $set: { status: 'EXECUTING' } },
    { new: true },
  );
  if (!claimed) return { ok: false as const, error: 'This change is already executing or finished.' };
  let again: unknown;
  try {
    again = await readKind(actor.businessId, claimed.kind, claimed.proposed);
  } catch {
    claimed.status = 'VERIFIED';
    claimed.error = 'Could not re-read Google. Rollback was not sent.';
    await claimed.save();
    return { ok: false as const, error: claimed.error, change: claimed };
  }
  if (rollbackRecheck(claimed.afterFingerprint ?? null, canonicalFingerprint(claimed.kind, again)) === 'conflict') {
    claimed.status = 'CONFLICT';
    claimed.rollbackStatus = 'CONFLICT';
    claimed.error = 'Google changed this field after the edit. Rollback was not applied.';
    await claimed.save();
    return { ok: false as const, error: claimed.error, change: claimed };
  }
  return restorePrevious(claimed, actor);
}

export async function locationIdFor(businessId: string): Promise<string | null> {
  await dbConnect();
  const token = await GBPToken.findOne({ businessId }).select('locationId').lean<{ locationId?: string }>();
  return token?.locationId || null;
}
