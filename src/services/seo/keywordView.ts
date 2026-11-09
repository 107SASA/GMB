/**
 * The dashboard Keywords page's view of SeoPlan.keywordSet
 * (docs/KEYWORD_SYSTEM_PLAN.md §9). Pure — every label the owner reads is
 * built here from measured numbers, so the page never shows a number the
 * data doesn't have.
 *
 *   yours       every keyword the owner entered (measured or pending)
 *   targets     this month's 5 core + 5 rotating
 *   competitors per target: our rank next to the top 3 above us
 *   gaps        keywords competitors rank for and we don't
 */
import type { CompetitorGap, KeywordRank, KeywordVerdict, KeywordVolume, PlanKeyword } from './keywordTypes.ts';

export type Tone = 'good' | 'warn' | 'bad' | 'neutral';

export interface KeywordRowView {
  id: string;
  keyword: string;
  role: PlanKeyword['role'] | 'pending';
  roleLabel: string;
  owner: boolean;
  pinned: boolean;
  /** "2,400 / month" | "Few searches" | "—" */
  volumeText: string;
  /** Where the number comes from ("in Kolkata", "India", "dentist in Kolkata"). */
  volumeNote: string | null;
  volume: number | null;
  rankText: string;
  rank: number | null;
  /** Positions moved since last month; positive = up. */
  trend: number | null;
  topCompetitor: { name: string; rank: number } | null;
  competitorsAbove: Array<{ name: string; rank: number; reviews: number | null; rating: number | null }>;
  verdict: KeywordVerdict | 'pending';
  verdictLabel: string;
  tone: Tone;
  reason: string;
}

export interface KeywordsView {
  hasResearch: boolean;
  yours: KeywordRowView[];
  targets: KeywordRowView[];
  competitors: KeywordRowView[];
  gaps: Array<CompetitorGap & { volumeText: string }>;
  counts: { owner: number; targets: number; measured: number };
}

const fmt = (n: number) => n.toLocaleString('en-IN');

export function volumeView(v: KeywordVolume | null | undefined): { text: string; note: string | null; value: number | null } {
  if (!v || v.status === 'not_measured') return { text: '—', note: 'Checked in the next report', value: null };
  if (typeof v.city === 'number' && v.city > 0) return { text: `${fmt(v.city)} / month`, note: 'in your city', value: v.city };
  if (typeof v.country === 'number' && v.country > 0) return { text: `${fmt(v.country)} / month`, note: 'across India', value: v.country };
  if (v.area && typeof v.area.searchVolume === 'number' && v.area.searchVolume > 0) {
    return { text: 'Few searches', note: `"${v.area.term}" gets ${fmt(v.area.searchVolume)} / month in ${v.area.area}`, value: null };
  }
  return { text: 'Few searches', note: 'Google reports too few searches for this exact phrase', value: null };
}

export function rankView(r: KeywordRank | null | undefined): { text: string; value: number | null } {
  if (!r || r.status === 'not_measured') return { text: 'Checked in the next report', value: null };
  if (r.status === 'unavailable') return { text: 'Could not check this month', value: null };
  if (r.avg == null) return { text: 'Not in top 20', value: null };
  return { text: `#${Math.round(r.avg)}`, value: r.avg };
}

const VERDICT: Record<KeywordVerdict | 'pending', { label: string; tone: Tone }> = {
  quick_win: { label: 'Quick win', tone: 'good' },
  defend: { label: 'Top 3 — keep it', tone: 'good' },
  strong: { label: 'Good opportunity', tone: 'good' },
  hard: { label: 'Hard for now', tone: 'warn' },
  low_demand: { label: 'Few searches', tone: 'warn' },
  not_relevant: { label: 'Not a listed service', tone: 'bad' },
  claim_word: { label: 'Uses “best” / “top”', tone: 'warn' },
  new: { label: 'New', tone: 'neutral' },
  pending: { label: 'Checked in the next report', tone: 'neutral' },
};

const ROLE: Record<KeywordRowView['role'], string> = {
  core: 'Focus keyword',
  rotating: 'This month',
  owner: 'Tracked',
  watch: 'Watching',
  pending: 'Waiting for report',
};

