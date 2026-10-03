'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart3, TrendingUp, Users, Target, CheckCircle2, IndianRupee, Phone, CalendarRange, ChevronRight } from 'lucide-react';

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
];

const STAGE_LABEL: Record<string, string> = { initial: 'Open', active: 'Active', converted: 'Converted (Won)', closed: 'Closed (Lost)' };

function money(v: number | null | undefined, currency = 'INR') {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}

function Card({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
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

/**
 * Customer CRM analytics. Converted = lifeCycleStage 'converted'. Revenue,
 * averages and ROI come from /api/crm/roi (recorded deal values only); ROI %
 * appears only when the owner has entered what they spend.
 */
export default function CRMAnalytics({ leads }: { leads: any[] }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');
  const [editingInvestment, setEditingInvestment] = useState(false);
  const [investment, setInvestment] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/crm/roi?days=${days}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Could not load analytics.'); return; }
      setData(json);
    } catch {
      setError('Network error — analytics could not be loaded.');
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const pipeline = useMemo(() => {
    const stages: Record<string, number> = { initial: 0, active: 0, converted: 0, closed: 0 };
    leads.forEach((l) => { const k = l.lifeCycleStage || 'initial'; stages[k] = (stages[k] || 0) + 1; });
    // Open Pipeline = Open + Active stage groups, excluding leads marked Inactive.
    const inPipeline = leads.filter((l) => ['initial', 'active'].includes(l.lifeCycleStage || 'initial') && l.status !== 'inactive').length;
    return { stages, inPipeline };
  }, [leads]);

  const saveInvestment = async () => {
    const res = await fetch('/api/crm/roi/investment', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monthlyAmount: investment.trim() === '' ? null : Number(investment) }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'Could not save.'); return; }
    setEditingInvestment(false);
    load();
  };

  const roi = data?.roi;
  const cur = roi?.currency || 'INR';

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/crm/growth-report"
        className="flex items-center gap-4 bg-surface-container-lowest p-5 rounded-xl border border-primary-fixed-dim card-shadow hover:bg-primary-fixed/30 transition-colors"
      >
        <div className="p-3 bg-primary-fixed text-primary rounded-xl shrink-0"><CalendarRange className="w-6 h-6" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-on-surface">Monthly Growth Report</p>
          <p className="text-sm text-on-surface-variant">See your monthly CRM performance</p>
        </div>
        <ChevronRight className="w-5 h-5 text-outline shrink-0" />
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.days}
            onClick={() => setDays(p.days)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${days === p.days ? 'bg-primary text-white border-primary' : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant'}`}
          >
            {p.label}
          </button>
        ))}
        <span className="text-xs text-on-surface-variant ml-1">Leads created in this period, and their outcomes.</span>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {roi && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card icon={<Users className="w-6 h-6" />} label="Total Leads" value={roi.totalLeads} />
            <Card
              icon={<CheckCircle2 className="w-6 h-6" />}
              label="Converted (Won)"
              value={<>{roi.convertedLeads} <span className="text-sm font-medium text-secondary ml-1">{roi.conversionRate != null ? `(${roi.conversionRate}%)` : ''}</span></>}
              sub={roi.convertedWithoutValue > 0 ? `${roi.convertedWithoutValue} without a deal value` : undefined}
            />
            <Card icon={<IndianRupee className="w-6 h-6" />} label="Won Revenue" value={money(roi.wonRevenue, cur)} sub="From recorded deal values" />
            <Card icon={<Target className="w-6 h-6" />} label="Average Deal" value={money(roi.averageDealValue, cur)} sub={`Revenue per lead: ${money(roi.revenuePerLead, cur)}`} />
          </div>

          <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-on-surface-variant">ROI</p>
                {roi.roiPercent != null ? (
                  <p className="text-2xl font-bold text-on-surface">{roi.roiPercent}%</p>
                ) : (
                  <p className="text-base font-semibold text-on-surface-variant">Unavailable</p>
                )}
                {roi.investment && (
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Revenue {money(roi.wonRevenue, cur)} vs. investment {money(roi.investment.amount, roi.investment.currency)} for this period ({money(roi.investment.monthly, roi.investment.currency)}/month)
                  </p>
                )}
                {roi.roiNote && <p className="text-xs text-on-surface-variant mt-1">{roi.roiNote}</p>}
              </div>
              {editingInvestment ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={investment}
                    onChange={(e) => setInvestment(e.target.value)}
                    placeholder="Monthly spend (₹)"
                    className="border border-outline-variant rounded-lg px-3 py-1.5 text-sm w-40"
                  />
                  <button onClick={saveInvestment} className="px-3 py-1.5 text-xs font-bold bg-primary text-white rounded-lg">Save</button>
                  <button onClick={() => setEditingInvestment(false)} className="px-3 py-1.5 text-xs font-semibold border border-outline-variant rounded-lg">Cancel</button>
                </div>
              ) : (
                <button
                  onClick={() => { setInvestment(roi.investment ? String(roi.investment.monthly) : ''); setEditingInvestment(true); }}
                  className="px-3 py-1.5 text-xs font-bold border border-outline-variant rounded-lg"
                >
                  {data.investmentConfigured ? 'Edit monthly investment' : 'Set monthly investment'}
                </button>
              )}
            </div>
          </div>

          <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow overflow-x-auto">
            <h3 className="text-lg font-bold text-on-surface mb-4">Leads by Source</h3>
            {roi.bySource.length === 0 ? (
              <p className="text-sm text-on-surface-variant">No leads in this period.</p>
            ) : (
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-xs text-on-surface-variant uppercase">
                    <th className="py-2">Source</th><th>Leads</th><th>Converted</th><th>Rate</th><th>Revenue</th><th>Avg deal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {roi.bySource.map((r: any) => (
                    <tr key={r.source}>
                      <td className="py-2 font-semibold text-on-surface">{r.source}</td>
                      <td>{r.leads}</td>
                      <td>{r.converted}</td>
                      <td>{r.conversionRate != null ? `${r.conversionRate}%` : '—'}</td>
                      <td>{money(r.wonRevenue, cur)}</td>
                      <td>{money(r.averageDeal, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow">
            <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2"><Phone className="w-5 h-5" /> Phone Performance</h3>
            {roi.phone.observed ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                {[
                  ['Calls received', roi.phone.callsReceived],
                  ['Unique callers', roi.phone.uniqueCallers],
                  ['Missed calls', roi.phone.missedCalls],
                  ['From existing leads', roi.phone.callsFromKnownLeads],
                  ['Saved as leads', roi.phone.savedAsLeads],
                  ['Not saved', roi.phone.notSaved],
                  ['Call leads won', roi.phone.convertedCallLeads],
                  ['Call lead revenue', money(roi.phone.callLeadRevenue, cur)],
                ].map(([label, v]) => (
                  <div key={label as string}>
                    <p className="text-xs text-on-surface-variant">{label}</p>
                    <p className="text-lg font-bold text-on-surface">{v}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-on-surface-variant">No calls recorded in this period. Call stats appear once a call-tracking number (Twilio) is connected.</p>
            )}
            {data.missedOpportunities?.length > 0 && (
              <div className="mt-4 p-3 rounded-xl bg-error-container/30 border border-error-container">
                <p className="text-xs font-bold text-on-error-container uppercase mb-1">Missed opportunities</p>
                {data.missedOpportunities.map((l: string) => <p key={l} className="text-sm text-on-surface">{l}</p>)}
              </div>
            )}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card
          icon={<TrendingUp className="w-6 h-6" />}
          label="Open Pipeline"
          value={pipeline.inPipeline}
          sub="Open or Active stage, not inactive"
        />
        <Card icon={<BarChart3 className="w-6 h-6" />} label="All Leads" value={leads.length} sub="Current pipeline, all time" />
      </div>

      <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow">
        <h3 className="text-lg font-bold text-on-surface mb-6">Pipeline Distribution</h3>
        <div className="space-y-4">
          {Object.entries(pipeline.stages).map(([stage, count]) => (
            <div key={stage}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-on-surface">{STAGE_LABEL[stage] || stage}</span>
                <span className="text-on-surface-variant">{count} leads</span>
              </div>
              <div className="w-full bg-surface-container rounded-full h-2.5">
                <div className="bg-primary h-2.5 rounded-full" style={{ width: `${(count / Math.max(leads.length, 1)) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
