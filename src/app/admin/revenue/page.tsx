'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  DollarSign,
  TrendingUp,
  Users,
  XCircle,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface RevenueData {
  mrr: number;
  arr: number;
  activePayingUsers: number;
  churnedThisMonth: number;
  planBreakdown: Array<{ plan: string; count: number; revenue: number }>;
  monthlyTrend: Array<{ month: string; revenue: number; count: number }>;
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
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      <div className="text-3xl font-bold text-slate-900 mb-1">
        {prefix}{value.toLocaleString()}
      </div>
      <div className="text-sm text-slate-500">{title}</div>
    </div>
  );
}

const PLAN_COLORS: Record<string, string> = {
  Free: 'bg-slate-100 text-slate-600',
  Pro: 'bg-blue-50 text-blue-600',
  Enterprise: 'bg-violet-50 text-violet-600',
};

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
      setError(err.message || 'Failed to fetch revenue data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center">
            <DollarSign className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Revenue Analytics</h1>
            <p className="text-sm text-slate-500">Platform-wide subscription revenue</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-violet-50 text-violet-700 rounded-xl hover:bg-violet-100 transition-all text-sm font-medium"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
        </div>
      ) : data ? (
        <>
          {/* Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <StatCard
              title="Monthly Recurring Revenue"
              value={data.mrr}
              icon={DollarSign}
              color="bg-emerald-500"
              prefix="$"
            />
            <StatCard
              title="Annual Recurring Revenue"
              value={data.arr}
              icon={TrendingUp}
              color="bg-violet-600"
              prefix="$"
            />
            <StatCard
              title="Active Paying Users"
              value={data.activePayingUsers}
              icon={Users}
              color="bg-blue-500"
            />
            <StatCard
              title="Churned This Month"
              value={data.churnedThisMonth}
              icon={XCircle}
              color="bg-red-500"
            />
          </div>

          {/* Monthly Revenue Chart */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
            <h2 className="font-semibold text-slate-900 mb-6">Monthly Revenue Trend</h2>
            {data.monthlyTrend.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-8">
                No revenue data yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={data.monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: any) => [`$${value}`, 'Revenue']}
                  />
                  <Bar dataKey="revenue" fill="#7c3aed" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Plan Breakdown Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="p-6 border-b border-slate-100">
              <h2 className="font-semibold text-slate-900">Plan Breakdown</h2>
              <p className="text-sm text-slate-500">Subscribers and revenue per plan</p>
            </div>
            {data.planBreakdown.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No subscription data yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left p-4 text-slate-500 font-medium">Plan</th>
                      <th className="text-left p-4 text-slate-500 font-medium">Subscribers</th>
                      <th className="text-left p-4 text-slate-500 font-medium">MRR Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.planBreakdown.map((item) => (
                      <tr key={item.plan} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="p-4">
                          <span className={`text-xs font-bold px-2 py-1 rounded-lg ${PLAN_COLORS[item.plan] || 'bg-slate-100 text-slate-600'}`}>
                            {item.plan}
                          </span>
                        </td>
                        <td className="p-4 font-medium text-slate-700">{item.count}</td>
                        <td className="p-4 font-bold text-emerald-600">${item.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}