export function rowView(k: PlanKeyword): KeywordRowView {
  const vol = volumeView(k.volume);
  const rank = rankView(k.rank);
  const top = (k.competitorsAbove || [])[0];
  const verdict = VERDICT[k.verdict] ?? VERDICT.new;
  return {
    id: k.id,
    keyword: k.keyword,
    role: k.role,
    roleLabel: ROLE[k.role],
    owner: !!k.owner,
    pinned: !!k.pinned,
    volumeText: vol.text,
    volumeNote: vol.note,
    volume: vol.value,
    rankText: rank.text,
    rank: rank.value,
    trend: typeof k.rankTrend === 'number' ? k.rankTrend : null,
    topCompetitor: top ? { name: top.name, rank: top.rank } : null,
    competitorsAbove: (k.competitorsAbove || []).slice(0, 3),
    verdict: k.verdict,
    verdictLabel: verdict.label,
    tone: verdict.tone,
    reason: k.reason || '',
  };
}

const key = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const roleOrder: Record<KeywordRowView['role'], number> = { core: 0, rotating: 1, owner: 2, watch: 3, pending: 4 };

export function buildKeywordsView(input: {
  keywordSet: PlanKeyword[] | null | undefined;
  gaps: CompetitorGap[] | null | undefined;
  /** Business.keywords — the owner's own list, as saved. */
  ownerKeywords: string[] | null | undefined;
}): KeywordsView {
  const set = Array.isArray(input.keywordSet) ? input.keywordSet : [];
  const rows = set.map(rowView);
  const byKey = new Map(rows.map((r) => [key(r.keyword), r]));

  // Owner keywords: measured rows, plus ones added since the last report.
  const yours: KeywordRowView[] = [];
  const seen = new Set<string>();
  for (const kw of input.ownerKeywords || []) {
    const k = key(kw);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const row = byKey.get(k);
    yours.push(row ? { ...row, owner: true } : pendingRow(kw));
  }
  for (const r of rows) if (r.owner && !seen.has(key(r.keyword))) { seen.add(key(r.keyword)); yours.push(r); }
  yours.sort((a, b) => roleOrder[a.role] - roleOrder[b.role]);

  const targets = rows.filter((r) => r.role === 'core' || r.role === 'rotating');
  return {
    hasResearch: set.length > 0,
    yours,
    targets,
    competitors: targets.filter((r) => r.competitorsAbove.length > 0 || r.rank != null),
    gaps: (input.gaps || []).map((g) => ({ ...g, volumeText: typeof g.volume === 'number' && g.volume > 0 ? `${fmt(g.volume)} / month` : 'Few searches' })),
    counts: {
      owner: yours.length,
      targets: targets.length,
      measured: rows.filter((r) => r.rank != null || r.rankText === 'Not in top 20').length,
    },
  };
}

function pendingRow(keyword: string): KeywordRowView {
  return {
    id: `pending:${key(keyword)}`,
    keyword,
    role: 'pending',
    roleLabel: ROLE.pending,
    owner: true,
    pinned: false,
    volumeText: '—',
    volumeNote: 'Checked in the next report',
    volume: null,
    rankText: 'Checked in the next report',
    rank: null,
    trend: null,
    topCompetitor: null,
    competitorsAbove: [],
    verdict: 'pending',
    verdictLabel: VERDICT.pending.label,
    tone: 'neutral',
    reason: 'Added after the last report — its searches and rank are measured in the next monthly report.',
  };
}

/**
 * In-app notice for the Monday summary when a monthly report changed the
 * keyword selection in the past week (docs/KEYWORD_SYSTEM_PLAN.md §7).
 * null when nothing changed, or the plan is older than `since`.
 */
export function keywordChangeNotice(
  plan: { activeFrom?: Date | string; keywordSet?: PlanKeyword[]; keywordSetChanges?: Array<{ keyword: string; change: string }> } | null | undefined,
  since: Date,
): { title: string; body: string } | null {
  if (!plan?.activeFrom || new Date(plan.activeFrom) < since) return null;
  const changes = plan.keywordSetChanges || [];
  const added = changes.filter((c) => c.change === 'core_added' || c.change === 'rotating_added').map((c) => c.keyword);
  const removed = changes.filter((c) => c.change === 'core_removed').map((c) => c.keyword);
  if (!added.length && !removed.length) return null;
  const focus = (plan.keywordSet || []).filter((k) => k.role === 'core').map((k) => k.keyword);
  const list = (xs: string[]) => xs.slice(0, 5).map((x) => `"${x}"`).join(', ') + (xs.length > 5 ? ` and ${xs.length - 5} more` : '');
  const parts = [
    focus.length ? `Focus keywords: ${list(focus)}.` : '',
    added.length ? `New this month: ${list(added)}.` : '',
    removed.length ? `Replaced: ${list(removed)} — the reason is in SEO Plan → Keywords.` : '',
    'Your posts and profile now target these.',
  ].filter(Boolean);
  return { title: 'Your keywords for this month', body: parts.join(' ') };
}
