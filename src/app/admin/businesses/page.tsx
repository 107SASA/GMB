'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Phone,
  Globe,
  User,
  Sparkles,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Business {
  _id: string;
  name: string;
  category: string;
  address: string;
  city?: string;
  phone?: string;
  website?: string;
  googleConnected: boolean;
  onboardingCompleted: boolean;
  contentGeneratedCount: number;
  createdAt: string;
  whatsappConfig?: { isConnected: boolean };
  userId?: {
    _id: string;
    fullName: string;
    email: string;
    subscriptionPlan?: string;
  };
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const FILTER_OPTIONS = [
  { value: 'all', label: 'All Businesses' },
  { value: 'google', label: 'Google Connected' },
  { value: 'whatsapp', label: 'WhatsApp Active' },
  { value: 'onboarded', label: 'Fully Onboarded' },
];

function StatusBadge({ connected, label }: { connected: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border',
        connected
          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
          : 'bg-slate-50 text-slate-400 border-slate-200'
      )}
    >
      {connected ? (
        <CheckCircle2 className="w-3 h-3" />
      ) : (
        <XCircle className="w-3 h-3" />
      )}
      {label}
    </span>
  );
}

export default function AdminBusinessesPage() {
  const router = useRouter();

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const fetchBusinesses = useCallback(
    async (opts?: { search?: string; filter?: string; page?: number; isRefresh?: boolean }) => {
      const q = opts?.search ?? search;
      const f = opts?.filter ?? filter;
      const p = opts?.page ?? page;
      const isRefresh = opts?.isRefresh ?? false;

      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError('');

      try {
        const params = new URLSearchParams({
          page: String(p),
          limit: '20',
          search: q,
          filter: f,
        });

        const res = await fetch(`/api/admin/businesses?${params}`);
        const json = await res.json();

        if (json.success) {
          setBusinesses(json.data.businesses);
          setPagination(json.data.pagination);
        } else if (
          json.error?.includes('Unauthorized') ||
          json.error?.includes('Forbidden')
        ) {
          router.push('/admin/login');
        } else {
          setError(json.error || 'Failed to load businesses');
        }
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, filter, page, router]
  );

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
    fetchBusinesses({ search: searchInput, filter, page: 1 });
  };

  const handleFilter = (value: string) => {
    setFilter(value);
    setPage(1);
    fetchBusinesses({ search, filter: value, page: 1 });
  };

  const handlePage = (newPage: number) => {
    setPage(newPage);
    fetchBusinesses({ search, filter, page: newPage });
  };

  return (
    <div>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-600/20">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Businesses</h1>
            <p className="text-sm text-slate-500 font-medium">
              {pagination.total.toLocaleString()} total businesses on the platform
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchBusinesses({ isRefresh: true })}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search by name, category, city…"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl transition-all"
            >
              Search
            </button>
          </form>

          {/* Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleFilter(opt.value)}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-bold transition-all border',
                  filter === opt.value
                    ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                    : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm py-24 flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-400">Loading businesses…</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm py-24 text-center">
          <p className="text-sm text-rose-500 font-medium">{error}</p>
        </div>
      ) : businesses.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm py-24 text-center">
          <Building2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-400">No businesses found.</p>
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setSearchInput('');
                setPage(1);
                fetchBusinesses({ search: '', filter, page: 1 });
              }}
              className="mt-3 text-xs text-violet-600 hover:underline font-medium"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Business
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Owner
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Contact
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Integrations
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Content
                    </th>
                    <th className="text-left px-6 py-3 text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Joined
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {businesses.map(biz => (
                    <tr key={biz._id} className="hover:bg-slate-50/50 transition-colors">
                      {/* Business */}
                      <td className="px-6 py-4">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Building2 className="w-4 h-4 text-indigo-600" />
                          </div>
                          <div>
                            <div className="font-semibold text-slate-900 leading-tight">
                              {biz.name}
                            </div>
                            <div className="text-xs text-slate-400 font-medium mt-0.5">
                              {biz.category}
                            </div>
                            {(biz.address || biz.city) && (
                              <div className="flex items-center gap-1 text-xs text-slate-400 mt-1">
                                <MapPin className="w-3 h-3" />
                                {biz.city || biz.address?.split(',')[0]}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Owner */}
                      <td className="px-6 py-4">
                        {biz.userId ? (
                          <div>
                            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                              <User className="w-3.5 h-3.5 text-slate-400" />
                              {biz.userId.fullName}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              {biz.userId.email}
                            </div>
                            <span className="mt-1 inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md border border-indigo-100">
                              {biz.userId.subscriptionPlan || 'Free'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs italic">No owner</span>
                        )}
                      </td>

                      {/* Contact */}
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {biz.phone && (
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                              <Phone className="w-3 h-3" />
                              {biz.phone}
                            </div>
                          )}
                          {biz.website && (
                            <div className="flex items-center gap-1 text-xs text-slate-500">
                              <Globe className="w-3 h-3" />
                              <a
                                href={biz.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-indigo-600 truncate max-w-[120px]"
                              >
                                {biz.website.replace(/^https?:\/\//, '')}
                              </a>
                            </div>
                          )}
                          {!biz.phone && !biz.website && (
                            <span className="text-slate-300 text-xs italic">—</span>
                          )}
                        </div>
                      </td>

                      {/* Integrations */}
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1.5">
                          <StatusBadge connected={biz.googleConnected} label="Google" />
                          <StatusBadge
                            connected={biz.whatsappConfig?.isConnected ?? false}
                            label="WhatsApp"
                          />
                          <StatusBadge
                            connected={biz.onboardingCompleted}
                            label="Onboarded"
                          />
                        </div>
                      </td>

                      {/* Content Generated */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-cyan-500" />
                          <span className="font-bold text-slate-900">
                            {biz.contentGeneratedCount.toLocaleString()}
                          </span>
                        </div>
                      </td>

                      {/* Joined */}
                      <td className="px-6 py-4 text-xs text-slate-400 whitespace-nowrap">
                        {new Date(biz.createdAt).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
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
                <span className="font-bold text-slate-900">
                  {pagination.total.toLocaleString()}
                </span>{' '}
                businesses
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
                  .filter(
                    p =>
                      p === 1 ||
                      p === pagination.totalPages ||
                      Math.abs(p - page) <= 1
                  )
                  .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                    if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) {
                      acc.push('...');
                    }
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === '...' ? (
                      <span key={`ellipsis-${idx}`} className="px-2 text-slate-400 text-sm">
                        …
                      </span>
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
