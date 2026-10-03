// Shared types, defaults and validation for the configurable Lead Stages
// (sales pipeline) feature. The four MAIN stages are fixed and map 1:1 to
// Lead.lifeCycleStage ('initial' | 'active' | 'converted' | 'closed').
// Owners can add/edit/reorder/delete SUB-stages inside every main stage
// except 'initial'.

export interface LeadSubStage {
  /**
   * Stable identifier (Oct 2026) — leads store it as Lead.subStageId, so a
   * rename never orphans leads, and web + mobile refer to the same stage.
   * Assigned on save; stored configs from before it existed get a
   * deterministic id (group + name) until their next save.
   */
  id?: string;
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
    { id: 'active-new', name: 'New', color: 'sky' },
    { id: 'active-exploring', name: 'Exploring', color: 'stone' },
    { id: 'active-interested', name: 'Interested', color: 'orange' },
    { id: 'active-follow-up', name: 'Follow Up', color: 'amber' },
    { id: 'active-prospect', name: 'Prospect', color: 'teal' },
  ],
  converted: [
    { id: 'converted-sales-closed', name: 'Sales Closed', color: 'emerald' },
  ],
  closed: [
    { id: 'closed-lost', name: 'Lost', color: 'rose' },
    { id: 'closed-no-need', name: 'No Need', color: 'slate' },
    { id: 'closed-budget-issues', name: 'Budget Issues', color: 'amber' },
  ],
};

export type LifeCycleStage = 'initial' | SubStageGroup;
export const LIFECYCLE_STAGES: LifeCycleStage[] = ['initial', 'active', 'converted', 'closed'];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'stage';
/** Deterministic id for a sub-stage that has none yet. */
export const defaultSubStageId = (group: SubStageGroup, name: string) => `${group}-${slug(name)}`;
function withIds(group: SubStageGroup, subs: LeadSubStage[]): LeadSubStage[] {
  // Existing ids are reserved first, so a NEW sub-stage can never take the id
  // of a renamed one (e.g. "New" renamed to "Fresh", then a new "New" added).
  const valid = (s: LeadSubStage) => typeof s.id === 'string' && ID_RE.test(s.id);
  const used = new Set<string>();
  const kept = subs.map((s) => {
    if (!valid(s) || used.has(s.id!)) return null;
    used.add(s.id!);
    return s.id!;
  });
  return subs.map((s, i) => {
    let id = kept[i];
    if (!id) {
      id = defaultSubStageId(group, s.name);
      let n = 2;
      while (used.has(id)) id = `${defaultSubStageId(group, s.name)}-${n++}`;
      used.add(id);
    }
    return { id, name: s.name, color: s.color };
  });
}

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
    const rawId = (item as any).id;
    out.push({ ...(typeof rawId === 'string' && ID_RE.test(rawId) ? { id: rawId } : {}), name, color });
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

/**
 * Gives every sub-stage a stable id. A sub-stage without an id that matches a
 * previously stored one by name (same group) keeps that one's id, so a save
 * from an older client never re-keys existing stages.
 */
export function assignSubStageIds(next: LeadStagesConfig, previous?: LeadStagesConfig | null): LeadStagesConfig {
  const out = { ...next } as LeadStagesConfig;
  for (const g of SUB_STAGE_GROUPS) {
    const prev = previous?.[g] || [];
    // An id still carried explicitly by another sub-stage (e.g. a renamed one)
    // is never handed out again by name.
    const explicit = new Set(next[g].map((s) => s.id).filter(Boolean));
    out[g] = withIds(g, next[g].map((s) => {
      if (s.id) return s;
      const byName = prev.find((p) => p.name.toLowerCase() === s.name.toLowerCase())?.id;
      return { ...s, id: byName && !explicit.has(byName) ? byName : undefined };
    }));
  }
  return out;
}

/** Merges whatever is stored on the business with defaults; every sub-stage has an id. */
export function resolveLeadStagesConfig(stored: any): LeadStagesConfig {
  if (!stored) return DEFAULT_LEAD_STAGES;
  const pick = (g: SubStageGroup): LeadSubStage[] => (Array.isArray(stored[g]) ? stored[g] : DEFAULT_LEAD_STAGES[g])
    .filter((s: any) => s && typeof s.name === 'string')
    .map((s: any) => ({ id: s.id, name: s.name, color: s.color }));
  return {
    initialLabel: typeof stored.initialLabel === 'string' && stored.initialLabel.trim()
      ? stored.initialLabel.trim()
      : DEFAULT_LEAD_STAGES.initialLabel,
    active: withIds('active', pick('active')),
    converted: withIds('converted', pick('converted')),
    closed: withIds('closed', pick('closed')),
  };
}

export interface ResolvedStage {
  lifeCycleStage: LifeCycleStage;
  subStageId: string | null;
  subStage: string | null;
}

/**
 * The canonical stage for a request: lifeCycleStage + (optional) sub-stage,
 * looked up by stable id first, then by name within that group. Returns null
 * when the sub-stage does not belong to the given lifecycle group.
 */
export function resolveStage(
  config: LeadStagesConfig,
  input: { lifeCycleStage: string; subStageId?: string | null; subStage?: string | null },
): ResolvedStage | null {
  const lc = input.lifeCycleStage as LifeCycleStage;
  if (!LIFECYCLE_STAGES.includes(lc)) return null;
  if (lc === 'initial') return { lifeCycleStage: 'initial', subStageId: null, subStage: null };
  if (!input.subStageId && !input.subStage) return { lifeCycleStage: lc, subStageId: null, subStage: null };
  const subs = config[lc];
  const hit = (input.subStageId && subs.find((s) => s.id === input.subStageId))
    || (input.subStage && subs.find((s) => s.name.toLowerCase() === String(input.subStage).toLowerCase()));
  return hit ? { lifeCycleStage: lc, subStageId: hit.id!, subStage: hit.name } : null;
}

/** Where a lead currently sits: its sub-stage matched by id, else by name (legacy rows). */
export function currentSubStage(config: LeadStagesConfig, lead: { lifeCycleStage?: string | null; subStageId?: string | null; subStage?: string | null }): LeadSubStage | null {
  const lc = (lead.lifeCycleStage || 'initial') as LifeCycleStage;
  if (lc === 'initial') return null;
  const subs = config[lc] || [];
  return subs.find((s) => !!lead.subStageId && s.id === lead.subStageId)
    || subs.find((s) => !!lead.subStage && s.name.toLowerCase() === String(lead.subStage).toLowerCase())
    || null;
}

/**
 * LEGACY clients (app builds before Oct 2026) send only `pipelineStage` (a
 * Kanban column name). Compatibility shim only: an exact sub-stage name match
 * in any group wins; otherwise null and the caller falls back to the old
 * inference. New clients always send lifeCycleStage + subStageId.
 */
export function legacyColumnToStage(config: LeadStagesConfig, column: string | null | undefined): ResolvedStage | null {
  if (!column) return null;
  const key = column.trim().toLowerCase();
  for (const g of SUB_STAGE_GROUPS) {
    const hit = config[g].find((s) => s.name.toLowerCase() === key);
    if (hit) return { lifeCycleStage: g, subStageId: hit.id!, subStage: hit.name };
  }
  return null;
}
