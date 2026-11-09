'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

/**
 * The SEO Plan page's Keywords tab — what the business is measured and worked
 * on (docs/KEYWORD_SYSTEM_PLAN.md §9). Everything shown comes from the monthly
 * report: Google Ads search volume, Google Maps rank, the businesses above,
 * and Google Business Profile searches. Nothing here is an estimate.
 */

type Tone = 'good' | 'warn' | 'bad' | 'neutral';
interface Row {
  id: string;
  keyword: string;
  role: 'core' | 'rotating' | 'owner' | 'watch' | 'pending';
  roleLabel: string;
  owner: boolean;
  pinned: boolean;
  volumeText: string;
  volumeNote: string | null;
  rankText: string;
  rank: number | null;
  trend: number | null;
  topCompetitor: { name: string; rank: number } | null;
  competitorsAbove: Array<{ name: string; rank: number; reviews: number | null; rating: number | null }>;
  verdictLabel: string;
  tone: Tone;
  reason: string;
}
interface Data {
  hasResearch: boolean;
  yours: Row[];
  targets: Row[];
  competitors: Row[];
  gaps: Array<{ keyword: string; volumeText: string; competitor: string; competitorRank: number | null }>;
  searchTerms: Array<{ keyword: string; impressions: number }>;
  searchTermsMonth: string | null;
  research: { candidates: number; withVolume: number; rankChecked: number; ranAt: string } | null;
  googleConnected: boolean;
}

