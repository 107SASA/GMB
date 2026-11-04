/**
 * What the previous SEO plan did and what changed since — the history the
 * next plan is built on. Pure.
 *
 * Completion and outcome are separate facts:
 *   completion  completed (EXECUTED / VERIFIED) · pending (PLANNED / READY)
 *               · blocked (BLOCKED — a prerequisite is missing)
 *   outcome     not_completed · not_yet_measurable (done < 14 days before
 *               this audit, or no later measurement) · positive / negative /
 *               no_change (comparable keywords moved, measured independently)
 *               · insufficient_evidence (fewer than 2 comparable keywords)
 * An outcome is a correlation over the period, never proof the action caused it.
 */
import type { MeasurementChange } from './measurements.ts';

export const OUTCOME_MIN_DAYS = 14;

export interface ActionRecord {
  findingId: string;
  description: string;
  status: 'PLANNED' | 'READY' | 'EXECUTED' | 'VERIFIED' | 'BLOCKED' | string;
  capability: string | null;
  executedAt?: string | null;
  verifiedAt?: string | null;
  statusReason?: string | null;
}

export type Completion = 'completed' | 'pending' | 'blocked';
export type Outcome = 'not_completed' | 'not_yet_measurable' | 'positive' | 'negative' | 'no_change' | 'insufficient_evidence';

export interface ActionOutcome {
  findingId: string;
  action: string;
  status: string;
  completion: Completion;
  outcome: Outcome;
  basis: string;
}

export interface PreviousPlan {
  version: number;
  createdAt: string;
  primaryKeywords: string[];
  secondaryKeywords: string[];
  postThemes: Array<{ theme: string; keyword?: string }>;
  priorities: string[];
}

export interface StrategyHistory {
  previousPlanVersion: number | null;
  previousPlanAt: string | null;
  measurementPeriod: { start: string | null; end: string };
  actions: ActionOutcome[];
  keywords: { improving: MeasurementChange[]; declining: MeasurementChange[]; stable: MeasurementChange[]; new: MeasurementChange[]; notComparable: MeasurementChange[] };
  /** Previous primary keywords and how each one moved (absent = not re-measured). */
  previousPriorities: Array<{ keyword: string; result: string }>;
}

const completionOf = (status: string): Completion =>
  status === 'EXECUTED' || status === 'VERIFIED' ? 'completed' : status === 'BLOCKED' ? 'blocked' : 'pending';

const comparable = (c: MeasurementChange) => c.change === 'improved' || c.change === 'declined' || c.change === 'stable';

function outcomeFrom(changes: MeasurementChange[], scope: string): { outcome: Outcome; basis: string } {
  const cmp = changes.filter(comparable);
  if (cmp.length < 2) return { outcome: 'insufficient_evidence', basis: `Only ${cmp.length} comparable keyword measurement${cmp.length === 1 ? '' : 's'} ${scope}` };
  const up = cmp.filter((c) => c.change === 'improved').length;
  const down = cmp.filter((c) => c.change === 'declined').length;
  const basis = `${scope}: ${up} improved, ${down} declined, ${cmp.length - up - down} stable of ${cmp.length} comparable measurements (correlation, not proof of cause)`;
  return { outcome: up > down ? 'positive' : down > up ? 'negative' : 'no_change', basis };
}

