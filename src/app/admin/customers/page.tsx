'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Search,
  ChevronDown,
  ChevronRight,
  UserCheck,
  RefreshCw,
  Calendar,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────
interface CustomerBusiness {
  _id: string;
  name: string;
  category: string;
  address?: string;
  city?: string;
}

interface CustomerSubscription {
  planType: string;
  billingStatus: string;
  trialActive?: boolean;
}

interface Customer {
  _id: string;
  fullName: string;
  email: string;
  phone?: string;
  createdAt: string;
  subscriptionPlan: string;
  onboardingCompleted: boolean;
  business: CustomerBusiness | null;
  subscription: CustomerSubscription | null;
  isActive: boolean;
}

interface Stats {
  totalUsers: number;
  newThisWeek: number;
  proUsers: number;
  enterpriseUsers: number;
}

interface ApiResponse {
  users: Customer[];
  total: number;
  page: number;
  totalPages: number;
  stats: Stats;
}

// ── Plan badge ────────────────────────────────────────────────────────────────
function PlanBadge({ plan }: { plan: string }) {
  const map: Record<string, string> = {
    Free:       'bg-slate-50 text-slate-600 border-slate-200',
    Pro:        'bg-indigo-50 text-indigo-700 border-indigo-100',
    Enterprise: 'bg-violet-50 text-violet-700 border-violet-100',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', map[plan] ?? map.Free)}>
      {plan}
    </span>
  );
}

// ── Avatar initials ───────────────────────────────────────────────────────────
function Avatar({ name, plan }: { name: string; plan: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

  const color =
    plan === 'Enterprise' ? 'bg-violet-600' :
    plan === 'Pro'        ? 'bg-indigo-600' : 'bg-slate-400';

  return (
    <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0', color)}>
      {initials || '?'}
    </div>
  );
}

// ── Billing status badge ──────────────────────────────────────────────────────
function BillingBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Active:   'bg-emerald-50 text-emerald-700 border-emerald-100',
    Trialing: 'bg-cyan-50 text-cyan-700 border-cyan-100',
    PastDue:  'bg-amber-50 text-amber-700 border-amber-100',
    Canceled: 'bg-rose-50 text-rose-700 border-rose-100',
  };
  return (
    <span className={cn('px-2 py-0.5 text-xs font-bold rounded-md border', map[status] ?? 'bg-slate-50 text-slate-600 border-slate-200')}>
      {status}
    </span>
  );
}

