'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  BrainCircuit,
  Zap,
  DollarSign,
  XCircle,
  CheckCircle2,
  RefreshCw,
  TrendingUp,
  User,
  ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────
interface DailyStat {
  date: string;
  generations: number;
  tokens: number;
  cost: number;
  failed: number;
}

interface TopUser {
  userId: string;
  fullName: string;
  email: string;
  plan: string;
  generations: number;
  tokens: number;
  estimatedCost: number;
}

interface PromptBucket {
  _id: string;
  count: number;
  tokens: number;
}

interface RecentActivity {
  _id: string;
  userName: string;
  userEmail: string;
  promptType: string;
  aiModel: string;
  tokensUsed: number;
  estimatedCost: number;
  status: string;
  createdAt: string;
}

interface AIData {
  overview: {
    totalGenerations: number;
    totalTokens: number;
    totalCost: number;
    failedGenerations: number;
    successRate: number;
  };
  period: {
    days: number;
    generations: number;
    tokens: number;
    cost: number;
    failedCount: number;
  };
  dailyStats: DailyStat[];
  topUsers: TopUser[];
  promptBreakdown: PromptBucket[];
  recentActivity: RecentActivity[];
}

const RANGE_OPTIONS = [
  { label: '7 days',  value: '7' },
  { label: '14 days', value: '14' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
];

// ── Stat Card (same pattern as dashboard) ────────────────────────────────────
function StatCard({
  title, value, sub, icon: Icon, color, subColor = 'text-emerald-600',
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; subColor?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
        {sub && (
          <span className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg bg-slate-50 ${subColor}`}>
            <ArrowUpRight className="w-3 h-3" />
            {sub}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold text-slate-900 mb-1">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-sm font-medium text-slate-500">{title}</div>
    </div>
  );
}

// ── Inline bar chart ─────────────────────────────────────────────────────────
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    failed:  'bg-rose-50    text-rose-700    border-rose-100',
    partial: 'bg-amber-50   text-amber-700   border-amber-100',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', map[status] ?? map.partial)}>
      {status}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AIUsagePage() {
  const router  = useRouter();
  const [data, setData]         = useState<AIData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange]       = useState('7');
  const [error, setError]       = useState('');

  const fetchData = useCallback(async (r = range, isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/admin/ai-usage?range=${r}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else if (json.error?.includes('Unauthorized') || json.error?.includes('Forbidden')) {
        router.push('/admin/login');
      } else {
        setError(json.error || 'Failed to load AI usage data');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRange = (r: string) => { setRange(r); fetchData(r); };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium text-slate-500">Loading AI usage analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-rose-500 font-medium mb-3">{error}</p>
          <button onClick={() => fetchData()} className="text-sm text-violet-600 hover:underline font-medium">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { overview, period, dailyStats, topUsers, promptBreakdown, recentActivity } = data;

  const maxDailyGen = Math.max(...dailyStats.map(d => d.generations), 1);
  const maxPromptCount = Math.max(...promptBreakdown.map(p => p.count), 1);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-600/20">
            <BrainCircuit className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">AI Usage Analytics</h1>
            <p className="text-sm text-slate-500 font-medium">Platform-wide AI consumption — real data</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Range selector */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            {RANGE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleRange(opt.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  range === opt.value
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => fetchData(range, true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-60"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* Overview stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
        <StatCard
          title="Total AI Generations"
          value={overview.totalGenerations}
          sub={`+${period.generations} in ${range}d`}
          icon={BrainCircuit}
          color="bg-violet-600"
        />
        <StatCard
          title="Total Tokens Used"
          value={overview.totalTokens.toLocaleString()}
          sub={`${period.tokens.toLocaleString()} in ${range}d`}
          icon={Zap}
          color="bg-cyan-600"
        />
        <StatCard
          title="Estimated AI Cost"
          value={`$${overview.totalCost.toFixed(4)}`}
          sub={`$${period.cost.toFixed(4)} in ${range}d`}
          icon={DollarSign}
          color="bg-emerald-600"
        />
        <StatCard
          title="Failed Generations"
          value={overview.failedGenerations}
          sub={`${overview.successRate}% success rate`}
          icon={XCircle}
          color="bg-rose-500"
          subColor={overview.successRate >= 90 ? 'text-emerald-600' : 'text-rose-500'}
        />
      </div>

      {/* Daily chart + Prompt breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">

        {/* Daily Generations Bar Chart */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-slate-900">Daily Generations</h2>
            <span className="text-xs font-medium text-slate-400">Last {range} days</span>
          </div>
          {dailyStats.every(d => d.generations === 0) ? (
            <div className="h-40 flex items-center justify-center text-slate-300 text-sm">
              No AI usage data in this period
            </div>
          ) : (
            <div className="flex items-end gap-1 h-40">
              {dailyStats.map(day => {
                const pct = maxDailyGen > 0 ? (day.generations / maxDailyGen) * 100 : 0;
                return (
                  <div key={day.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                    <div
                      className="w-full bg-violet-500 rounded-t-sm transition-all group-hover:bg-violet-600"
                      style={{ height: `${Math.max(pct, day.generations > 0 ? 4 : 0)}%` }}
                    />
                    {/* Tooltip */}
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-900 text-white text-xs rounded-lg px-2 py-1 whitespace-nowrap z-10 shadow-lg">
                      <div className="font-bold">{day.generations} gen</div>
                      <div className="text-slate-300">{day.tokens.toLocaleString()} tokens</div>
                      <div className="text-slate-300">${day.cost.toFixed(4)}</div>
                      <div className="text-slate-400 text-[10px]">{day.date}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* X axis labels — show first, middle, last */}
          <div className="flex justify-between mt-2">
            <span className="text-[10px] text-slate-400">{dailyStats[0]?.date?.slice(5)}</span>
            <span className="text-[10px] text-slate-400">
              {dailyStats[Math.floor(dailyStats.length / 2)]?.date?.slice(5)}
            </span>
            <span className="text-[10px] text-slate-400">
              {dailyStats[dailyStats.length - 1]?.date?.slice(5)}
            </span>
          </div>
        </div>

        {/* Prompt type breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-bold text-slate-900 mb-5">By Prompt Type</h2>
          {promptBreakdown.length === 0 ? (
            <div className="text-sm text-slate-300 text-center py-10">No data</div>
          ) : (
            <div className="space-y-4">
              {promptBreakdown.map(p => (
                <div key={p._id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-slate-700 truncate max-w-[140px]">
                      {p._id || 'Unknown'}
                    </span>
                    <span className="text-xs font-bold text-slate-900">{p.count}</span>
                  </div>
                  <MiniBar value={p.count} max={maxPromptCount} color="bg-violet-500" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Users + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top Active Users */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Top Active Users</h2>
            <span className="text-xs font-medium text-slate-400">By generations ({range}d)</span>
          </div>
          {topUsers.length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-300 text-sm">No usage data in this period</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {topUsers.map((u, idx) => (
                <div key={u.userId} className="px-6 py-3 flex items-center gap-3 hover:bg-slate-50/50 transition-colors">
                  <span className="w-6 h-6 rounded-full bg-violet-50 border border-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{u.fullName}</div>
                    <div className="text-xs text-slate-400 truncate">{u.email}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-slate-900">{u.generations} gen</div>
                    <div className="text-xs text-slate-400">{u.tokens.toLocaleString()} tokens</div>
                  </div>
                  <span className="ml-2 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md border border-indigo-100 flex-shrink-0">
                    {u.plan}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Recent AI Activity</h2>
            <span className="text-xs font-medium text-slate-400">Latest 10 requests</span>
          </div>
          {recentActivity.length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-300 text-sm">No recent activity</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentActivity.map(log => (
                <div key={log._id} className="px-6 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-bold text-slate-700 truncate">
                          {log.promptType || 'unknown'}
                        </span>
                        <StatusBadge status={log.status} />
                      </div>
                      <div className="text-xs text-slate-400 truncate">{log.userName} · {log.aiModel}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xs font-bold text-slate-900">{log.tokensUsed} tok</div>
                      <div className="text-xs text-slate-400">
                        {new Date(log.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short',
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
