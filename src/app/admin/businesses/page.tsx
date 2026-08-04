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
  // This workspace's own billing state (src/lib/workspaceAccess.ts is the
  // real per-workspace source of truth) — not userId.subscriptionPlan, which
  // is a legacy per-user field that predates per-workspace billing and can
  // be stale for a user who owns multiple workspaces on different plans.
  subscriptionStatus?: 'trialing' | 'active' | 'past_due' | 'canceled';
  userId?: {
    _id: string;
    fullName: string;
    email: string;
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
          ? 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed'
          : 'bg-surface text-outline border-outline-variant'
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
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center card-shadow">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-heading text-2xl font-bold text-on-surface">Businesses</h1>
            <p className="text-sm text-on-surface-variant font-medium">
              {pagination.total.toLocaleString()} total businesses on the platform
            </p>
          </div>
        </div>
        <button
          onClick={() => fetchBusinesses({ isRefresh: true })}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-surface-container-lowest border border-outline-variant rounded-xl text-sm font-semibold text-on-surface-variant hover:bg-surface transition-all shadow-sm disabled:opacity-60"
        >
          <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search by name, category, city…"
                className="w-full pl-9 pr-4 py-2.5 bg-surface border border-outline-variant rounded-xl text-sm font-medium text-on-surface placeholder:text-outline focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 bg-primary hover:bg-primary-container text-white text-sm font-bold rounded-xl transition-all"
            >
              Search
            </button>
          </form>

          {/* Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-outline flex-shrink-0" />
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleFilter(opt.value)}
                className={cn(
                  'px-3 py-2 rounded-xl text-xs font-bold transition-all border',
                  filter === opt.value
                    ? 'bg-primary-container text-on-primary-container border-primary-container'
                    : 'bg-surface text-on-surface-variant border-outline-variant hover:bg-surface-container'
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
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow py-24 flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin" />
          <p className="text-sm font-medium text-outline">Loading businesses…</p>
        </div>
      ) : error ? (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow py-24 text-center">
          <p className="text-sm text-error font-medium">{error}</p>
        </div>
      ) : businesses.length === 0 ? (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow py-24 text-center">
          <Building2 className="w-10 h-10 text-outline-variant mx-auto mb-3" />
          <p className="text-sm font-medium text-outline">No businesses found.</p>
          {search && (
            <button
              onClick={() => {
                setSearch('');
                setSearchInput('');
                setPage(1);
                fetchBusinesses({ search: '', filter, page: 1 });
              }}
              className="mt-3 text-xs text-primary hover:underline font-medium"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Table */}
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low">
                    <th className="text-left px-6 py-3 text-label-sm text-on-surface-variant">
                      Business
                    </th>
                    <th className="text-left px-6 py-3 text-label-sm text-on-surface-variant">
                      Owner
                    </th>
                    <th className="text-left px-6 py-3 text-label-sm text-on-surface-variant">
                      Contact
                    </th>
                    <th className="text-left px-6 py-3 text-label-sm text-on-surface-variant">
                      Integrations
                    </th>
                    <th className="text-left px-6 py-3 text-label-sm text-on-surface-variant">
                      Content
                    </th>
                    <th className="text-left px-6 py-3 text-label-sm text-on-surface-variant">
                      Joined
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {businesses.map(biz => (
                    <tr key={biz._id} className="hover:bg-surface/50 transition-colors">
                      {/* Business */}
                      <td className="px-6 py-4">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary-fixed border border-primary-fixed-dim flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Building2 className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <div className="font-semibold text-on-surface leading-tight">
                              {biz.name}
                            </div>
                            <div className="text-xs text-outline font-medium mt-0.5">
                              {biz.category}
                            </div>
                            {(biz.address || biz.city) && (
                              <div className="flex items-center gap-1 text-xs text-outline mt-1">
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
                            <div className="flex items-center gap-1.5 font-semibold text-on-surface">
                              <User className="w-3.5 h-3.5 text-outline" />
                              {biz.userId.fullName}
                            </div>
                            <div className="text-xs text-outline mt-0.5">
                              {biz.userId.email}
                            </div>
                            <span className={cn(
                              'mt-1 inline-block px-2 py-0.5 text-xs font-bold rounded-md border',
                              biz.subscriptionStatus === 'active'
                                ? 'bg-secondary-container/40 text-on-secondary-container border-secondary-fixed'
                                : biz.subscriptionStatus === 'past_due'
                                ? 'bg-error-container text-on-error-container border-error-container'
                                : biz.subscriptionStatus === 'canceled'
                                ? 'bg-surface text-on-surface-variant border-outline-variant'
                                : 'bg-primary-fixed text-primary border-primary-fixed-dim', // trialing / unset
                            )}>
                              {biz.subscriptionStatus ?? 'trialing'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-outline text-xs italic">No owner</span>
                        )}
                      </td>

                      {/* Contact */}
                      <td className="px-6 py-4">
                        <div className="space-y-1">
                          {biz.phone && (
                            <div className="flex items-center gap-1 text-xs text-on-surface-variant">
                              <Phone className="w-3 h-3" />
                              {biz.phone}
                            </div>
                          )}
                          {biz.website && (
                            <div className="flex items-center gap-1 text-xs text-on-surface-variant">
                              <Globe className="w-3 h-3" />
                              <a
                                href={biz.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-primary truncate max-w-[120px]"
                              >
                                {biz.website.replace(/^https?:\/\//, '')}
                              </a>
                            </div>
                          )}
                          {!biz.phone && !biz.website && (
                            <span className="text-outline text-xs italic">—</span>
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
                          <Sparkles className="w-4 h-4 text-primary" />
                          <span className="font-bold text-on-surface">
                            {biz.contentGeneratedCount.toLocaleString()}
                          </span>
                        </div>
                      </td>

                      {/* Joined */}
                      <td className="px-6 py-4 text-xs text-outline whitespace-nowrap">
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
              <p className="text-sm text-on-surface-variant font-medium">
                Showing{' '}
                <span className="font-bold text-on-surface">
                  {(pagination.page - 1) * pagination.limit + 1}–
                  {Math.min(pagination.page * pagination.limit, pagination.total)}
                </span>{' '}
                of{' '}
                <span className="font-bold text-on-surface">
                  {pagination.total.toLocaleString()}
                </span>{' '}
                businesses
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePage(page - 1)}
                  disabled={page === 1}
                  className="w-9 h-9 rounded-xl border border-outline-variant bg-surface-container-lowest flex items-center justify-center text-on-surface-variant hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
                      <span key={`ellipsis-${idx}`} className="px-2 text-outline text-sm">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => handlePage(p as number)}
                        className={cn(
                          'w-9 h-9 rounded-xl text-sm font-bold transition-all border',
                          page === p
                            ? 'bg-primary-container text-on-primary-container border-primary-container'
                            : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface'
                        )}
                      >
                        {p}
                      </button>
                    )
                  )}

                <button
                  onClick={() => handlePage(page + 1)}
                  disabled={page === pagination.totalPages}
                  className="w-9 h-9 rounded-xl border border-outline-variant bg-surface-container-lowest flex items-center justify-center text-on-surface-variant hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-all"
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
