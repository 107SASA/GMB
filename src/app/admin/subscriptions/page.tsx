'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────
interface SubUser {
  _id: string; fullName: string; email: string; phone?: string;
  subscriptionPlan?: string; joinedAt: string; lastLoginAt?: string;
}
interface SubUsage {
  aiGenerations: number; aiGenerationsLimit: number;
  whatsappMessages: number; reviewRequests: number; contentUsage: number;
}
interface Subscription {
  _id: string;
  planType: 'Free' | 'Pro' | 'Enterprise';
  billingStatus: 'Active' | 'PastDue' | 'Canceled' | 'Trialing';
  trialStatus: { isActive: boolean; endsAt?: string };
  modules: Record<string, { enabled: boolean; activatedAt?: string }>;
  createdAt: string; updatedAt: string;
  user: SubUser | null;
  usage: SubUsage | null;
}
interface Overview {
  total: number;
  byPlan:   { Free: number; Pro: number; Enterprise: number };
  byStatus: { Active: number; Trialing: number; Canceled: number };
}
interface Pagination { total: number; page: number; limit: number; totalPages: number; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const PLAN_COLORS: Record<string, string> = {
  Free:       'bg-slate-50   text-slate-500   border-slate-200',
  Pro:        'bg-indigo-50  text-indigo-700  border-indigo-100',
  Enterprise: 'bg-violet-50  text-violet-700  border-violet-100',
};
const STATUS_COLORS: Record<string, string> = {
  Active:   'bg-emerald-50 text-emerald-700 border-emerald-100',
  Trialing: 'bg-cyan-50    text-cyan-700    border-cyan-100',
  PastDue:  'bg-amber-50   text-amber-700   border-amber-100',
  Canceled: 'bg-rose-50    text-rose-700    border-rose-100',
};
const STATUS_ICONS: Record<string, React.ElementType> = {
  Active:   CheckCircle2,
  Trialing: Clock,
  PastDue:  AlertCircle,
  Canceled: XCircle,
};

const MODULE_LABELS: Record<string, string> = {
  google_ranking_agent:   'Google Ranking',
  reputation_agent:       'Reputation',
  sales_agent:            'Sales Agent',
  content_studio:         'Content Studio',
  marketing_automation:   'Marketing',
};

const PLAN_OPTIONS   = ['all', 'Free', 'Pro', 'Enterprise'];
const STATUS_OPTIONS = ['all', 'Active', 'Trialing', 'PastDue', 'Canceled'];

function OverviewCard({
  label, value, icon: Icon, color,
}: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm flex items-center gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-900">{value.toLocaleString()}</div>
        <div className="text-xs font-medium text-slate-500">{label}</div>
      </div>
    </div>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="flex-shrink-0 font-medium">{used}/{limit}</span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SubscriptionsPage() {
  const router = useRouter();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [overview, setOverview]           = useState<Overview | null>(null);
  const [pagination, setPagination]       = useState<Pagination>({ total: 0, page: 1, limit: 20, totalPages: 1 });
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [error, setError]                 = useState('');
  const [searchInput, setSearchInput]     = useState('');
  const [search, setSearch]               = useState('');
  const [planFilter, setPlanFilter]       = useState('all');
  const [statusFilter, setStatusFilter]   = useState('all');
  const [page, setPage]                   = useState(1);

  const fetchData = useCallback(async (opts?: {
    search?: string; plan?: string; status?: string; page?: number; isRefresh?: boolean;
  }) => {
    const q  = opts?.search  ?? search;
    const pl = opts?.plan    ?? planFilter;
    const st = opts?.status  ?? statusFilter;
    const pg = opts?.page    ?? page;
    const isRefresh = opts?.isRefresh ?? false;

    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ page: String(pg), limit: '20', search: q, plan: pl, status: st });
      const res  = await fetch(`/api/admin/subscriptions?${params}`);
      const json = await res.json();

      if (json.success) {
        setSubscriptions(json.data.subscriptions);
        setOverview(json.data.overview);
        setPagination(json.data.pagination);
      } else if (json.error?.includes('Unauthorized') || json.error?.includes('Forbidden')) {
        router.push('/admin/login');
      } else {
        setError(json.error || 'Failed to load');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, planFilter, statusFilter, page, router]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
    fetchData({ search: searchInput, plan: planFilter, status: statusFilter, page: 1 });
  };
  const handlePlan = (v: string) => {
    setPlanFilter(v); setPage(1);
    fetchData({ search, plan: v, status: statusFilter, page: 1 });
  };
  const handleStatus = (v: string) => {
    setStatusFilter(v); setPage(1);
    fetchData({ search, plan: planFilter, status: v, page: 1 });
  };
  const handlePage = (p: number) => {
    setPage(p);
    fetchData({ search, plan: planFilter, status: statusFilter, page: p });
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium text-slate-500">Loading subscriptions...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-sm text-rose-500 font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-600/20">
            <CreditCard className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Subscriptions</h1>
            <p className="text-sm text-slate-500 font-medium">
              {pagination.total.toLocaleString()} total subscriptions
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchData({ isRefresh: true })}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Overview cards */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <OverviewCard label="Free"       value={overview.byPlan.Free}          icon={Users}        color="bg-slate-500" />
          <OverviewCard label="Pro"        value={overview.byPlan.Pro}           icon={CreditCard}   color="bg-indigo-600" />
          <OverviewCard label="Enterprise" value={overview.byPlan.Enterprise}    icon={CreditCard}   color="bg-violet-600" />
          <OverviewCard label="Active"     value={overview.byStatus.Active}      icon={CheckCircle2} color="bg-emerald-600" />
          <OverviewCard label="Trialing"   value={overview.byStatus.Trialing}    icon={Clock}        color="bg-cyan-600" />
          <OverviewCard label="Canceled"   value={overview.byStatus.Canceled}    icon={XCircle}      color="bg-rose-500" />
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            <button type="submit" className="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl transition-all">
              Search
            </button>
          </form>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
            {/* Plan filter */}
            {PLAN_OPTIONS.map(opt => (
              <button
                key={opt}
                onClick={() => handlePlan(opt)}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-bold transition-all border',
                  planFilter === opt
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                )}
              >
                {opt === 'all' ? 'All Plans' : opt}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_OPTIONS.filter(o => o !== 'all').map(opt => (
              <button
                key={opt}
                onClick={() => handleStatus(statusFilter === opt ? 'all' : opt)}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-bold transition-all border',
                  statusFilter === opt
                    ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      {subscriptions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm py-24 text-center">
          <CreditCard className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-400">No subscriptions found.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    {['User', 'Plan', 'Status', 'Modules', 'AI Usage', 'Trial / Since'].map(h => (
                      <th key={h} className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subscriptions.map(sub => {
                    const StatusIcon = STATUS_ICONS[sub.billingStatus] ?? AlertCircle;
                    const enabledModules = Object.entries(sub.modules ?? {})
                      .filter(([, v]) => v?.enabled)
                      .map(([k]) => MODULE_LABELS[k] ?? k);

                    return (
                      <tr key={sub._id} className="hover:bg-slate-50/50 transition-colors">
                        {/* User */}
                        <td className="px-6 py-4">
                          {sub.user ? (
                            <div>
                              <div className="font-semibold text-slate-900 leading-tight">{sub.user.fullName}</div>
                              <div className="text-xs text-slate-400 mt-0.5">{sub.user.email}</div>
                            </div>
                          ) : (
                            <span className="text-slate-300 text-xs italic">No user</span>
                          )}
                        </td>

                        {/* Plan */}
                        <td className="px-6 py-4">
                          <span className={cn('px-2.5 py-1 text-xs font-bold rounded-lg border', PLAN_COLORS[sub.planType])}>
                            {sub.planType}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-6 py-4">
                          <span className={cn('inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border', STATUS_COLORS[sub.billingStatus])}>
                            <StatusIcon className="w-3 h-3" />
                            {sub.billingStatus}
                          </span>
                          {sub.trialStatus?.isActive && sub.trialStatus?.endsAt && (
                            <div className="text-[10px] text-slate-400 mt-1">
                              Trial ends {new Date(sub.trialStatus.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </div>
                          )}
                        </td>

                        {/* Modules */}
                        <td className="px-6 py-4">
                          {enabledModules.length === 0 ? (
                            <span className="text-slate-300 text-xs italic">None</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {enabledModules.slice(0, 3).map(m => (
                                <span key={m} className="px-1.5 py-0.5 bg-cyan-50 text-cyan-700 text-[10px] font-bold rounded border border-cyan-100">
                                  {m}
                                </span>
                              ))}
                              {enabledModules.length > 3 && (
                                <span className="px-1.5 py-0.5 bg-slate-50 text-slate-400 text-[10px] font-bold rounded border border-slate-200">
                                  +{enabledModules.length - 3}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* AI Usage */}
                        <td className="px-6 py-4 min-w-[140px]">
                          {sub.usage ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                                <Zap className="w-3 h-3 text-cyan-500" /> AI Generations
                              </div>
                              <UsageBar used={sub.usage.aiGenerations} limit={sub.usage.aiGenerationsLimit} />
                            </div>
                          ) : (
                            <span className="text-slate-300 text-xs italic">No data</span>
                          )}
                        </td>

                        {/* Dates */}
                        <td className="px-6 py-4 text-xs text-slate-400 whitespace-nowrap">
                          {sub.trialStatus?.isActive ? (
                            <span className="text-cyan-600 font-semibold">In Trial</span>
                          ) : (
                            <span>
                              Since{' '}
                              {new Date(sub.createdAt).toLocaleDateString('en-GB', {
                                day: 'numeric', month: 'short', year: 'numeric',
                              })}
                            </span>
                          )}
                          {sub.user?.lastLoginAt && (
                            <div className="text-[10px] text-slate-300 mt-0.5">
                              Last login{' '}
                              {new Date(sub.user.lastLoginAt).toLocaleDateString('en-GB', {
                                day: 'numeric', month: 'short',
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 font-medium">
                Showing{' '}
                <span className="font-bold text-slate-900">
                  {(pagination.page - 1) * pagination.limit + 1}–
                  {Math.min(pagination.page * pagination.limit, pagination.total)}
                </span>{' '}
                of{' '}
                <span className="font-bold text-slate-900">{pagination.total.toLocaleString()}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePage(page - 1)}
                  disabled={page === 1}
                  className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: pagination.totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === pagination.totalPages || Math.abs(p - page) <= 1)
                  .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                    if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1)
                      acc.push('...');
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === '...' ? (
                      <span key={`e${idx}`} className="px-2 text-slate-400 text-sm">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => handlePage(p as number)}
                        className={cn(
                          'w-9 h-9 rounded-xl text-sm font-bold transition-all border',
                          page === p
                            ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        )}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  onClick={() => handlePage(page + 1)}
                  disabled={page === pagination.totalPages}
                  className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
