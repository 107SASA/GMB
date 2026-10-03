'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronLeft, ChevronRight, Users, CheckCircle2, Percent, IndianRupee, TrendingUp, Phone, ListChecks, Layers, Sparkles } from 'lucide-react';
import { useBusiness } from '@/context/BusinessContext';

/**
 * Customer CRM — Monthly Growth Report (web). All numbers come from
 * GET /api/crm/growth-report (the same calculation the mobile app shows).
 * This component only formats them.
 */

type Change = { current: number | null; previous: number | null; percentChange: number | null; pointChange: number | null; kind: 'count' | 'money' | 'rate' };

function money(v: number | null | undefined, currency = 'INR') {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow">
      <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">{icon}{title}</h3>
      {children}
    </div>
  );
}

function Metric({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow flex items-center gap-4">
      <div className="p-3 bg-primary-fixed text-primary rounded-xl shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-on-surface-variant">{label}</p>
        <p className="text-2xl font-bold text-on-surface truncate">{value}</p>
        {sub && <p className="text-xs text-on-surface-variant mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-on-surface-variant">{label}</p>
      <p className="text-lg font-bold text-on-surface">{value}</p>
    </div>
  );
}

function changeText(c: Change, currency: string): { text: string; tone: 'up' | 'down' | 'flat' } {
  if (c.kind === 'rate') {
    if (c.pointChange == null) return { text: 'Not comparable', tone: 'flat' };
    const sign = c.pointChange > 0 ? '+' : '';
    return { text: `${sign}${c.pointChange.toFixed(1)} percentage points`, tone: c.pointChange > 0 ? 'up' : c.pointChange < 0 ? 'down' : 'flat' };
  }
  if (c.percentChange != null) {
    const sign = c.percentChange > 0 ? '+' : '';
    return { text: `${sign}${c.percentChange}%`, tone: c.percentChange > 0 ? 'up' : c.percentChange < 0 ? 'down' : 'flat' };
  }
  if ((c.previous ?? 0) === 0 && (c.current ?? 0) > 0) {
    return { text: `up from ${c.kind === 'money' ? money(0, currency) : 0}`, tone: 'up' };
  }
  return { text: 'No change', tone: 'flat' };
}

function fmtValue(c: Change, currency: string) {
  if (c.kind === 'money') return money(c.current, currency);
  if (c.kind === 'rate') return c.current == null ? '—' : `${c.current}%`;
  return c.current ?? '—';
}
function fmtPrev(c: Change, currency: string) {
  if (c.kind === 'money') return money(c.previous, currency);
  if (c.kind === 'rate') return c.previous == null ? '—' : `${c.previous}%`;
  return c.previous ?? '—';
}

export default function GrowthReport() {
  const router = useRouter();
  const params = useSearchParams();
  const month = params.get('month') || '';
  const { activeBusiness } = useBusiness();
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeBusiness?._id) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/crm/growth-report${month ? `?month=${encodeURIComponent(month)}` : ''}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setError(json.error === 'MODULE_LOCKED' ? 'The CRM is not included in your current plan.' : json.error || 'Could not load the report.'); setReport(null); return; }
        setReport(json.report);
      })
      .catch(() => { if (!cancelled) setError('Network error — the report could not be loaded.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month, activeBusiness?._id]);

  const go = (m: string) => router.replace(`/dashboard/crm/growth-report?month=${m}`);

  const r = report;
  const cur = r?.currency || 'INR';
  const m = r?.metrics;

  return (
    <div className="min-h-screen bg-surface/50 p-4 pt-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <Link href="/dashboard/crm" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          <ArrowLeft className="w-4 h-4" /> Back to CRM
        </Link>

        {/* 1. Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-on-surface-variant">{r?.business?.name || activeBusiness?.name || ''}</p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold text-on-surface tracking-tight">Monthly Growth Report</h1>
            {r && <p className="text-on-surface-variant mt-1">{r.period.label} · {r.period.rangeLabel}</p>}
          </div>
          {r && (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => go(r.period.prevKey)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold border border-outline-variant bg-surface-container-lowest">
                <ChevronLeft className="w-4 h-4" /> Previous month
              </button>
              {r.period.nextKey && (
                <button onClick={() => go(r.period.nextKey === r.period.currentKey ? 'current' : r.period.nextKey)} className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold border border-outline-variant bg-surface-container-lowest">
                  {r.period.nextKey === r.period.currentKey ? 'Current month (to date)' : 'Next month'} <ChevronRight className="w-4 h-4" />
                </button>
              )}
              {r.period.complete === false && (
                <button onClick={() => go(r.period.latestCompleteKey)} className="px-3 py-2 rounded-lg text-xs font-bold bg-primary text-white">Latest completed month</button>
              )}
            </div>
          )}
        </div>

        {loading && <div className="p-8 text-center text-on-surface-variant">Loading report…</div>}
        {error && !loading && <p className="text-sm text-error">{error}</p>}

        {r && !loading && (
          <>
            {!r.period.complete && (
              <div className="p-4 rounded-xl border border-primary-fixed-dim bg-primary-fixed/40 text-sm text-on-surface">
                This month is still in progress — these are month-to-date numbers, not a completed monthly report. They are compared with the same days of the previous month.
              </div>
            )}

            {/* Summary */}
            <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow space-y-3">
              <div>
                <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">What happened</p>
                {r.summary.data.map((s: string) => <p key={s} className="text-on-surface">{s}</p>)}
              </div>
              {r.summary.interpretation.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">What the numbers suggest</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {r.summary.interpretation.map((s: string) => <li key={s} className="text-sm text-on-surface">{s}</li>)}
                  </ul>
                </div>
              )}
            </div>

            {/* 2. Key metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <Metric icon={<Users className="w-6 h-6" />} label="Leads received" value={m.leadsReceived} />
              <Metric icon={<CheckCircle2 className="w-6 h-6" />} label="Won" value={m.won} sub={m.wonWithoutValue > 0 ? `${m.wonWithoutValue} without a deal value` : undefined} />
              <Metric icon={<Percent className="w-6 h-6" />} label="Conversion rate" value={m.conversionRate == null ? '—' : `${m.conversionRate}%`}
                sub={m.wonFromEarlierLeads > 0 ? `Includes ${m.wonFromEarlierLeads} win(s) from earlier leads` : 'Won ÷ leads received'} />
              <Metric icon={<IndianRupee className="w-6 h-6" />} label="Recorded revenue" value={money(m.revenue, cur)} sub={m.revenue === 0 ? `${money(0, cur)} recorded` : 'From Won deal values'} />
              <Metric icon={<TrendingUp className="w-6 h-6" />} label="ROI" value={r.roi.roiPercent == null ? 'Unavailable' : `${r.roi.roiPercent}%`}
                sub={r.roi.roiPercent == null ? r.roi.note : `Revenue ${money(r.roi.revenue, cur)} vs investment ${money(r.roi.investment, cur)}`} />
            </div>
            {r.mixedCurrencies && <p className="text-xs text-on-surface-variant">Deals were recorded in more than one currency; revenue adds the amounts as recorded.</p>}

            {/* 3. Month-over-month */}
            <Section icon={<TrendingUp className="w-5 h-5" />} title={`Compared with ${r.comparison.previousLabel}`}>
              {r.comparison.available ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="text-left text-xs text-on-surface-variant uppercase"><th className="py-2">Metric</th><th>{r.period.complete ? r.period.label : 'This month so far'}</th><th>{r.comparison.previousLabel}</th><th>Change</th></tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {([['Leads', r.comparison.leads], ['Won', r.comparison.won], ['Recorded revenue', r.comparison.revenue], ['Conversion rate', r.comparison.conversionRate], ['Follow-up completion', r.comparison.followUpCompletionRate]] as Array<[string, Change]>).map(([label, c]) => {
                        const ch = changeText(c, cur);
                        return (
                          <tr key={label}>
                            <td className="py-2 font-semibold text-on-surface">{label}</td>
                            <td>{fmtValue(c, cur)}</td>
                            <td>{fmtPrev(c, cur)}</td>
                            <td className={ch.tone === 'up' ? 'text-secondary font-semibold' : ch.tone === 'down' ? 'text-error font-semibold' : 'text-on-surface-variant'}>{ch.text}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-on-surface-variant">{r.comparison.note}</p>
              )}
            </Section>

            {/* 4. Sources */}
            <Section icon={<Layers className="w-5 h-5" />} title="Lead source performance">
              {m.sources.length === 0 ? (
                <p className="text-sm text-on-surface-variant">No leads or wins in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[480px]">
                    <thead>
                      <tr className="text-left text-xs text-on-surface-variant uppercase"><th className="py-2">Source</th><th>Leads</th><th>Won</th><th>Revenue</th><th>Conversion</th></tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                      {m.sources.map((s: any) => (
                        <tr key={s.source}>
                          <td className="py-2 font-semibold text-on-surface">{s.source}</td>
                          <td>{s.leads}</td>
                          <td>{s.won}</td>
                          <td>{money(s.revenue, cur)}</td>
                          <td>{s.conversionRate == null ? '—' : `${s.conversionRate}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 5. Follow-ups */}
              <Section icon={<ListChecks className="w-5 h-5" />} title="Follow-up performance">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <Stat label="Due this period" value={m.followUps.due} />
                  <Stat label="Completed" value={m.followUps.completed} />
                  <Stat label="Missed (not completed)" value={m.followUps.missed} />
                  {!r.period.complete && <Stat label="Still upcoming" value={m.followUps.upcoming} />}
                  <Stat label="Completion rate" value={m.followUps.completionRate == null ? '—' : `${m.followUps.completionRate}%`} />
                </div>
                <div className="mt-4 pt-4 border-t border-outline-variant">
                  <p className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Right now</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Stat label="Overdue follow-ups" value={r.attention.overdueTasks} />
                    <Stat label={`Leads not contacted for ${r.attention.staleDays}+ days`} value={r.attention.leadsNotContacted} />
                  </div>
                </div>
              </Section>

              {/* 6. Calls */}
              <Section icon={<Phone className="w-5 h-5" />} title="Call performance">
                {m.calls.measured ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    <Stat label="Calls received" value={m.calls.received} />
                    <Stat label="Known callers" value={m.calls.knownCallers} />
                    <Stat label="Unknown callers" value={m.calls.unknownCallers} />
                    <Stat label="Saved as leads" value={m.calls.savedAsLeads} />
                    <Stat label="Linked to existing leads" value={m.calls.linkedToExisting} />
                    <Stat label="Dismissed" value={m.calls.dismissed} />
                    <Stat label="Missed calls" value={m.calls.missed} />
                    <Stat label="Leads from calls" value={m.calls.leadsFromCalls} />
                    <Stat label="Won from calls" value={m.calls.wonFromCalls} />
                    <Stat label="Revenue from call leads" value={money(m.calls.revenueFromCalls, cur)} />
                  </div>
                ) : (
                  <p className="text-sm text-on-surface-variant">Not measured — call stats appear once a call-tracking number (Twilio) is connected.</p>
                )}
              </Section>
            </div>

            {/* 7. Pipeline */}
            <Section icon={<Layers className="w-5 h-5" />} title="Open pipeline (right now)">
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Open" value={r.pipeline.open} />
                <Stat label="Active" value={r.pipeline.active} />
                <Stat label="Total open pipeline" value={r.pipeline.total} />
              </div>
              <p className="text-xs text-on-surface-variant mt-3">Open + Active leads, excluding Won, Lost and Inactive.</p>
            </Section>

            {/* 8. Highlights */}
            {r.highlights.length > 0 && (
              <Section icon={<Sparkles className="w-5 h-5" />} title="Highlights">
                <ul className="space-y-1.5">
                  {r.highlights.map((h: string) => <li key={h} className="text-sm text-on-surface">• {h}</li>)}
                </ul>
              </Section>
            )}

            {/* 9. Footer */}
            <p className="text-xs text-on-surface-variant text-center pb-6">{r.footer}</p>
          </>
        )}
      </div>
    </div>
  );
}
