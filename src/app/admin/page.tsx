'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Building2, DollarSign, BrainCircuit, UserPlus, CheckCircle, XCircle, AlertTriangle, Flame, RefreshCw, Eye } from 'lucide-react';

interface HotLead {
  businessId: string;
  businessName: string;
  city: string | null;
  ownerName: string | null;
  phone: string | null;
  leadId: string | null;
  subscriptionStatus: string | null;
  requests: number;
  views: number;
  lastActivityAt: string;
}

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

interface DashboardData {
  totalUsers: number;
  totalBusinesses: number;
  activeBusinesses: number;
  payingBusinesses: number;
  trialBusinesses: number;
  mrr: number;
  aiRequestsToday: number;
  newLeadsLast7Days: number;
  dbStatus: 'healthy' | 'down';
  failedJobs24h: number;
  messageBacklog: number;
  recentSignups: Array<{
    _id: string;
    fullName: string;
    email: string;
    createdAt: string;
    subscriptionPlan?: string;
  }>;
  hotLeads: HotLead[];
  hotLeadsTotal: number;
}

function SkeletonCard() {
  return (
    <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow animate-pulse">
      <div className="h-3 w-24 bg-surface-container-high rounded mb-4" />
      <div className="h-7 w-20 bg-surface-container-high rounded" />
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-4 py-3"><div className="h-3 w-28 bg-surface-container-high rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-36 bg-surface-container-high rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-14 bg-surface-container-high rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-surface-container-high rounded" /></td>
    </tr>
  );
}

