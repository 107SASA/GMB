'use client';

import { useEffect, useState } from 'react';
import { Users, Building2, DollarSign, BrainCircuit, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

interface DashboardData {
  totalUsers: number;
  totalBusinesses: number;
  mrr: number;
  aiRequestsToday: number;
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

  useEffect(() => {
    async function fetchAll() {
      try {
        const [statsRes, revenueRes, aiRes, healthRes] = await Promise.all([
          fetch('/api/admin/stats'),
          fetch('/api/admin/revenue'),
          fetch('/api/admin/ai-usage?range=1'),
          fetch('/api/admin/system-health'),
        ]);

        const [stats, revenue, ai, health] = await Promise.all([
          statsRes.json(),
          revenueRes.json(),
          aiRes.json(),
          healthRes.json(),
        ]);

        setData({
          totalUsers: stats.data?.stats?.totalUsers ?? 0,
          totalBusinesses: stats.data?.stats?.totalBusinesses ?? 0,
          mrr: revenue.data?.mrr ?? 0,
          aiRequestsToday: ai.data?.period?.generations ?? 0,
          dbStatus: health.data?.database?.status ?? 'down',
          failedJobs24h: health.data?.jobs?.failedJobs24h ?? 0,
          messageBacklog: health.data?.messages?.messageBacklog ?? 0,
          recentSignups: stats.data?.recentSignups ?? [],
        });
      } catch {
        // leave loading skeleton visible; errors will surface as zero values
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, []);

  const statCards = [
    {
      label: 'Total Customers',
      value: loading ? null : data?.totalUsers.toLocaleString() ?? '0',
      icon: Users,
      color: 'text-primary bg-primary-fixed',
    },
    {
      label: 'Active Businesses',
      value: loading ? null : data?.totalBusinesses.toLocaleString() ?? '0',
      icon: Building2,
      color: 'text-primary bg-primary-fixed',
    },
    {
      label: 'MRR',
      value: loading ? null : `$${(data?.mrr ?? 0).toLocaleString()}`,
      icon: DollarSign,
      color: 'text-secondary bg-secondary-container/40',
    },
    {
      label: 'AI Requests Today',
      value: loading ? null : (data?.aiRequestsToday ?? 0).toLocaleString(),
      icon: BrainCircuit,
      color: 'text-primary bg-primary-fixed',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold text-on-surface">Platform Operations Center</h1>
        <p className="text-on-surface-variant text-sm mt-1">Live platform metrics — all numbers pulled directly from the database.</p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((card) => (
              <div key={card.label} className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-on-surface-variant">{card.label}</h3>
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${card.color}`}>
                    <card.icon className="w-5 h-5" />
                  </div>
                </div>
                <p className="text-2xl font-bold text-on-surface">{card.value}</p>
              </div>
            ))}
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
                          {user.subscriptionPlan ?? 'Free'}
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

        {/* Platform Health — takes 1/3 width */}
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
                {data?.dbStatus === 'healthy' ? (
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
      </div>
    </div>
  );
}
