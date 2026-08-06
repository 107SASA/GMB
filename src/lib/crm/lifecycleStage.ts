/**
 * Infers a Lead's lifeCycleStage from its (freeform, owner-named) Kanban
 * pipelineStage column, so lifeCycleStage/subStage stay in sync automatically
 * as leads move across the board — without changing the board itself. Each
 * business names its own columns (see Business.kanbanColumns), so this is a
 * best-effort keyword match rather than an exact mapping; it only fires when
 * the caller didn't explicitly set lifeCycleStage in the same request, so an
 * explicit choice (e.g. from the lead detail drawer) is never overridden.
 */
import type { ILead } from '@/models/Lead';

const CONVERTED_KEYWORDS = ['won', 'convert', 'customer', 'client', 'paid', 'signed', 'closed won'];
const CLOSED_KEYWORDS = ['lost', 'closed lost', 'dead', 'reject', 'unqualified', 'disqualif', 'no response', 'archiv'];
const INITIAL_KEYWORDS = ['new', 'inbound', 'inquiry', 'unassigned', 'to contact', 'not contacted'];

export function inferLifeCycleStage(pipelineStage: string | null | undefined): ILead['lifeCycleStage'] {
  const s = (pipelineStage ?? '').toLowerCase().trim();
  if (!s) return 'initial';
  if (CONVERTED_KEYWORDS.some((k) => s.includes(k))) return 'converted';
  if (CLOSED_KEYWORDS.some((k) => s.includes(k))) return 'closed';
  if (INITIAL_KEYWORDS.some((k) => s.includes(k))) return 'initial';
  // Anything else (Contacted, Qualified, Negotiation, Follow-up, …) is
  // somewhere in the middle of the pipeline — 'active' is the safe default.
  return 'active';
}