const TONE: Record<Tone, string> = {
  good: 'bg-primary-fixed text-primary',
  warn: 'bg-warning/15 text-on-surface',
  bad: 'bg-error-container text-on-error-container',
  neutral: 'bg-surface-container text-on-surface-variant',
};
const TABS = [
  { id: 'yours', label: 'Your keywords' },
  { id: 'targets', label: 'This month’s targets' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'searches', label: 'Customer searches' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}

function Trend({ value }: { value: number | null }) {
  if (value == null || value === 0) return <span className="text-outline">—</span>;
  const up = value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? 'text-primary' : 'text-error'}`}>
      <MaterialIcon name={up ? 'arrow_upward' : 'arrow_downward'} size={14} />
      {Math.abs(Math.round(value))}
    </span>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`text-xs font-semibold text-outline uppercase tracking-wider pb-3 pr-4 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function KeywordTable({ rows, onPin, busy, showRole }: { rows: Row[]; onPin: (r: Row) => void; busy: string | null; showRole: boolean }) {
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="border-b border-outline-variant">
            <Th>Keyword</Th>
            <Th right>Searches</Th>
            <Th right>Your rank</Th>
            <Th right>Trend</Th>
            <Th>#1 on Google</Th>
            <Th>Status</Th>
            <Th>{''}</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="py-3 pr-4">
                <p className="font-medium text-on-surface">{r.keyword}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {showRole && r.role !== 'owner' && <Badge tone="neutral">{r.roleLabel}</Badge>}
                  {r.owner && !showRole && <Badge tone="neutral">Yours</Badge>}
                  {r.pinned && <Badge tone="good">Pinned</Badge>}
                </div>
                {r.reason && <p className="text-xs text-on-surface-variant mt-1.5 max-w-md leading-relaxed">{r.reason}</p>}
              </td>
              <td className="py-3 pr-4 text-right">
                <p className="font-semibold text-on-surface whitespace-nowrap">{r.volumeText}</p>
                {r.volumeNote && <p className="text-[11px] text-outline mt-0.5 max-w-[180px] ml-auto">{r.volumeNote}</p>}
              </td>
              <td className="py-3 pr-4 text-right font-semibold text-on-surface whitespace-nowrap">{r.rankText}</td>
              <td className="py-3 pr-4 text-right"><Trend value={r.trend} /></td>
              <td className="py-3 pr-4 text-on-surface-variant">
                {r.topCompetitor ? <span>{r.topCompetitor.name} <span className="text-outline">(#{r.topCompetitor.rank})</span></span> : <span className="text-outline">—</span>}
              </td>
              <td className="py-3 pr-4"><Badge tone={r.tone}>{r.verdictLabel}</Badge></td>
              <td className="py-3 text-right">
                {r.role !== 'pending' && (
                  <button
                    onClick={() => onPin(r)}
                    disabled={busy === r.id}
                    title={r.pinned ? 'Return to automatic selection' : 'Always keep as a focus keyword'}
                    className="text-xs font-semibold text-primary hover:underline disabled:opacity-50 whitespace-nowrap"
                  >
                    {r.pinned ? 'Unpin' : 'Pin'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <MaterialIcon name={icon} size={28} className="text-outline mx-auto" />
      <p className="text-sm font-semibold text-on-surface mt-2">{title}</p>
      <p className="text-xs text-on-surface-variant mt-1 max-w-md mx-auto leading-relaxed">{children}</p>
    </div>
  );
}

export default function KeywordsPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('yours');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/keywords');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load keywords.');
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Could not load keywords.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const togglePin = async (r: Row) => {
    setBusy(r.id);
    setNotice(null);
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: r.pinned ? 'unpin' : 'pin', id: r.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not update.');
      setNotice(json.pinned
        ? `"${r.keyword}" is pinned — it stays a focus keyword from the next report.`
        : `"${r.keyword}" is back to automatic selection.`);
      await load();
    } catch (e: any) {
      setNotice(e?.message || 'Could not update.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="py-12 flex items-center justify-center">
        <MaterialIcon name="progress_activity" size={32} className="animate-spin text-primary" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-on-surface-variant py-6">{error || 'Could not load keywords.'}</p>
    );
  }

  const waiting = !data.hasResearch;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-on-surface-variant max-w-2xl leading-relaxed">
            What people search on Google, how many search it each month, where you rank on Google Maps and who is above you.
            We pick your focus keywords every month from these numbers — your posts, profile and review replies use them.
          </p>
        </div>
        <Link href="/dashboard/settings" className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1">
          <MaterialIcon name="edit" size={14} /> Add or remove your keywords
        </Link>
      </div>

      {data.research && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Keywords researched', value: data.research.candidates },
            { label: 'With Google search data', value: data.research.withVolume },
            { label: 'Rank checked on Maps', value: data.research.rankChecked },
            { label: 'Last checked', value: new Date(data.research.ranAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) },
          ].map((s) => (
            <div key={s.label} className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4">
              <p className="text-xl font-bold text-on-surface">{typeof s.value === 'number' ? s.value.toLocaleString('en-IN') : s.value}</p>
              <p className="text-xs text-on-surface-variant mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {waiting && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 flex gap-3">
          <MaterialIcon name="schedule" size={20} className="text-primary shrink-0 mt-0.5" />
          <p className="text-sm text-on-surface-variant leading-relaxed">
            {data.googleConnected
              ? 'Your keywords are researched in your next full report: search volume from Google, your rank on Google Maps and the businesses above you. Nothing to do — it runs automatically.'
              : 'Connect your Google Business Profile to start. Your first full report then researches your keywords automatically.'}
          </p>
        </div>
      )}

      {notice && <p className="text-sm text-on-surface bg-primary-fixed/40 rounded-lg px-4 py-2">{notice}</p>}

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant">
        <div className="flex overflow-x-auto border-b border-outline-variant px-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px ${tab === t.id ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 md:p-6">
          {tab === 'yours' && (
            data.yours.length === 0
              ? <Empty icon="label" title="No keywords added yet">Add up to 20 keywords in Settings. We also research hundreds more for you every month.</Empty>
              : <>
                  <p className="text-xs text-on-surface-variant mb-4">Every keyword you added, measured every month. Good ones become focus keywords automatically; weak ones stay tracked with the reason.</p>
                  <KeywordTable rows={data.yours} onPin={togglePin} busy={busy} showRole />
                </>
          )}

          {tab === 'targets' && (
            data.targets.length === 0
              ? <Empty icon="target" title="Targets are picked in your next full report">We choose 5 focus keywords (kept at least 90 days) and 5 keywords for this month, from real search and ranking data.</Empty>
              : <>
                  <p className="text-xs text-on-surface-variant mb-4">Focus keywords stay for at least 90 days so rankings have time to move; “This month” keywords change monthly. Pin one to keep it.</p>
                  <KeywordTable rows={data.targets} onPin={togglePin} busy={busy} showRole={false} />
                </>
          )}

          {tab === 'competitors' && (
            <div className="space-y-6">
              {data.competitors.length === 0
                ? <Empty icon="groups" title="No competitor data yet">Your next full report shows who ranks above you for each target keyword.</Empty>
                : (
                  <div className="overflow-x-auto -mx-2 px-2">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>
                        <tr className="border-b border-outline-variant">
                          <Th>Keyword</Th><Th right>You</Th><Th>#1</Th><Th>#2</Th><Th>#3</Th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-outline-variant">
                        {data.competitors.map((r) => (
                          <tr key={r.id} className="align-top">
                            <td className="py-3 pr-4">
                              <p className="font-medium text-on-surface">{r.keyword}</p>
                              <p className="text-[11px] text-outline">{r.volumeText}</p>
                            </td>
                            <td className="py-3 pr-4 text-right font-bold text-on-surface whitespace-nowrap">{r.rankText}</td>
                            {[0, 1, 2].map((i) => {
                              const c = r.competitorsAbove[i];
                              return (
                                <td key={i} className="py-3 pr-4 text-on-surface-variant">
                                  {c ? (
                                    <>
                                      <p className="text-on-surface">{c.name}</p>
                                      <p className="text-[11px] text-outline">
                                        #{c.rank}{c.rating != null ? ` · ${c.rating}★` : ''}{c.reviews != null ? ` · ${c.reviews.toLocaleString('en-IN')} reviews` : ''}
                                      </p>
                                    </>
                                  ) : <span className="text-outline">—</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              <div>
                <h3 className="font-bold text-on-surface text-sm">Competitors rank, you don’t</h3>
                <p className="text-xs text-on-surface-variant mt-0.5 mb-3">A competitor is in the top 3 (or its website ranks) and you are not in the top 20.</p>
                {data.gaps.length === 0
                  ? <p className="text-xs text-outline">None found in the last report.</p>
                  : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {data.gaps.map((g) => (
                        <div key={g.keyword} className="rounded-xl border border-outline-variant p-4">
                          <div className="flex items-start justify-between gap-3">
                            <p className="font-semibold text-on-surface text-sm">{g.keyword}</p>
                            <span className="shrink-0 text-[11px] font-semibold text-on-surface-variant">{g.volumeText}</span>
                          </div>
                          <p className="text-xs text-on-surface-variant mt-1">
                            {g.competitor}{g.competitorRank != null ? ` is #${g.competitorRank} on Google Maps` : '’s website ranks for this'}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            </div>
          )}

          {tab === 'searches' && (
            data.searchTerms.length === 0
              ? <Empty icon="search" title="No customer searches yet">Google reports the searches that showed your profile once a month, after your profile is connected.</Empty>
              : <>
                  <p className="text-xs text-on-surface-variant mb-4">
                    What customers typed when Google showed your profile{data.searchTermsMonth ? ` (${data.searchTermsMonth})` : ''}. Reported by Google Business Profile.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-outline-variant"><Th>Search</Th><Th right>Times shown</Th></tr></thead>
                      <tbody className="divide-y divide-outline-variant">
                        {data.searchTerms.map((t) => (
                          <tr key={t.keyword}>
                            <td className="py-2.5 pr-4 text-on-surface">{t.keyword}</td>
                            <td className="py-2.5 text-right font-semibold text-on-surface">{t.impressions.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
          )}
        </div>
      </div>
    </div>
  );
}