// ── Expanded row ──────────────────────────────────────────────────────────────
function ExpandedRow({ customer, onImpersonate, impersonating }: {
  customer: Customer;
  onImpersonate: (businessId: string) => void;
  impersonating: boolean;
}) {
  return (
    <tr className="bg-violet-50/40">
      <td colSpan={7} className="px-6 py-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Email</p>
            <p className="text-slate-700 font-medium">{customer.email}</p>
          </div>
          {customer.phone && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">Phone</p>
              <p className="text-slate-700 font-medium">{customer.phone}</p>
            </div>
          )}
          {customer.business && (
            <>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase mb-1">Business</p>
                <p className="text-slate-700 font-medium">{customer.business.name}</p>
                <p className="text-slate-500 text-xs">{customer.business.category}</p>
              </div>
              {(customer.business.address || customer.business.city) && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">Address</p>
                  <p className="text-slate-700 font-medium">
                    {[customer.business.address, customer.business.city].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}
            </>
          )}
          {customer.subscription && (
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">Billing</p>
              <BillingBadge status={customer.subscription.billingStatus} />
              {customer.subscription.trialActive && (
                <span className="ml-2 text-xs text-cyan-600 font-semibold">Trial active</span>
              )}
            </div>
          )}
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Onboarding</p>
            <span className={cn(
              'text-xs font-bold',
              customer.onboardingCompleted ? 'text-emerald-600' : 'text-amber-500'
            )}>
              {customer.onboardingCompleted ? 'Completed' : 'Incomplete'}
            </span>
          </div>
          {customer.business?._id && (
            <div className="ml-auto flex items-end">
              <button
                onClick={() => onImpersonate(customer.business!._id)}
                disabled={impersonating}
                className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-xs font-bold rounded-xl hover:bg-violet-700 transition-all disabled:opacity-60 shadow-sm"
              >
                <UserCheck className="w-4 h-4" />
                {impersonating ? 'Switching...' : 'Impersonate'}
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CustomersPage() {
  const router = useRouter();
  const [data, setData]           = useState<ApiResponse | null>(null);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [plan, setPlan]           = useState('all');
  const [page, setPage]           = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (opts: {
    page?: number; search?: string; plan?: string; refresh?: boolean;
  } = {}) => {
    const p = opts.page   ?? page;
    const s = opts.search ?? search;
    const pl = opts.plan  ?? plan;

    if (opts.refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page:  String(p),
        limit: '20',
        search: s,
        plan:   pl,
      });
      const res  = await fetch(`/api/admin/customers?${params}`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Failed to load customers');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, search, plan]);

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchData({ search: val, page: 1 });
    }, 350);
  };

  const handlePlan = (val: string) => {
    setPlan(val);
    setPage(1);
    fetchData({ plan: val, page: 1 });
  };

  const handlePage = (p: number) => {
    setPage(p);
    fetchData({ page: p });
  };

  const handleImpersonate = async (customerId: string, businessId: string) => {
    setImpersonatingId(customerId);
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });
      const json = await res.json();
      if (json.success) {
        router.push('/dashboard');
      } else {
        alert(json.error || 'Impersonation failed');
      }
    } catch {
      alert('Network error during impersonation');
    } finally {
      setImpersonatingId(null);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-medium text-slate-500">Loading customers...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-rose-500 font-medium mb-3">{error}</p>
          <button onClick={() => fetchData()} className="text-sm text-violet-600 hover:underline font-medium">Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { users, total, totalPages, stats } = data;
  const start = (page - 1) * 20 + 1;
  const end   = Math.min(page * 20, total);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-600/20">
            <Users className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
              <span className="px-2.5 py-0.5 bg-violet-50 text-violet-700 text-sm font-bold rounded-full border border-violet-100">
                {total.toLocaleString()}
              </span>
            </div>
            <p className="text-sm text-slate-500 font-medium">Platform users and their subscription details</p>
          </div>
        </div>
        <button
          onClick={() => fetchData({ refresh: true })}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Users',       value: stats.totalUsers,      color: 'bg-slate-600' },
          { label: 'New This Week',     value: stats.newThisWeek,     color: 'bg-cyan-600' },
          { label: 'Pro Users',         value: stats.proUsers,        color: 'bg-indigo-600' },
          { label: 'Enterprise Users',  value: stats.enterpriseUsers, color: 'bg-violet-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center mb-3', s.color)}>
              <Users className="w-4 h-4 text-white" />
            </div>
            <div className="text-2xl font-bold text-slate-900">{s.value.toLocaleString()}</div>
            <div className="text-sm text-slate-500 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 shadow-sm"
          />
        </div>
        <div className="relative">
          <select
            value={plan}
            onChange={e => handlePlan(e.target.value)}
            className="pl-4 pr-9 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300 shadow-sm appearance-none font-medium text-slate-700"
          >
            <option value="all">All Plans</option>
            <option value="Free">Free</option>
            <option value="Pro">Pro</option>
            <option value="Enterprise">Enterprise</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Business</th>
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Plan</th>
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Joined</th>
              <th className="px-6 py-3 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 text-sm">
                  No customers found
                </td>
              </tr>
            )}
            {users.map(customer => {
              const isExpanded = expandedId === customer._id;
              return (
                <>
                  <tr
                    key={customer._id}
                    className="hover:bg-slate-50/60 transition-colors cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : customer._id)}
                  >
                    {/* User */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={customer.fullName} plan={customer.subscriptionPlan} />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">{customer.fullName}</div>
                          <div className="text-xs text-slate-400 truncate">{customer.email}</div>
                        </div>
                      </div>
                    </td>
                    {/* Business */}
                    <td className="px-6 py-4">
                      {customer.business ? (
                        <div>
                          <div className="text-sm font-semibold text-slate-900 truncate max-w-[180px]">{customer.business.name}</div>
                          <div className="text-xs text-slate-400">{customer.business.category}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300 font-medium">No business</span>
                      )}
                    </td>
                    {/* Plan */}
                    <td className="px-6 py-4">
                      <PlanBadge plan={customer.subscriptionPlan} />
                    </td>
                    {/* Joined */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5 text-sm text-slate-500">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(customer.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-6 py-4">
                      <span className={cn(
                        'px-2 py-0.5 text-xs font-bold rounded-md border',
                        customer.isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : 'bg-slate-50 text-slate-500 border-slate-200'
                      )}>
                        {customer.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {/* Expand toggle */}
                    <td className="px-6 py-4 text-right">
                      {isExpanded
                        ? <ChevronDown className="w-4 h-4 text-slate-400 ml-auto" />
                        : <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />}
                    </td>
                  </tr>
                  {isExpanded && (
                    <ExpandedRow
                      key={`${customer._id}-expand`}
                      customer={customer}
                      onImpersonate={(bizId) => handleImpersonate(customer._id, bizId)}
                      impersonating={impersonatingId === customer._id}
                    />
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 mb-10">
          <p className="text-sm text-slate-500">
            Showing <span className="font-semibold text-slate-900">{start}–{end}</span> of{' '}
            <span className="font-semibold text-slate-900">{total}</span>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePage(page - 1)}
              disabled={page <= 1}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm font-medium text-slate-500 px-2">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => handlePage(page + 1)}
              disabled={page >= totalPages}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Recent Demo Requests */}
      <RecentDemoRequests />
    </div>
  );
}

// ── Recent Demo Requests section ──────────────────────────────────────────────
function RecentDemoRequests() {
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading]  = useState(true);

  useEffect(() => {
    fetch('/api/admin/demo-bookings?limit=3')
      .then(r => r.json())
      .then(json => {
        if (json.success && json.bookings) {
          setBookings(json.bookings.slice(0, 3));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="text-base font-bold text-slate-900">GMBBoost Demo Requests</h2>
        <Link
          href="/admin/demo-bookings"
          className="text-sm font-semibold text-violet-600 hover:underline flex items-center gap-1"
        >
          View All <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      {loading ? (
        <div className="px-6 py-8 text-center text-sm text-slate-400">Loading...</div>
      ) : bookings.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-slate-400">No demo requests yet</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {bookings.map((b: any) => (
            <div key={b._id} className="px-6 py-4 flex items-center gap-4">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-4 h-4 text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-slate-900 truncate">{b.name}</div>
                <div className="text-xs text-slate-400 truncate">{b.email} · {b.company}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs font-semibold text-slate-700">
                  {new Date(b.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </div>
                <span className={cn(
                  'text-xs font-bold px-2 py-0.5 rounded-md border',
                  b.status === 'Pending'   ? 'bg-amber-50 text-amber-700 border-amber-100' :
                  b.status === 'Confirmed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                  'bg-slate-50 text-slate-600 border-slate-200'
                )}>
                  {b.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
