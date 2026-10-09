/**
 * FR-5 change lifecycle. Pure. OptimizationAction status is a different
 * machine and is not used here.
 *
 * PROPOSED → APPROVED → EXECUTING → VERIFIED
 *                  ↘ FAILED / BLOCKED / CONFLICT
 * VERIFIED → EXECUTING (rollback) → REVERTED
 */

import { canonicalFingerprint, classifyReadBack, type ReadBackStatus } from './policy.ts';

export type ChangeStatus =
  | 'PROPOSED'
  | 'APPROVED'
  | 'EXECUTING'
  | 'APPLIED'
  | 'VERIFIED'
  | 'FAILED'
  | 'REVERTED'
  | 'BLOCKED'
  | 'CONFLICT'
  | 'UNRESOLVED';

export interface ChangeRecord {
  id: string;
  businessId: string;
  organizationId?: string | null;
  locationId: string;
  kind: string;
  fields: string[];
  sensitive: boolean;
  source: string;
  before: unknown;
  proposed: unknown;
  after: unknown;
  beforeFingerprint: string;
  afterFingerprint: string | null;
  status: ChangeStatus;
  validation: { valid: boolean; violations: Array<{ code: string; message: string }> };
  requestedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  verifiedAt: string | null;
  googleResult: unknown;
  error: string | null;
  rollbackStatus: string | null;
  rolledBackBy: string | null;
  rolledBackAt: string | null;
  recommendationRef: Record<string, unknown> | null;
}

export function executionClaim(status: ChangeStatus): 'ok' | 'duplicate' | 'not_approved' {
  if (status === 'EXECUTING' || status === 'APPLIED' || status === 'VERIFIED' || status === 'REVERTED') return 'duplicate';
  if (status !== 'APPROVED') return 'not_approved';
  return 'ok';
}

export function approve(
  change: ChangeRecord,
  actor: { userId: string; businessId: string },
  opts: { confirmSensitive?: boolean; now: string },
): { ok: true; change: ChangeRecord } | { ok: false; error: string } {
  if (actor.businessId !== change.businessId) return { ok: false, error: 'This change belongs to another workspace.' };
  if (change.status !== 'PROPOSED') return { ok: false, error: 'Only a proposed change can be approved.' };
  if (!change.validation.valid) return { ok: false, error: 'Validation failed. The change cannot be approved.' };
  if (change.sensitive && opts.confirmSensitive !== true) {
    return { ok: false, error: 'This field needs a separate explicit approval.' };
  }
  return {
    ok: true,
    change: { ...change, status: 'APPROVED', approvedBy: actor.userId, approvedAt: opts.now },
  };
}

export function failClosed(change: ChangeRecord, status: 'FAILED' | 'BLOCKED' | 'CONFLICT', error: string, now: string): ChangeRecord {
  return { ...change, status, error, executedAt: change.executedAt || now, after: null, afterFingerprint: null };
}

export function markVerified(change: ChangeRecord, after: unknown, googleResult: unknown, now: string): ChangeRecord {
  return {
    ...change,
    status: 'VERIFIED',
    after,
    afterFingerprint: canonicalFingerprint(change.kind, after),
    googleResult,
    error: null,
    verifiedAt: now,
    executedAt: change.executedAt || now,
  };
}

export function rollbackDecision(change: ChangeRecord, currentFingerprint: string): 'ok' | 'conflict' | 'not_verified' | 'duplicate' {
  if (change.rollbackStatus === 'REVERTED' || change.status === 'REVERTED') return 'duplicate';
  if (change.status !== 'VERIFIED' || !change.afterFingerprint) return 'not_verified';
  if (currentFingerprint !== change.afterFingerprint) return 'conflict';
  return 'ok';
}

export function markUnresolved(change: ChangeRecord, error: string, now: string): ChangeRecord {
  return { ...change, status: 'UNRESOLVED', error, executedAt: change.executedAt || now, after: null, afterFingerprint: null };
}

export class WriteNotAccepted extends Error {
  googleBody: unknown;
  constructor(googleBody: unknown) {
    super('Google did not accept the write.');
    this.name = 'WriteNotAccepted';
    this.googleBody = googleBody;
  }
}

const READ_BACK_ERROR: Record<ReadBackStatus, string | null> = {
  VERIFIED: null,
  FAILED: 'Google accepted the request but the read-back still shows the previous value.',
  CONFLICT: 'The value Google stored does not match the approved proposal.',
};

/**
 * One patch, then at most two reads. A failed read does not patch again.
 * VERIFIED only when classifyReadBack matches the proposal.
 */
export async function applyAndVerify(input: {
  kind: string;
  before: unknown;
  proposed: unknown;
  patch: () => Promise<unknown>;
  read: () => Promise<unknown>;
}): Promise<{ status: 'VERIFIED' | 'FAILED' | 'CONFLICT' | 'UNRESOLVED'; after: unknown; googleBody: unknown; error: string | null }> {
  let googleBody: unknown = null;
  try {
    googleBody = await input.patch();
  } catch (err) {
    if (err instanceof WriteNotAccepted) throw err;
    return {
      status: 'UNRESOLVED',
      after: null,
      googleBody: null,
      error: 'The Google write did not return a readable result. It was not retried.',
    };
  }
  let actual: unknown;
  let read = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      actual = await input.read();
      read = true;
      break;
    } catch {
      read = false;
    }
  }
  if (!read) {
    return {
      status: 'UNRESOLVED',
      after: null,
      googleBody,
      error: 'Google may have accepted the write, but the read-back failed. It was not retried.',
    };
  }
  const status = classifyReadBack(input.kind, input.before, input.proposed, actual);
  return { status, after: status === 'VERIFIED' ? actual : null, googleBody, error: READ_BACK_ERROR[status] };
}

export function markReverted(change: ChangeRecord, actorId: string, googleResult: unknown, now: string): ChangeRecord {
  return {
    ...change,
    status: 'REVERTED',
    rollbackStatus: 'REVERTED',
    rolledBackBy: actorId,
    rolledBackAt: now,
    googleResult,
    after: change.before,
    afterFingerprint: change.beforeFingerprint,
  };
}
