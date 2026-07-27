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
  IndianRupee,
  Pencil,
  X,
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

const PLAN_OPTIONS   = ['all', 'Free', 'Pro'];
const STATUS_OPTIONS = ['all', 'Active', 'Trialing', 'PastDue', 'Canceled'];

// ── The single sellable plan (super-admin editable) ──────────────────────────
interface PlanDurationData {
  cycle: string;
  label: string;
  months: number;
  priceInr: number;
  enabled: boolean;
  razorpayPlanId: string | null;
}
interface BillingPlanData {
  displayName: string;
  description: string;
  priceInr: number;
  billingCycle: string;
  features: string[];
  durations: PlanDurationData[];
  razorpayConfigured: boolean;
  razorpayPlanReady: boolean;
}

interface PlanDraft {
  displayName: string;
  description: string;
  features: string[];
  durations: { cycle: string; label: string; priceInr: number; enabled: boolean }[];
}

function PlanPricingCard() {
  const [plan, setPlan]       = useState<BillingPlanData | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState<PlanDraft>({ displayName: '', description: '', features: [], durations: [] });
  const [saving, setSaving]   = useState(false);
  const [notice, setNotice]   = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/admin/billing-plan')
      .then(r => r.json())
      .then(json => { if (json.success) setPlan(json.data); })
      .catch(() => {});
  }, []);

  const startEdit = () => {
    if (!plan) return;
    setDraft({
      displayName: plan.displayName,
      description: plan.description,
      features: plan.features.length ? [...plan.features] : [''],
      durations: plan.durations.map(d => ({ cycle: d.cycle, label: d.label, priceInr: d.priceInr, enabled: d.enabled })),
    });
    setNotice(null);
    setEditing(true);
  };

  const setDuration = (cycle: string, patch: Partial<{ priceInr: number; enabled: boolean }>) =>
    setDraft(d => ({ ...d, durations: d.durations.map(x => x.cycle === cycle ? { ...x, ...patch } : x) }));

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const res  = await fetch('/api/admin/billing-plan', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          displayName: draft.displayName,
          description: draft.description,
          features: draft.features.map(f => f.trim()).filter(Boolean),
          durations: draft.durations.map(d => ({ cycle: d.cycle, priceInr: d.priceInr, enabled: d.enabled })),
        }),
      });
      const json = await res.json();
      if (!json.success) {
        setNotice({ kind: 'err', text: json.error || 'Save failed' });
        return;
      }
      setPlan(json.data);
      setEditing(false);
      setNotice(json.warning
        ? { kind: 'warn', text: json.warning }
        : { kind: 'ok', text: 'Plan updated. New checkouts use the new prices; existing subscribers keep their current price.' });
    } catch {
      setNotice({ kind: 'err', text: 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  if (!plan) return null;

  const enabledDurations = plan.durations.filter(d => d.enabled);
  const canSave = draft.displayName.trim() && draft.durations.some(d => d.enabled) &&
    draft.durations.every(d => !d.enabled || d.priceInr >= 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-md shadow-emerald-600/20">
            <IndianRupee className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-slate-900">Subscription Plan</h2>
            <p className="text-xs text-slate-400">Design the plan customers subscribe to — durations, prices &amp; features</p>
          </div>
        </div>
        {!editing && (
          <button
            onClick={startEdit}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 transition-all"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit plan
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Plan name</label>
              <input
                type="text" value={draft.displayName} maxLength={60}
                onChange={e => setDraft(d => ({ ...d, displayName: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
              <input
                type="text" value={draft.description} maxLength={300}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
              />
            </div>
          </div>

          {/* Durations */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Billing durations &amp; prices</label>
            <div className="space-y-2">
              {draft.durations.map(d => (
                <div key={d.cycle} className={cn(
                  'flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                  d.enabled ? 'border-violet-200 bg-violet-50/40' : 'border-slate-200 bg-slate-50'
                )}>
                  <label className="flex items-center gap-2 cursor-pointer select-none w-32 shrink-0">
                    <input type="checkbox" checked={d.enabled} onChange={e => setDuration(d.cycle, { enabled: e.target.checked })} />
                    <span className="text-sm font-semibold text-slate-700">{d.label}</span>
                  </label>
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-slate-400 text-sm">₹</span>
                    <input
                      type="number" min={1} value={d.priceInr} disabled={!d.enabled}
                      onChange={e => setDuration(d.cycle, { priceInr: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-32 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 disabled:opacity-50 disabled:bg-slate-100"
                    />
                    <span className="text-xs text-slate-400">/ {d.label.toLowerCase()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Features */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Features (shown on the pricing card)</label>
            <div className="space-y-2">
              {draft.features.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text" value={f} maxLength={120} placeholder="e.g. Unlimited AI posts"
                    onChange={e => setDraft(d => ({ ...d, features: d.features.map((x, idx) => idx === i ? e.target.value : x) }))}
                    className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                  />
                  <button
                    onClick={() => setDraft(d => ({ ...d, features: d.features.filter((_, idx) => idx !== i) }))}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {draft.features.length < 12 && (
                <button
                  onClick={() => setDraft(d => ({ ...d, features: [...d.features, ''] }))}
                  className="text-sm font-semibold text-violet-600 hover:text-violet-700"
                >
                  + Add feature
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={save} disabled={saving || !canSave}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-bold rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-60 shadow-sm"
            >
              {saving ? (
                <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> Save plan</>
              )}
            </button>
            <button onClick={() => setEditing(false)} className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors">
              <X className="w-4 h-4" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <div>
              <div className="text-sm font-semibold text-slate-600">{plan.displayName}</div>
              <p className="text-sm text-slate-500 max-w-md mt-0.5">{plan.description}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg border w-fit',
                plan.razorpayConfigured ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'
              )}>
                {plan.razorpayConfigured ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                {plan.razorpayConfigured ? 'Razorpay connected' : 'Razorpay keys missing'}
              </span>
            </div>
          </div>

          {/* Duration chips */}
          <div className="flex flex-wrap gap-2">
            {enabledDurations.map(d => (
              <span key={d.cycle} className="inline-flex items-baseline gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-lg font-extrabold text-slate-900">₹{d.priceInr.toLocaleString('en-IN')}</span>
                <span className="text-xs font-medium text-slate-400">/ {d.label}</span>
              </span>
            ))}
          </div>

          {/* Features preview */}
          {plan.features.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {plan.features.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" /> {f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {notice && (
        <div className={cn(
          'mt-4 px-3 py-2.5 rounded-xl text-xs font-medium border',
          notice.kind === 'ok'   && 'bg-emerald-50 border-emerald-200 text-emerald-700',
          notice.kind === 'warn' && 'bg-amber-50 border-amber-200 text-amber-700',
          notice.kind === 'err'  && 'bg-red-50 border-red-200 text-red-700',
        )}>
          {notice.text}
        </div>
      )}
    </div>
  );
}

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

      {/* The single sellable plan (price editable) */}
      <PlanPricingCard />

      {/* Overview cards */}
      {overview && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <OverviewCard label="Free"     value={overview.byPlan.Free}                                  icon={Users}        color="bg-slate-500" />
          <OverviewCard label="Paid"     value={overview.byPlan.Pro + overview.byPlan.Enterprise}      icon={CreditCard}   color="bg-indigo-600" />
          <OverviewCard label="Active"   value={overview.byStatus.Active}                              icon={CheckCircle2} color="bg-emerald-600" />
          <OverviewCard label="Trialing" value={overview.byStatus.Trialing}                            icon={Clock}        color="bg-cyan-600" />
          <OverviewCard label="Canceled" value={overview.byStatus.Canceled}                            icon={XCircle}      color="bg-rose-500" />
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