export function buildStrategyHistory(input: {
  previousPlan: PreviousPlan | null;
  previousAuditAt: string | null;
  actions: ActionRecord[];
  changes: MeasurementChange[];
  /** Keywords targeted by Google posts during the period (Post.contentMeta.keyword). */
  postKeywords: string[];
  now: Date;
}): StrategyHistory {
  const nowMs = input.now.getTime();
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const postSet = new Set(input.postKeywords.map(norm));

  const actions: ActionOutcome[] = input.actions.map((a) => {
    const completion = completionOf(a.status);
    const base = { findingId: a.findingId, action: a.description, status: a.status, completion };
    if (completion !== 'completed') {
      return { ...base, outcome: 'not_completed' as const, basis: a.statusReason || (completion === 'blocked' ? 'Blocked' : 'Not carried out yet') };
    }
    const doneAt = a.executedAt || a.verifiedAt;
    if (doneAt && nowMs - new Date(doneAt).getTime() < OUTCOME_MIN_DAYS * 86_400_000) {
      return { ...base, outcome: 'not_yet_measurable' as const, basis: `Done ${new Date(doneAt).toISOString().slice(0, 10)} — Google needs more time before a fair re-measurement` };
    }
    if (!input.previousAuditAt) {
      return { ...base, outcome: 'not_yet_measurable' as const, basis: 'No earlier measurement to compare with' };
    }
    if (a.capability === 'google_posts' && postSet.size) {
      const linked = input.changes.filter((c) => postSet.has(norm(c.keyword)));
      if (linked.length) return { ...base, ...outcomeFrom(linked, 'Keywords the posts targeted') };
    }
    return { ...base, ...outcomeFrom(input.changes, 'All tracked keywords') };
  });

  const by = (k: MeasurementChange['change']) => input.changes.filter((c) => c.change === k);
  const prevPriorities = (input.previousPlan?.primaryKeywords || []).map((kw) => {
    const rows = input.changes.filter((c) => norm(c.keyword) === norm(kw));
    const c = rows.find(comparable) || rows[0];
    return { keyword: kw, result: c ? `${c.before} → ${c.after} (${c.change.replace('_', ' ')})` : 'not re-measured this month' };
  });

  return {
    previousPlanVersion: input.previousPlan?.version ?? null,
    previousPlanAt: input.previousPlan?.createdAt ?? null,
    measurementPeriod: { start: input.previousAuditAt, end: input.now.toISOString() },
    actions,
    keywords: { improving: by('improved'), declining: by('declined'), stable: by('stable'), new: by('new'), notComparable: by('not_comparable') },
    previousPriorities: prevPriorities,
  };
}

const label = (c: MeasurementChange) => `"${c.keyword}"${c.areaId !== 'area:address' ? ` in ${c.area}` : ''}: ${c.before} → ${c.after}`;

/** Measured lines for the SEO Brain prompt — the only history it may state. */
export function historyLines(h: StrategyHistory): string[] {
  const lines: string[] = [];
  if (h.previousPlanVersion != null) lines.push(`Previous SEO plan: version ${h.previousPlanVersion} (${String(h.previousPlanAt).slice(0, 10)})`);
  for (const p of h.previousPriorities.slice(0, 5)) lines.push(`Last plan's priority keyword "${p.keyword}": ${p.result}`);
  for (const c of h.keywords.improving.slice(0, 4)) lines.push(`Improved — ${label(c)}`);
  for (const c of h.keywords.declining.slice(0, 4)) lines.push(`Declined — ${label(c)}`);
  const done = h.actions.filter((a) => a.completion === 'completed');
  const pending = h.actions.filter((a) => a.completion !== 'completed');
  for (const a of done.slice(0, 5)) lines.push(`Completed action "${a.action}" — outcome: ${a.outcome.replace(/_/g, ' ')} (${a.basis})`);
  if (pending.length) lines.push(`Actions still open: ${pending.slice(0, 5).map((a) => `"${a.action}" (${a.status.toLowerCase()})`).join('; ')}`);
  return lines.slice(0, 16);
}

/** What changed between two plan versions (stored on the new SeoPlan). */
export function planChanges(prev: PreviousPlan | null, next: { primaryKeywords: string[]; postThemes: Array<{ theme: string }> }): { added: string[]; removed: string[]; kept: string[]; themesChanged: boolean } {
  const p = new Set((prev?.primaryKeywords || []).map((k) => k.toLowerCase()));
  const n = new Set(next.primaryKeywords.map((k) => k.toLowerCase()));
  return {
    added: next.primaryKeywords.filter((k) => !p.has(k.toLowerCase())),
    removed: (prev?.primaryKeywords || []).filter((k) => !n.has(k.toLowerCase())),
    kept: next.primaryKeywords.filter((k) => p.has(k.toLowerCase())),
    themesChanged: JSON.stringify((prev?.postThemes || []).map((t) => t.theme)) !== JSON.stringify(next.postThemes.map((t) => t.theme)),
  };
}
