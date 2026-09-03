'use client';

/**
 * SuperAdmin — Conversion Analytics & Agent Performance.
 *
 * Outcome-oriented metrics only, all from real Lead Engine data. Anything
 * that can't be derived reliably renders as "n/a" with the reason — never a
 * fabricated number.
 *
 * Data: GET /api/admin/conversion/analytics
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, BarChart3, ArrowLeft } from 'lucide-react';
import { RangePicker } from '@/components/admin/conversion/primitives';

interface Metric { value: number | null; unavailable?: string; num?: number; den?: number; sampleSize?: number }

interface Analytics {
  conversion: Record<string, Metric>;
  agents: {
    sales: Record<string, number>;
    demo: Record<string, number>;
    inHouse: { activatedCustomers: number; onboardingActivity: Metric };
  };
}

function Val({ m, unit = '%' }: { m?: Metric; unit?: string }) {
  if (!m || m.value === null) {
    return <span className="text-outline text-sm" title={m?.unavailable}>n/a</span>;
  }
  return (
    <span className="font-bold text-on-surface" title={m.den != null ? `${m.num} of ${m.den}` : m.sampleSize != null ? `${m.sampleSize} samples` : ''}>
      {m.value}{unit}
    </span>
  );
}

export default function ConversionAnalyticsPage() {
  const [range, setRange] = useState('90d');
  const [a, setA] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/conversion/analytics?range=${range}`);
      const json = await res.json();
      if (json.success) setA(json);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  if (loading && !a) return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const co = a?.conversion ?? {};
  const ag = a?.agents;

  return (
    <div className="space-y-6 max-w-4xl">
      <Link href="/admin/pipeline" className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary">
        <ArrowLeft className="w-4 h-4" /> Conversion overview
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
            <BarChart3 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Conversion Analytics</h1>
            <p className="text-sm text-on-surface-variant">Outcome metrics from real Lead Engine data. &quot;n/a&quot; = not enough data to compute honestly.</p>
          </div>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {/* Conversion rates */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5">
        <h2 className="font-semibold text-on-surface mb-4">Conversion rates</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          {[
            ['Lead → Qualified', co.leadToQualified],
            ['Lead → Demo interest', co.leadToDemo],
            ['Lead → Demo scheduled', co.leadToDemoScheduled],
            ['Demo → Purchase', co.demoToPurchase],
            ['Lead → Customer', co.leadToCustomer],
            ['Human handoff rate', co.humanHandoffRate],
            ['Opt-out rate', co.optOutRate],
            ['Lost-lead rate', co.lostRate],
            ['Demo no-show rate', co.noShowRate],
          ].map(([label, m]: any) => (
            <div key={label} className="border border-outline-variant rounded-lg p-3">
              <p className="text-xs text-on-surface-variant">{label}</p>
              <p className="text-lg mt-0.5"><Val m={m} /></p>
            </div>
          ))}
        </div>
      </section>

      {/* Timing */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5">
        <h2 className="font-semibold text-on-surface mb-4">Timing</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="border border-outline-variant rounded-lg p-3">
            <p className="text-xs text-on-surface-variant">Avg time: lead → demo</p>
            <p className="text-lg mt-0.5"><Val m={co.avgTimeToDemoDays} unit=" days" /></p>
          </div>
          <div className="border border-outline-variant rounded-lg p-3">
            <p className="text-xs text-on-surface-variant">Avg time: lead → conversion</p>
            <p className="text-lg mt-0.5"><Val m={co.avgTimeToConversionDays} unit=" days" /></p>
          </div>
        </div>
      </section>

      {/* Agent performance */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-5">
        <h2 className="font-semibold text-on-surface mb-4">Agent performance <span className="text-xs font-normal text-outline">— business outcomes, not message counts</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <AgentCard title="Sales Agent" rows={[
            ['Active leads', ag?.sales.activeLeads],
            ['Demos generated', ag?.sales.demosGenerated],
            ['Purchase intent', ag?.sales.purchaseIntent],
            ['Conversions', ag?.sales.conversions],
            ['Human handoffs', ag?.sales.humanHandoffs],
            ['Opt-outs', ag?.sales.optOuts],
          ]} />
          <AgentCard title="Demo Agent" rows={[
            ['Requested', ag?.demo.requested],
            ['Scheduled', ag?.demo.scheduled],
            ['Completed', ag?.demo.completed],
            ['Cancelled', ag?.demo.cancelled],
            ['No-show', ag?.demo.noShow],
            ['Rescheduled', ag?.demo.rescheduled],
          ]} />
          <AgentCard title="In-House Agent" rows={[
            ['Activated customers', ag?.inHouse.activatedCustomers],
          ]} note={ag?.inHouse.onboardingActivity?.unavailable} />
        </div>
      </section>
    </div>
  );
}

function AgentCard({ title, rows, note }: { title: string; rows: [string, number | undefined][]; note?: string }) {
  return (
    <div className="border border-outline-variant rounded-lg p-4">
      <h3 className="font-semibold text-sm text-on-surface mb-2">{title}</h3>
      <dl className="space-y-1.5 text-sm">
        {rows.map(([label, v]) => (
          <div key={label} className="flex items-center justify-between">
            <dt className="text-on-surface-variant text-xs">{label}</dt>
            <dd className="font-bold text-on-surface">{v ?? 0}</dd>
          </div>
        ))}
      </dl>
      {note && <p className="text-[11px] text-outline mt-2">{note}</p>}
    </div>
  );
}
