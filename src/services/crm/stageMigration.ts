/**
 * Customer CRM stage migration plan — pure (runs under `node --test`).
 *
 * Old app builds wrote only `pipelineStage` (a free-text Kanban column);
 * the canonical model is lifeCycleStage + subStageId/subStage. For one lead
 * this returns the $set to apply, or null when nothing changes. It never
 * invents a deal value: a lead that lands in converted without one is marked
 * deal.valueMissing so revenue/ROI exclude it and the owner is asked for it.
 */
import { legacyColumnToStage, type LeadStagesConfig, type SubStageGroup } from '../../lib/leadStages.ts';

export interface MigrationLead {
  lifeCycleStage?: string | null;
  subStage?: string | null;
  subStageId?: string | null;
  pipelineStage?: string | null;
  deal?: { value?: number | null } | null;
  convertedAt?: Date | string | null;
  lostAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

const CONVERTED_KEYWORDS = ['won', 'convert', 'customer', 'client', 'paid', 'signed', 'closed won'];
const CLOSED_KEYWORDS = ['lost', 'closed lost', 'dead', 'reject', 'unqualified', 'disqualif', 'no response', 'archiv'];
const INITIAL_KEYWORDS = ['new', 'inbound', 'inquiry', 'unassigned', 'to contact', 'not contacted'];

/** Same keyword inference as lib/crm/lifecycleStage.ts (kept pure here). */
export function inferGroup(column: string | null | undefined): 'initial' | SubStageGroup {
  const s = (column ?? '').toLowerCase().trim();
  if (!s) return 'initial';
  if (CONVERTED_KEYWORDS.some((k) => s.includes(k))) return 'converted';
  if (CLOSED_KEYWORDS.some((k) => s.includes(k))) return 'closed';
  if (INITIAL_KEYWORDS.some((k) => s.includes(k))) return 'initial';
  return 'active';
}

export function planLeadStageMigration(lead: MigrationLead, config: LeadStagesConfig): Record<string, unknown> | null {
  const set: Record<string, unknown> = {};
  let lc = lead.lifeCycleStage || 'initial';

  // 1. Legacy rows: only pipelineStage carries the stage.
  if (lc === 'initial' && !lead.subStage && lead.pipelineStage) {
    const hit = legacyColumnToStage(config, lead.pipelineStage);
    const group = hit?.lifeCycleStage ?? inferGroup(lead.pipelineStage);
    if (group !== 'initial') {
      lc = group;
      set.lifeCycleStage = group;
      if (hit) {
        set.subStage = hit.subStage;
        set.subStageId = hit.subStageId;
      }
    }
  }

  // 2. Name-only sub-stages get their stable id.
  if (lc !== 'initial' && lead.subStage && !lead.subStageId && set.subStageId === undefined) {
    const sub = config[lc as SubStageGroup]?.find((s) => s.name.toLowerCase() === String(lead.subStage).toLowerCase());
    if (sub?.id) set.subStageId = sub.id;
  }

  // 3. Converted without a recorded value → flagged, never estimated.
  const when = lead.updatedAt ? new Date(lead.updatedAt) : new Date();
  if (lc === 'converted') {
    if (typeof lead.deal?.value !== 'number' && !lead.deal) set.deal = { value: null, currency: 'INR', closedAt: when, valueMissing: true };
    if (!lead.convertedAt) set.convertedAt = when;
  }
  if (lc === 'closed' && !lead.lostAt) set.lostAt = when;

  return Object.keys(set).length ? set : null;
}