export default function AdminRootPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // Which sources failed — their numbers show as "—", never as a real-looking 0.
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    async function fetchAll() {
      const load = async (name: string, url: string) => {
        try {
          const res = await fetch(url);
          const json = await res.json();
          if (!res.ok || json.success === false) throw new Error(json.error || res.statusText);
          return { name, json, ok: true };
        } catch {
          return { name, json: {} as any, ok: false };
        }
      };
      try {
        const results = await Promise.all([
          load('Platform stats', '/api/admin/stats'),
          load('Revenue', '/api/admin/revenue'),
          load('AI usage', '/api/admin/ai-usage?range=1'),
          load('System health', '/api/admin/system-health'),
          load('Hot leads', '/api/admin/hot-report-leads'),
        ]);
        setFailed(results.filter((r) => !r.ok).map((r) => r.name));
        const [stats, revenue, ai, health, hot] = results.map((r) => r.json);

        setData({
          totalUsers: stats.data?.stats?.totalUsers ?? 0,
          totalBusinesses: stats.data?.stats?.totalBusinesses ?? 0,
          activeBusinesses: stats.data?.stats?.activeBusinesses ?? 0,
          payingBusinesses: stats.data?.stats?.payingBusinesses ?? 0,
          trialBusinesses: stats.data?.stats?.trialBusinesses ?? 0,
          mrr: revenue.data?.mrr ?? 0,
          aiRequestsToday: ai.data?.period?.generations ?? 0,
          newLeadsLast7Days: stats.data?.stats?.newLeadsLast7Days ?? 0,
          dbStatus: health.data?.database?.status ?? 'down',
          failedJobs24h: health.data?.jobs?.failedJobs24h ?? 0,
          messageBacklog: health.data?.messages?.messageBacklog ?? 0,
          recentSignups: stats.data?.recentSignups ?? [],
          hotLeads: hot.data?.leads ?? [],
          hotLeadsTotal: hot.data?.total ?? 0,
        });
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, []);

  const shown = (source: string, value: string) => (failed.includes(source) ? '—' : value);
  const statCards: Array<{ label: string; value: string | null; sub?: string; icon: any; color: string; href?: string }> = [
    {
      label: 'Total Customers',
      value: loading ? null : shown('Platform stats', (data?.totalUsers ?? 0).toLocaleString()),
      icon: Users,
      color: 'text-primary bg-primary-fixed',
      href: '/admin/customers',
    },
    {
      label: 'Active Businesses',
      value: loading ? null : shown('Platform stats', (data?.activeBusinesses ?? 0).toLocaleString()),
      sub: failed.includes('Platform stats') ? undefined : `${data?.payingBusinesses ?? 0} paying · ${data?.trialBusinesses ?? 0} on trial · ${data?.totalBusinesses ?? 0} total`,
      icon: Building2,
      color: 'text-primary bg-primary-fixed',
      href: '/admin/businesses',
    },
    {
      label: 'MRR',
      value: loading ? null : shown('Revenue', `₹${(data?.mrr ?? 0).toLocaleString('en-IN')}`),
      icon: DollarSign,
      color: 'text-secondary bg-secondary-container/40',
      href: '/admin/revenue',
    },
    {
      label: 'AI Requests Today',
      value: loading ? null : shown('AI usage', (data?.aiRequestsToday ?? 0).toLocaleString()),
      icon: BrainCircuit,
      color: 'text-primary bg-primary-fixed',
      href: '/admin/ai-usage',
    },
    {
      label: 'New Customer Leads (7d)',
      value: loading ? null : shown('Platform stats', (data?.newLeadsLast7Days ?? 0).toLocaleString()),
      sub: "Leads in customers' own CRMs",
      icon: UserPlus,
      color: 'text-secondary bg-secondary-container/40',
      href: '/admin/crm',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-on-surface">Platform Operations Center</h1>
        <p className="text-on-surface-variant text-sm mt-1">Live platform metrics — all numbers pulled directly from the database.</p>
      </div>

      {failed.length > 0 && !loading && (
        <div className="flex items-start gap-2 rounded-xl border border-error-container bg-error-container/40 p-4 text-sm text-on-error-container" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Couldn&apos;t load: {failed.join(', ')}. Those numbers show as “—”; refresh to retry.</span>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((card) => {
              const Card = (
                <div className={`bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow h-full ${card.href ? 'hover:border-primary-fixed-dim transition-colors' : ''}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-on-surface-variant">{card.label}</h3>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.color}`}>
                      <card.icon className="w-5 h-5" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-on-surface">{card.value}</p>
                  {card.sub && <p className="text-xs text-outline mt-1">{card.sub}</p>}
                </div>
              );
              return card.href ? (
                <Link key={card.label} href={card.href}>{Card}</Link>
              ) : (
                <div key={card.label}>{Card}</div>
              );
            })}
      </div>

      {/* Bottom two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Signups — takes 2/3 width */}
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant">
            <h2 className="font-semibold text-on-surface">Recent Signups</h2>
            <p className="text-xs text-outline mt-0.5">Last 10 new users</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-label-sm text-on-surface-variant bg-surface-container-low">
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Plan</th>
                  <th className="text-left px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                  : (data?.recentSignups ?? []).length === 0
                  ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-outline text-sm">
                        No signups yet
                      </td>
                    </tr>
                  )
                  : data?.recentSignups.map((user) => (
                    <tr key={user._id} className="hover:bg-surface transition-colors">
                      <td className="px-4 py-3 font-medium text-on-surface">{user.fullName}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{user.email}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                          user.subscriptionPlan === 'Enterprise'
                            ? 'bg-primary-fixed text-primary'
                            : user.subscriptionPlan === 'Pro'
                            ? 'bg-primary-fixed text-primary'
                            : 'bg-surface-container text-on-surface-variant'
                        }`}>
                          {(user as any).workspacePlan ?? user.subscriptionPlan ?? 'Free'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-outline">
                        {new Date(user.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column — Platform Health + Hot leads, 1/3 width */}
        <div className="flex flex-col gap-6">
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
          <h2 className="font-semibold text-on-surface mb-1">Platform Health</h2>
          <p className="text-xs text-outline mb-5">Real-time system status</p>

          {loading ? (
            <div className="space-y-4 animate-pulse">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="h-3 w-24 bg-surface-container-high rounded" />
                  <div className="h-5 w-16 bg-surface-container-high rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-on-surface-variant">Database</span>
                {failed.includes('System health') ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-container text-on-surface-variant rounded-full text-xs font-semibold">
                    Unknown
                  </span>
                ) : data?.dbStatus === 'healthy' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-secondary-container/40 text-on-secondary-container rounded-full text-xs font-semibold">
                    <CheckCircle className="w-3.5 h-3.5" /> Healthy
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-error-container text-on-error-container rounded-full text-xs font-semibold">
                    <XCircle className="w-3.5 h-3.5" /> Down
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-on-surface-variant">Failed Jobs (24h)</span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                  (data?.failedJobs24h ?? 0) > 0
                    ? 'bg-primary-fixed text-primary'
                    : 'bg-secondary-container/40 text-on-secondary-container'
                }`}>
                  {(data?.failedJobs24h ?? 0) > 0 && <AlertTriangle className="w-3.5 h-3.5" />}
                  {data?.failedJobs24h ?? 0}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-on-surface-variant">Message Backlog</span>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                  (data?.messageBacklog ?? 0) > 50
                    ? 'bg-primary-fixed text-primary'
                    : 'bg-surface-container text-on-surface-variant'
                }`}>
                  {data?.messageBacklog ?? 0} pending
                </span>
              </div>

              <div className="mt-4 pt-4 border-t border-outline-variant">
                <p className="text-xs text-outline">
                  Refreshed at {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Hot leads — asked for the free report again / kept opening it */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden flex-1">
          <div className="px-6 pt-6 pb-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-on-surface flex items-center gap-2">
                <Flame className="w-4 h-4 text-error" /> Hot Leads
              </h2>
              {!loading && !failed.includes('Hot leads') && (data?.hotLeadsTotal ?? 0) > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-error-container text-on-error-container">
                  {data?.hotLeadsTotal}
                </span>
              )}
            </div>
            <p className="text-xs text-outline mt-0.5">Asked for the free report 2+ times, or opened it 2+ times</p>
          </div>

          {loading ? (
            <div className="px-6 pb-6 space-y-3 animate-pulse">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-surface-container-high rounded" />
              ))}
            </div>
          ) : failed.includes('Hot leads') ? (
            <p className="px-6 pb-6 text-sm text-outline">Couldn&apos;t load hot leads.</p>
          ) : (data?.hotLeads ?? []).length === 0 ? (
            <p className="px-6 pb-6 text-sm text-outline">No repeat requests or views yet.</p>
          ) : (
            <ul className="divide-y divide-outline-variant border-t border-outline-variant">
              {data?.hotLeads.map((lead) => {
                const row = (
                  <div className="px-6 py-3 hover:bg-surface transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-on-surface truncate">{lead.businessName}</p>
                        <p className="text-xs text-outline truncate">
                          {[lead.ownerName, lead.phone, lead.city].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <span className="text-xs text-outline whitespace-nowrap">{timeAgo(lead.lastActivityAt)}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <span
                        title="Times they asked for the free report"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                          lead.requests >= 2 ? 'bg-error-container text-on-error-container' : 'bg-surface-container text-on-surface-variant'
                        }`}
                      >
                        <RefreshCw className="w-3 h-3" /> {lead.requests}× asked
                      </span>
                      <span
                        title="Times they opened the finished report (max 1 per 30 min)"
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                          lead.views >= 2 ? 'bg-primary-fixed text-primary' : 'bg-surface-container text-on-surface-variant'
                        }`}
                      >
                        <Eye className="w-3 h-3" /> {lead.views} views
                      </span>
                      {(lead.subscriptionStatus === 'active' || lead.subscriptionStatus === 'trial_active') && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary-container/40 text-on-secondary-container">
                          {lead.subscriptionStatus === 'active' ? 'Paid' : 'Trial'}
                        </span>
                      )}
                    </div>
                  </div>
                );
                return (
                  <li key={lead.businessId}>
                    {lead.leadId ? <Link href={`/admin/leads/${lead.leadId}`}>{row}</Link> : row}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
