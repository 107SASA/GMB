'use client';

/**
 * SuperAdmin — Conversion Overview.
 *
 * The single "how are our leads moving through the business?" screen, built
 * on the Lead Engine (Lead + LeadEvent + DemoBooking + Business), NOT the
 * legacy Business.pipelineStage funnel.
 *
 * Data: GET /api/admin/conversion/overview and /analytics.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, TrendingUp, ArrowRight } from 'lucide-react';
import { KpiCard, Funnel, RangePicker, RelTime } from '@/components/admin/conversion/primitives';

interface Overview {
  kpis: Record<string, number>;
  revenue: { monthlyPriceInr: number; activeWorkspaces: number; mrrInr: number; pendingPayments: number; trialingWorkspaces: number; pastDueWorkspaces: number };
  funnel: { key: string; label: string; count: number }[];
  recent: {
    leads: any[];
    demoEvents: any[];
    handoffs: any[];
    payments: any[];
    customers: any[];
  };
}

interface Analytics {
  conversion: Record<string, { value: number | null; unavailable?: string; num?: number; den?: number }>;
}

function pctLabel(m?: { value: number | null; unavailable?: string }) {
  if (!m || m.value === null) return m?.unavailable ? 'n/a' : '—';
  return `${m.value}%`;
}

export default function ConversionOverviewPage() {
  const [range, setRange] = useState('30d');
  const [ov, setOv] = useState<Overview | null>(null);
  const [an, setAn] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, a] = await Promise.all([
        fetch(`/api/admin/conversion/overview?range=${range}`).then((r) => r.json()),
        fetch(`/api/admin/conversion/analytics?range=${range}`).then((r) => r.json()),
      ]);
      if (o.success) setOv(o);
      if (a.success) setAn(a);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  if (loading && !ov) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  const k = ov?.kpis ?? {};
  const noData = (ov?.kpis?.totalLeads ?? 0) === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Conversion Overview</h1>
            <p className="text-sm text-on-surface-variant">GrowwMatics acquisition funnel — leads → sales → demo → payment → customer.</p>
          </div>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {noData ? (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-16 text-center text-outline">
          No platform leads yet — they&apos;ll appear here the moment someone runs a free report or books a demo.
        </div>
      ) : (
        <>
          {/* KPI grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard label="Total leads" value={(k.totalLeads ?? 0).toLocaleString()} href="/admin/leads" />
            <KpiCard label={`New leads (${range})`} value={(k.newLeads ?? 0).toLocaleString()} />
            <KpiCard label="Active sales leads" value={(k.activeSalesLeads ?? 0).toLocaleString()} href="/admin/leads?agent=SALES" accent="primary" />
            <KpiCard label="Demo interested" value={(k.demoInterested ?? 0).toLocaleString()} href="/admin/leads?intent=DEMO_INTEREST" />
            <KpiCard label="Demos scheduled" value={(k.demosScheduled ?? 0).toLocaleString()} href="/admin/demo-bookings" />
            <KpiCard label="Demos completed" value={(k.demosCompleted ?? 0).toLocaleString()} href="/admin/demo-bookings" />
            <KpiCard label="Purchase intent" value={(k.purchaseIntent ?? 0).toLocaleString()} href="/admin/leads?nba=OFFER_SUBSCRIPTION" accent="primary" />
            <KpiCard label="Converted customers" value={(k.convertedCustomers ?? 0).toLocaleString()} sub={`${k.conversionRate ?? 0}% of all leads`} href="/admin/leads?ownership=customer" accent="primary" />
            <KpiCard label="Human handoffs" value={(k.humanHandoffs ?? 0).toLocaleString()} href="/admin/leads?ownership=human" accent={(k.humanHandoffs ?? 0) > 0 ? 'warning' : 'neutral'} />
            <KpiCard label="Opted out / lost" value={`${(k.optedOut ?? 0) + (k.lostLeads ?? 0)}`} sub={`${k.optedOut ?? 0} opted out · ${k.lostLeads ?? 0} lost`} accent={(k.optedOut ?? 0) + (k.lostLeads ?? 0) > 0 ? 'error' : 'neutral'} />
          </div>

          {/* Revenue strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard label="MRR (approx)" value={`₹${(ov?.revenue.mrrInr ?? 0).toLocaleString('en-IN')}`} sub={`${ov?.revenue.activeWorkspaces ?? 0} active workspaces × ₹${(ov?.revenue.monthlyPriceInr ?? 0).toLocaleString('en-IN')}`} href="/admin/revenue" />
            <KpiCard label="Trialing workspaces" value={ov?.revenue.trialingWorkspaces ?? 0} />
            <KpiCard label="Past-due workspaces" value={ov?.revenue.pastDueWorkspaces ?? 0} accent={(ov?.revenue.pastDueWorkspaces ?? 0) > 0 ? 'warning' : 'neutral'} />
            <KpiCard label="Pending payments" value={ov?.revenue.pendingPayments ?? 0} sub="leads at conversion-pending, no verified payment" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Funnel */}
            <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-on-surface">Conversion funnel</h2>
                <span className="text-xs text-outline">all-time</span>
              </div>
              <Funnel steps={(ov?.funnel ?? []).map((s) => ({ ...s, href: funnelHref(s.key) }))} />
            </div>

            {/* Conversion rates */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
              <h2 className="font-semibold text-on-surface mb-4">Conversion rates</h2>
              <dl className="space-y-2.5 text-sm">
                {[
                  ['Lead → Qualified', an?.conversion.leadToQualified],
                  ['Lead → Demo interest', an?.conversion.leadToDemo],
                  ['Lead → Demo scheduled', an?.conversion.leadToDemoScheduled],
                  ['Demo → Purchase', an?.conversion.demoToPurchase],
                  ['Lead → Customer', an?.conversion.leadToCustomer],
                  ['Human handoff rate', an?.conversion.humanHandoffRate],
                  ['Opt-out rate', an?.conversion.optOutRate],
                  ['No-show rate', an?.conversion.noShowRate],
                ].map(([label, m]: any) => (
                  <div key={label} className="flex items-center justify-between">
                    <dt className="text-on-surface-variant">{label}</dt>
                    <dd className="font-semibold text-on-surface" title={m?.unavailable || (m?.den != null ? `${m.num}/${m.den}` : '')}>
                      {pctLabel(m)}
                    </dd>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-outline-variant">
                  <dt className="text-on-surface-variant">Avg time to demo</dt>
                  <dd className="font-semibold text-on-surface">{daysLabel(an?.conversion.avgTimeToDemoDays)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-variant">Avg time to conversion</dt>
                  <dd className="font-semibold text-on-surface">{daysLabel(an?.conversion.avgTimeToConversionDays)}</dd>
                </div>
              </dl>
              <Link href="/admin/conversion-analytics" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Full analytics <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Recent activity */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <RecentList title="Recent leads" items={(ov?.recent.leads ?? []).map((l) => ({ id: l._id, primary: l.name || l.phone, secondary: l.currentStage, at: l.createdAt, href: `/admin/leads/${l._id}` }))} />
            <RecentList title="Recent demo requests" items={(ov?.recent.demoEvents ?? []).map((e, i) => ({ id: String(i), primary: e.phone || 'unknown', secondary: e.type.replace('_', ' ').toLowerCase(), at: e.createdAt, href: e.leadId ? `/admin/leads/${e.leadId}` : undefined }))} />
            <RecentList title="Recent human handoffs" items={(ov?.recent.handoffs ?? []).map((e, i) => ({ id: String(i), primary: e.phone || 'unknown', secondary: (e.payload?.reason as string) || 'handoff', at: e.createdAt, href: e.leadId ? `/admin/leads/${e.leadId}` : undefined }))} />
            <RecentList title="Recent payments" items={(ov?.recent.payments ?? []).map((e, i) => ({ id: String(i), primary: e.phone || 'unknown', secondary: e.type === 'CUSTOMER_ACTIVATED' ? 'activated' : 'payment', at: e.createdAt, href: e.leadId ? `/admin/leads/${e.leadId}` : undefined }))} />
            <RecentList title="Recent customers" items={(ov?.recent.customers ?? []).map((l) => ({ id: l._id, primary: l.name || l.phone, secondary: 'active', at: l.updatedAt, href: `/admin/leads/${l._id}` }))} />
          </div>
        </>
      )}
    </div>
  );
}

function funnelHref(key: string): string | undefined {
  const map: Record<string, string> = {
    leads: '/admin/leads',
    qualified: '/admin/leads?stage=QUALIFYING',
    salesNurturing: '/admin/leads?agent=SALES&stage=NURTURING',
    demoInterest: '/admin/leads?intent=DEMO_INTEREST',
    demoScheduled: '/admin/leads?demo=scheduled',
    demoCompleted: '/admin/leads?demo=completed',
    purchaseIntent: '/admin/leads?nba=OFFER_SUBSCRIPTION',
    paymentVerified: '/admin/leads?payment=verified',
    customer: '/admin/leads?ownership=customer',
  };
  return map[key];
}

function daysLabel(m?: { value: number | null; unavailable?: string; sampleSize?: number }) {
  if (!m || m.value === null) return <span className="text-outline font-normal" title={m?.unavailable}>n/a</span>;
  return `${m.value}d`;
}

function RecentList({ title, items }: { title: string; items: { id: string; primary: string; secondary?: string; at: string; href?: string }[] }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-outline-variant">
        <h3 className="font-semibold text-sm text-on-surface">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-outline">No data yet</p>
      ) : (
        <ul className="divide-y divide-outline-variant">
          {items.map((it) => {
            const inner = (
              <div className="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-surface transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-on-surface truncate">{it.primary}</p>
                  {it.secondary && <p className="text-xs text-on-surface-variant truncate">{it.secondary}</p>}
                </div>
                <RelTime date={it.at} />
              </div>
            );
            return <li key={it.id}>{it.href ? <Link href={it.href}>{inner}</Link> : inner}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
