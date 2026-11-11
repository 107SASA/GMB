/**
 * Growth Partner CRM — pure rules, so tests load them directly.
 *
 * Partners work their own leads in the same pipeline the super admin uses
 * (platform Lead stages), with three differences:
 *  - they can't mark a lead "Payment verified" or "Customer" — only a real
 *    payment does that (that's what earns commission);
 *  - once a lead is a customer, its stage is locked for them;
 *  - they only see their own activity on a lead's timeline, plus the
 *    milestones (created, stage changes, payment) — never our team's notes
 *    or anything the AI / WhatsApp side recorded.
 */
import { CRM_STAGES, type CrmStage } from '../admin/platformCrm.ts';

const SYSTEM_ONLY: CrmStage[] = ['PAYMENT_VERIFIED', 'CUSTOMER', 'HUMAN_HANDOFF'];

/** Stages a partner may move their lead to. */
export const PARTNER_STAGES = CRM_STAGES.filter((s) => s.settable && !SYSTEM_ONLY.includes(s.value));

export function partnerStageCheck(
  current: string | null | undefined,
  next: unknown
): { ok: true; stage: CrmStage } | { ok: false; error: string } {
  if (current === 'CUSTOMER') return { ok: false, error: 'This lead is already a customer — its stage can’t be changed.' };
  const def = PARTNER_STAGES.find((s) => s.value === next);
  if (!def) {
    if (next === 'CUSTOMER' || next === 'PAYMENT_VERIFIED') {
      return { ok: false, error: 'A lead becomes a customer automatically when their payment is received.' };
    }
    return { ok: false, error: 'Unknown stage.' };
  }
  return { ok: true, stage: def.value };
}

/** Lead events a partner always sees, whoever caused them. */
const MILESTONES = new Set(['LEAD_CREATED', 'LEAD_IMPORTED', 'STAGE_CHANGED', 'PAYMENT_SUCCESS', 'CUSTOMER_ACTIVATED']);
/** Lead events a partner sees only when they made them. */
const OWN_ONLY = new Set(['NOTE_ADDED', 'LEAD_UPDATED', 'FOLLOW_UP_SCHEDULED', 'FOLLOW_UP_DONE']);

export function partnerCanSeeEvent(event: { type: string; actor?: string | null }, partnerUserId: string): boolean {
  if (MILESTONES.has(event.type)) return true;
  return OWN_ONLY.has(event.type) && String(event.actor ?? '') === partnerUserId;
}

/** The safe, partner-facing shape of a timeline event (no internal payload fields). */
export function partnerEventView(e: { _id?: unknown; type: string; payload?: any; actor?: string | null; createdAt?: Date | string }, partnerUserId: string) {
  const p = e.payload ?? {};
  const mine = String(e.actor ?? '') === partnerUserId;
  let text: string;
  switch (e.type) {
    case 'LEAD_CREATED': text = 'Lead added'; break;
    case 'LEAD_IMPORTED': text = 'Lead imported'; break;
    case 'STAGE_CHANGED': {
      const from = CRM_STAGES.find((s) => s.value === p.from)?.label ?? p.from ?? '—';
      const to = CRM_STAGES.find((s) => s.value === p.to)?.label ?? p.to ?? '—';
      text = `Stage: ${from} → ${to}`;
      break;
    }
    case 'PAYMENT_SUCCESS': text = 'Payment received'; break;
    case 'CUSTOMER_ACTIVATED': text = 'Became a customer'; break;
    case 'NOTE_ADDED': text = String(p.text ?? '').slice(0, 2000); break;
    case 'LEAD_UPDATED': text = `Updated: ${(Array.isArray(p.fields) ? p.fields : []).join(', ')}`; break;
    case 'FOLLOW_UP_SCHEDULED': text = `Follow-up scheduled (${p.type ?? 'Call'})${p.note ? ` — ${String(p.note).slice(0, 200)}` : ''}`; break;
    case 'FOLLOW_UP_DONE': text = `Follow-up done (${p.type ?? 'Call'})`; break;
    default: text = e.type;
  }
  return {
    id: String(e._id ?? ''),
    type: e.type,
    text,
    by: mine ? 'you' : 'system',
    at: e.createdAt ?? null,
  };
}

/** Partner follow-ups live under their own tenant so they never mix with the team's. */
export function partnerFollowUpTenant(partnerId: string): string {
  return `partner:${partnerId}`;
}
