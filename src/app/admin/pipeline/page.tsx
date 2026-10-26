'use client';

/**
 * SuperAdmin — Conversion Overview.
 *
 * The single "how are our leads moving through the business?" screen, built
 * on the Lead Engine (Lead + LeadEvent + DemoBooking), NOT the legacy
 * Business.pipelineStage funnel.
 *
 * Every lead number is for leads CREATED in the chosen range and links to
 * /admin/leads?segment=<key>&range=<range>, which applies the same
 * definition (lib/admin/leadMilestones.ts) — the list always matches the
 * number. Demo bookings are counted separately from leads.
 *
 * Data: GET /api/admin/conversion/overview.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, TrendingUp, ArrowRight } from 'lucide-react';
import { KpiCard, Funnel, RangePicker, RelTime } from '@/components/admin/conversion/primitives';

type Metric = { value: number | null; unavailable?: string; num?: number; den?: number; sampleSize?: number };

interface Overview {
  range: { key: string; label: string };
  kpis: Record<string, number>;
  segments: Record<string, { label: string; description: string; kind: 'reached' | 'current' }>;
  bookings: { total: number; upcoming: number; pending: number; confirmed: number; completed: number; noShow: number; cancelled: number; noShowRate: Metric };
  revenue: { mrrInr: number; payingSubscriptions: number; estimatedCount: number; trialActiveWorkspaces: number; pastDueWorkspaces: number };
  funnel: { key: string; label: string; count: number }[];
  conversion: Record<string, Metric>;
  recent: { leads: any[]; demoEvents: any[]; handoffs: any[]; payments: any[]; customers: any[] };
}

function pctLabel(m?: Metric) {
  if (!m || m.value === null) return m?.unavailable ? 'n/a' : '—';
  return `${m.value}%`;
}

export default function ConversionOverviewPage() {
  const [range, setRange] = useState('all');
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/conversion/overview?range=${range}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Request failed (${res.status})`);
      setOv(json);
    } catch (err: any) {
      setOv(null);
      setError(err?.message || 'Could not load the conversion overview');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const k = ov?.kpis ?? {};
  const seg = ov?.segments ?? {};
  const link = (segment?: string) => `/admin/leads?${new URLSearchParams({ ...(segment ? { segment } : {}), range }).toString()}`;
  const desc = (key: string) => seg[key]?.description;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
            <TrendingUp className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Conversion Overview</h1>
            <p className="text-sm text-on-surface-variant">GrowwMatics acquisition funnel — leads → demo → payment → customer.</p>
          </div>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </div>

      {loading && !ov && !error ? (
        <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-error-container bg-error-container/40 p-6 text-sm text-on-error-container">
          Couldn&apos;t load the conversion overview: {error}.{' '}
          <button onClick={load} className="underline font-semibold">Retry</button>
        </div>
      ) : ov && ov.kpis.totalLeads === 0 ? (
        <>
          <p className="text-xs text-on-surface-variant">{ov.range.label}</p>
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-16 text-center text-outline">
            {range === 'all'
              ? <>No platform leads yet — they&apos;ll appear here the moment someone runs a free report or books a demo.</>
              : <>No leads were created in this range. Choose &quot;All time&quot; to see every lead.</>}
          </div>
        </>
      ) : ov ? (
        <>
          <p className="text-xs text-on-surface-variant">
            {ov.range.label}. Lead numbers count leads that <strong>ever reached</strong> a stage unless marked “now”.
          </p>

          {/* Lead KPIs — every card opens the exact list it counts */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard label="Leads" value={(k.totalLeads ?? 0).toLocaleString()} href={link()} />
            <KpiCard label="Active sales leads (now)" value={(k.activeSalesLeads ?? 0).toLocaleString()} sub={desc('activeSales')} href={link('activeSales')} accent="primary" />
            <KpiCard label="Demo interest" value={(k.demoInterested ?? 0).toLocaleString()} sub={desc('demoInterest')} href={link('demoInterest')} />
            <KpiCard label="Leads with a demo scheduled" value={(k.demoScheduledLeads ?? 0).toLocaleString()} sub={desc('demoScheduled')} href={link('demoScheduled')} />
            <KpiCard label="Leads that attended a demo" value={(k.demoCompletedLeads ?? 0).toLocaleString()} sub={desc('demoCompleted')} href={link('demoCompleted')} />
            <KpiCard label="Purchase intent" value={(k.purchaseIntent ?? 0).toLocaleString()} sub={desc('purchaseIntent')} href={link('purchaseIntent')} accent="primary" />
            <KpiCard label="Customers" value={(k.convertedCustomers ?? 0).toLocaleString()} sub={`${k.conversionRate ?? 0}% of these leads`} href={link('customer')} accent="primary" />
            <KpiCard label="With a human (now)" value={(k.withHuman ?? 0).toLocaleString()} sub={desc('withHuman')} href={link('withHuman')} accent={(k.withHuman ?? 0) > 0 ? 'warning' : 'neutral'} />
            <KpiCard label="Opted out / lost (now)" value={(k.optedOutOrLost ?? 0).toLocaleString()} sub={desc('optedOutOrLost')} href={link('optedOutOrLost')} accent={(k.optedOutOrLost ?? 0) > 0 ? 'error' : 'neutral'} />
            <KpiCard label="Pending payments (now)" value={(k.pendingPayments ?? 0).toLocaleString()} sub={desc('pendingPayment')} href={link('pendingPayment')} />
          </div>

          {/* Demo bookings — bookings, not leads */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard label="Demo bookings" value={ov.bookings.total.toLocaleString()} sub="bookings made by these leads" href="/admin/demo-bookings" />
            <KpiCard label="Upcoming bookings" value={ov.bookings.upcoming.toLocaleString()} sub="pending or confirmed, not yet held" href="/admin/demo-bookings" />
            <KpiCard label="Held" value={ov.bookings.completed.toLocaleString()} href="/admin/demo-bookings" />
            <KpiCard label="No-shows" value={ov.bookings.noShow.toLocaleString()} sub={`no-show rate ${pctLabel(ov.bookings.noShowRate)}`} href="/admin/demo-bookings" />
            <KpiCard label="Cancelled" value={ov.bookings.cancelled.toLocaleString()} href="/admin/demo-bookings" />
          </div>

          {/* Revenue strip — the shared platform calculation (also /admin/revenue) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="MRR"
              value={`₹${ov.revenue.mrrInr.toLocaleString('en-IN')}`}
              sub={`${ov.revenue.payingSubscriptions} paying subscription${ov.revenue.payingSubscriptions === 1 ? '' : 's'}, monthly equivalent${ov.revenue.estimatedCount ? ` · ${ov.revenue.estimatedCount} estimated` : ''}`}
              href="/admin/revenue"
            />
            <KpiCard label="Free trials (now)" value={ov.revenue.trialActiveWorkspaces} sub="autopay set up, not charged yet" href="/admin/billing" />
            <KpiCard label="Past-due workspaces (now)" value={ov.revenue.pastDueWorkspaces} accent={ov.revenue.pastDueWorkspaces > 0 ? 'warning' : 'neutral'} href="/admin/billing" />
            <KpiCard label="Pending payments (now)" value={k.pendingPayments ?? 0} sub="leads at conversion-pending" href={link('pendingPayment')} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Funnel */}
            <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="font-semibold text-on-surface">Stages reached</h2>
                <span className="text-xs text-outline">{ov.range.label.toLowerCase()}</span>
              </div>
              <p className="text-xs text-outline mb-4">Each bar counts leads that ever reached that stage. A lead can buy without a demo, so the purchase steps aren&apos;t always smaller than the demo steps.</p>
              <Funnel steps={ov.funnel.map((s) => ({ ...s, href: link(s.key === 'leads' ? undefined : s.key) }))} />
            </div>

            {/* Conversion rates */}
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
              <h2 className="font-semibold text-on-surface mb-4">Conversion rates</h2>
              <dl className="space-y-2.5 text-sm">
                {([
                  ['Lead → Qualified', ov.conversion.leadToQualified],
                  ['Lead → Demo interest', ov.conversion.leadToDemo],
                  ['Lead → Demo scheduled', ov.conversion.leadToDemoScheduled],
                  ['Attended demo → Purchase intent', ov.conversion.demoToPurchase],
                  ['Lead → Customer', ov.conversion.leadToCustomer],
                  ['Ever handed to a human', ov.conversion.humanHandoffRate],
                  ['Ever opted out', ov.conversion.optOutRate],
                  ['Demo no-show rate', ov.conversion.noShowRate],
                ] as [string, Metric | undefined][]).map(([label, m]) => (
                  <div key={label} className="flex items-center justify-between">
                    <dt className="text-on-surface-variant">{label}</dt>
                    <dd className="font-semibold text-on-surface" title={m?.unavailable || (m?.den != null ? `${m.num} of ${m.den}` : '')}>
                      {pctLabel(m)}
                    </dd>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t border-outline-variant">
                  <dt className="text-on-surface-variant">Avg time to demo</dt>
                  <dd className="font-semibold text-on-surface">{daysLabel(ov.conversion.avgTimeToDemoDays)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-on-surface-variant">Avg time to payment</dt>
                  <dd className="font-semibold text-on-surface">{daysLabel(ov.conversion.avgTimeToConversionDays)}</dd>
                </div>
              </dl>
              <Link href="/admin/conversion-analytics" className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Full analytics <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Recent activity */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <RecentList title="Recent leads" items={ov.recent.leads.map((l) => ({ id: l._id, primary: l.name || l.phone, secondary: l.currentStage, at: l.createdAt, href: `/admin/leads/${l._id}` }))} />
            <RecentList title="Recent demo requests" items={ov.recent.demoEvents.map((e, i) => ({ id: String(i), primary: e.phone || 'unknown', secondary: e.type.replaceAll('_', ' ').toLowerCase(), at: e.createdAt, href: e.leadId ? `/admin/leads/${e.leadId}` : undefined }))} />
            <RecentList title="Recent human handoffs" items={ov.recent.handoffs.map((e, i) => ({ id: String(i), primary: e.phone || 'unknown', secondary: (e.payload?.reason as string) || 'handoff', at: e.createdAt, href: e.leadId ? `/admin/leads/${e.leadId}` : undefined }))} />
            <RecentList title="Recent payments" items={ov.recent.payments.map((e, i) => ({ id: String(i), primary: e.phone || 'unknown', secondary: e.type === 'CUSTOMER_ACTIVATED' ? 'activated' : 'payment', at: e.createdAt, href: e.leadId ? `/admin/leads/${e.leadId}` : undefined }))} />
            <RecentList title="Recent customers" items={ov.recent.customers.map((l) => ({ id: String(l._id), primary: l.name || l.phone, secondary: 'customer', at: l.at, href: `/admin/leads/${l._id}` }))} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function daysLabel(m?: Metric) {
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
