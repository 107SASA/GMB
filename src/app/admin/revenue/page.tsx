'use client';

import { useEffect, useState, useCallback } from 'react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import {
  IndianRupee,
  TrendingUp,
  Users,
  XCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Loader2,
} from 'lucide-react';

interface RevenueData {
  mrr: number;
  arr: number;
  activeCount: number;
  trialingCount: number;
  pastDueCount: number;
  canceledThisMonth: number;
  monthlyPriceInr: number;
  planName: string;
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  prefix,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  prefix?: string;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      <div className="text-3xl font-bold text-on-surface mb-1">
        {prefix}{value.toLocaleString()}
      </div>
      <div className="text-sm text-on-surface-variant">{title}</div>
    </div>
  );
}

export default function RevenuePage() {
  const [data, setData] = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/admin/revenue');
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setData(json.data);
    } catch (err: any) {
      setError(friendlyClientMessage(err, 'Failed to fetch revenue data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statusRows = data ? [
    { label: 'Active',   count: data.activeCount,      color: 'bg-secondary-container/40 text-on-secondary-container', icon: Users },
    { label: 'Trialing', count: data.trialingCount,     color: 'bg-primary-fixed text-primary',                        icon: Clock },
    { label: 'Past Due', count: data.pastDueCount,      color: 'bg-error-container text-on-error-container',           icon: AlertTriangle },
    { label: 'Canceled this month', count: data.canceledThisMonth, color: 'bg-surface-container text-on-surface-variant', icon: XCircle },
  ] : [];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center">
            <IndianRupee className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Revenue Analytics</h1>
            <p className="text-sm text-on-surface-variant">Platform-wide subscription revenue</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-primary-fixed text-primary rounded-xl hover:bg-primary-fixed transition-all text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container border border-error-container rounded-xl text-on-error-container text-sm">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : data ? (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
            <StatCard title="Monthly Recurring Revenue" value={data.mrr} icon={IndianRupee} color="bg-secondary" prefix="₹" />
            <StatCard title="Annual Recurring Revenue"   value={data.arr} icon={TrendingUp} color="bg-primary" prefix="₹" />
            <StatCard title="Active Subscriptions"       value={data.activeCount} icon={Users} color="bg-primary-fixed-dim" />
            <StatCard title="Canceled This Month"        value={data.canceledThisMonth} icon={XCircle} color="bg-error" />
          </div>
          <p className="text-xs text-on-surface-variant mb-8">
            MRR = {data.activeCount} active workspace{data.activeCount === 1 ? '' : 's'} × ₹{data.monthlyPriceInr.toLocaleString()}/mo ({data.planName} plan's current monthly price).
            Workspaces on a longer discounted cycle (quarterly/yearly) aren't tracked separately, so this is a monthly-equivalent estimate, not exact.
          </p>

          {/* Subscription Status Breakdown */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow">
            <div className="p-6 border-b border-outline-variant">
              <h2 className="font-semibold text-on-surface">Subscription Status</h2>
              <p className="text-sm text-on-surface-variant">Every workspace, by current billing state</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low">
                    <th className="text-left p-4 text-label-sm text-on-surface-variant">Status</th>
                    <th className="text-left p-4 text-label-sm text-on-surface-variant">Workspaces</th>
                  </tr>
                </thead>
                <tbody>
                  {statusRows.map((row) => (
                    <tr key={row.label} className="border-b border-outline-variant hover:bg-surface last:border-0">
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg ${row.color}`}>
                          <row.icon className="w-3.5 h-3.5" />
                          {row.label}
                        </span>
                      </td>
                      <td className="p-4 font-medium text-on-surface">{row.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
