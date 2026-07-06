// Shared types, defaults and validation for the configurable Lead Stages
// (sales pipeline) feature. The four MAIN stages are fixed and map 1:1 to
// Lead.lifeCycleStage ('initial' | 'active' | 'converted' | 'closed').
// Owners can add/edit/reorder/delete SUB-stages inside every main stage
// except 'initial'.

export interface LeadSubStage {
  name: string;
  color: string; // token from SUB_STAGE_COLORS
}

export interface LeadStagesConfig {
  initialLabel: string;
  active: LeadSubStage[];
  converted: LeadSubStage[];
  closed: LeadSubStage[];
}

export type SubStageGroup = 'active' | 'converted' | 'closed';

export const SUB_STAGE_GROUPS: SubStageGroup[] = ['active', 'converted', 'closed'];

export const MAX_SUB_STAGES = 25;
export const MAX_NAME_LENGTH = 40;

// Pastel tokens rendered by the UI; stored on the sub-stage document.
export const SUB_STAGE_COLORS = [
  'slate', 'stone', 'rose', 'orange', 'amber',
  'lime', 'emerald', 'teal', 'sky', 'indigo', 'violet', 'pink',
] as const;

export const DEFAULT_LEAD_STAGES: LeadStagesConfig = {
  initialLabel: 'Open',
  active: [
    { name: 'New', color: 'sky' },
    { name: 'Exploring', color: 'stone' },
    { name: 'Interested', color: 'orange' },
    { name: 'Follow Up', color: 'amber' },
    { name: 'Prospect', color: 'teal' },
  ],
  converted: [
    { name: 'Sales Closed', color: 'emerald' },
  ],
  closed: [
    { name: 'Lost', color: 'rose' },
    { name: 'No Need', color: 'slate' },
    { name: 'Budget Issues', color: 'amber' },
  ],
};

function sanitizeGroup(value: unknown): LeadSubStage[] | null {
  if (!Array.isArray(value) || value.length > MAX_SUB_STAGES) return null;
  const seen = new Set<string>();
  const out: LeadSubStage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const name = typeof (item as any).name === 'string' ? (item as any).name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) return null;
    const key = name.toLowerCase();
    if (seen.has(key)) return null; // duplicate names within a group
    seen.add(key);
    const rawColor = (item as any).color;
    const color = SUB_STAGE_COLORS.includes(rawColor) ? rawColor : 'slate';
    out.push({ name, color });
  }
  return out;
}

/**
 * Validates a client-supplied config. Returns the cleaned config,
 * or null when the payload is malformed.
 */
export function sanitizeLeadStagesConfig(value: unknown): LeadStagesConfig | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;

  const initialLabel = typeof v.initialLabel === 'string' ? v.initialLabel.trim() : '';
  if (!initialLabel || initialLabel.length > MAX_NAME_LENGTH) return null;

  const active = sanitizeGroup(v.active);
  const converted = sanitizeGroup(v.converted);
  const closed = sanitizeGroup(v.closed);
  if (!active || !converted || !closed) return null;

  return { initialLabel, active, converted, closed };
}

/** Merges whatever is stored on the business with defaults. */
export function resolveLeadStagesConfig(stored: any): LeadStagesConfig {
  if (!stored) return DEFAULT_LEAD_STAGES;
  return {
    initialLabel: typeof stored.initialLabel === 'string' && stored.initialLabel.trim()
      ? stored.initialLabel.trim()
      : DEFAULT_LEAD_STAGES.initialLabel,
    active: Array.isArray(stored.active) ? stored.active : DEFAULT_LEAD_STAGES.active,
    converted: Array.isArray(stored.converted) ? stored.converted : DEFAULT_LEAD_STAGES.converted,
    closed: Array.isArray(stored.closed) ? stored.closed : DEFAULT_LEAD_STAGES.closed,
  };
}
