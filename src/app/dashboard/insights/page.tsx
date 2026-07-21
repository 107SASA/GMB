'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useBusiness } from '@/context/BusinessContext';

type Range = 7 | 14 | 28 | 90;

interface InsightsData {
  connected: boolean;
  needsSync?: boolean;
  lastSyncAt?: string | null;
  googleEmail?: string | null;
  summary?: {
    totalViews: number;
    totalSearchViews: number;
    totalMapsViews: number;
    totalCallClicks: number;
    totalWebsiteClicks: number;
    totalDirectionRequests: number;
    totalConversations: number;
  };
  changes?: {
    views: number | null;
    searchViews: number | null;
    mapsViews: number | null;
    callClicks: number | null;
    websiteClicks: number | null;
    directionRequests: number | null;
    conversations: number | null;
  };
  timeSeries?: {
    date: string;
    views: number;
    callClicks: number;
    websiteClicks: number;
    directionRequests: number;
  }[];
  searchData?: {
    totalSearchImpressions: number;
    uniqueKeywords: number;
    keywordMonth: string | null;
    topKeywords: { keyword: string; impressions: number }[];
  };
}

// ── Skeleton shimmer card ─────────────────────────────────────────────────────
function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-6 animate-pulse ${className}`}>
      <div className="h-4 bg-slate-200 rounded w-1/3 mb-3" />
      <div className="h-8 bg-slate-200 rounded w-1/2 mb-2" />
      <div className="h-3 bg-slate-100 rounded w-1/4" />
    </div>
  );
}

// ── Change badge ──────────────────────────────────────────────────────────────
function ChangeBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">N/A</span>;
  }
  const isPositive = value > 0;
  const isZero = value === 0;
  const color = isZero
    ? 'text-slate-500 bg-slate-100'
    : isPositive
    ? 'text-emerald-700 bg-emerald-50'
    : 'text-rose-600 bg-rose-50';
  return (
    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${color}`}>
      {isPositive ? '+' : ''}{value}%
    </span>
  );
}

// ── Format relative time ──────────────────────────────────────────────────────
function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 2) return 'Just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ── Google "G" SVG ────────────────────────────────────────────────────────────
function GoogleGLogo() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  );
}

export default function InsightsPage() {
  const { activeBusiness } = useBusiness();
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selectedRange, setSelectedRange] = useState<Range>(28);

  // Read URL params on mount for post-OAuth redirect feedback
  const [connectedJustNow, setConnectedJustNow] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') setConnectedJustNow(true);
    const err = params.get('error');
    if (err) setOauthError(err);
  }, []);

  const fetchInsights = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/gbp/insights?range=${selectedRange}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Failed to fetch GBP insights', e);
    } finally {
      setLoading(false);
    }
  }, [activeBusiness, selectedRange]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/gbp/sync', { method: 'POST' });
      await fetchInsights();
    } finally {
      setSyncing(false);
    }
  };

  // ── STATE A: Not connected ─────────────────────────────────────────────────
  if (!loading && data && !data.connected) {
    return (
      <div className="min-h-screen bg-slate-50/50 p-4 sm:p-8 pt-10 flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 max-w-md w-full text-center">
          <div className="flex justify-center mb-4">
            <GoogleGLogo />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            Connect your Google Business Profile
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            See how customers find you on Google — call clicks, website visits, directions,
            search impressions, and top keywords. All in one place.
          </p>

          {oauthError && (
            <div className="mb-4 text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-4 py-2">
              Connection failed: {oauthError.replace(/_/g, ' ')}. Please try again.
            </div>
          )}

          <div className="text-left space-y-3 mb-6">
            {[
              { icon: '📞', text: 'See exactly how many people called from your Google listing' },
              { icon: '🌐', text: 'Track website visits driven by your Google profile' },
              { icon: '🔍', text: 'Discover which keywords bring customers to your business' },
            ].map((b) => (
              <div key={b.icon} className="flex items-start gap-3 text-sm text-slate-600">
                <span className="text-base">{b.icon}</span>
                <span>{b.text}</span>
              </div>
            ))}
          </div>

          <a
            href="/api/auth/google"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors w-full justify-center text-sm"
          >
            Connect Google Account →
          </a>
          <p className="text-xs text-slate-400 mt-3">
            We'll never post or edit anything on your profile. Read-only access only.
          </p>
        </div>
      </div>
    );
  }

  // ── STATE B: Loading skeleton ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50/50 p-4 sm:p-8 pt-10">
        <div className="max-w-[1400px] mx-auto">
          <div className="h-8 bg-slate-200 rounded w-48 mb-6 animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
            {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <SkeletonCard className="lg:col-span-2 h-72" />
            <SkeletonCard className="h-72" />
          </div>
          <SkeletonCard className="h-64" />
        </div>
      </div>
    );
  }

  // ── Reconnect required ─────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50/50 p-8 flex items-center justify-center">
        <p className="text-slate-500">Failed to load insights. Please try again.</p>
      </div>
    );
  }

  const { summary, changes, timeSeries = [], searchData, googleEmail, needsSync, lastSyncAt } = data;

  // ── STATE C: Connected, data loaded ───────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50/50 p-4 sm:p-8 pt-10">
      <div className="max-w-[1400px] mx-auto">

        {/* Connected-just-now banner */}
        {connectedJustNow && (
          <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700 flex items-center gap-2">
            <span>✅</span>
            <span>Google Business Profile connected! Click <strong>Sync Now</strong> to fetch your first data.</span>
          </div>
        )}

        {/* Stale data warning */}
        {needsSync && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
            <span>⚠️</span>
            <span>Data may be up to 5 days old — GBP metrics have a natural delay from Google.</span>
          </div>
        )}

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">GBP Performance</h1>
            {googleEmail && (
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-slate-500">Connected as {googleEmail}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Range tabs */}
            <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
              {([7, 14, 28, 90] as Range[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setSelectedRange(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    selectedRange === r
                      ? 'bg-white text-indigo-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {r}D
                </button>
              ))}
            </div>

            {/* Sync button */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              {syncing ? (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <span>↻</span>
              )}
              Sync Now
            </button>

            {/* Last sync time */}
            <span className="text-xs text-slate-400">
              Last synced {relativeTime(lastSyncAt)}
            </span>
          </div>
        </div>

        {/* Metrics row — every metric we fetch from Google */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-8">
          {[
            { label: 'Total Views', icon: '👁', value: summary?.totalViews ?? 0, change: changes?.views },
            { label: 'Search Views', icon: '🔍', value: summary?.totalSearchViews ?? 0, change: changes?.searchViews },
            { label: 'Maps Views', icon: '📍', value: summary?.totalMapsViews ?? 0, change: changes?.mapsViews },
            { label: 'Call Clicks', icon: '📞', value: summary?.totalCallClicks ?? 0, change: changes?.callClicks },
            { label: 'Website Clicks', icon: '🌐', value: summary?.totalWebsiteClicks ?? 0, change: changes?.websiteClicks },
            { label: 'Directions', icon: '🗺', value: summary?.totalDirectionRequests ?? 0, change: changes?.directionRequests },
            { label: 'Conversations', icon: '💬', value: summary?.totalConversations ?? 0, change: changes?.conversations },
          ].map((card) => (
            <div
              key={card.label}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-2xl">{card.icon}</span>
                <ChangeBadge value={card.change} />
              </div>
              <p className="text-xs font-medium text-slate-500 mb-1">{card.label}</p>
              <p className="text-2xl font-bold text-slate-900">
                {card.value.toLocaleString()}
              </p>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Performance over time — 2/3 width */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="font-bold text-slate-900 mb-6">Performance Over Time</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    dy={8}
                    tickFormatter={(v) => v.slice(5)} // "MM-DD"
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} dx={-8} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      fontSize: '12px',
                    }}
                  />
                  <Line type="monotone" dataKey="views" name="Views" stroke="#4f46e5" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="callClicks" name="Call Clicks" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="websiteClicks" name="Website Clicks" stroke="#8b5cf6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="directionRequests" name="Directions" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-4 mt-4">
              {[
                { color: '#4f46e5', label: 'Views' },
                { color: '#10b981', label: 'Call Clicks' },
                { color: '#8b5cf6', label: 'Website Clicks' },
                { color: '#f59e0b', label: 'Directions' },
              ].map((l) => (
                <div key={l.label} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: l.color }} />
                  {l.label}
                </div>
              ))}
            </div>
          </div>

          {/* Search visibility — 1/3 width */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <h3 className="font-bold text-slate-900 mb-6">Search Visibility</h3>

            <div className="space-y-4 mb-6">
              <div>
                <p className="text-2xl font-bold text-slate-900">
                  {(searchData?.totalSearchImpressions ?? 0).toLocaleString()}
                </p>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">Search Impressions</p>
                <p className="text-xs text-slate-400">Times you appeared for a search term</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">
                  {(searchData?.uniqueKeywords ?? 0).toLocaleString()}
                </p>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">Unique Keywords</p>
                <p className="text-xs text-slate-400">Distinct terms that surfaced your profile</p>
              </div>
            </div>

            <p className="text-[10px] text-slate-400 mt-4">
              {searchData?.keywordMonth ? `Search terms for ${searchData.keywordMonth} — ` : ''}
              Google provides keyword data monthly.
            </p>
          </div>
        </div>

        {/* Keywords table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-bold text-slate-900 mb-1">
            Top Keywords Bringing You Impressions
          </h3>
          <p className="text-xs text-slate-400 mb-6">{searchData?.keywordMonth ?? 'This month'}</p>

          {!searchData?.topKeywords?.length ? (
            <div className="text-center py-10 text-slate-400">
              <p className="text-sm font-medium mb-1">Keyword data updates monthly.</p>
              <p className="text-xs">Check back after your first full month of data.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider pb-3 pr-4 w-10">#</th>
                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider pb-3 pr-4">Keyword</th>
                    <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wider pb-3 pr-4 w-28">Impressions</th>
                    <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider pb-3 w-40">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {searchData.topKeywords.map((kw, i) => {
                    const maxImpressions = searchData.topKeywords[0]?.impressions ?? 1;
                    const pct = Math.round((kw.impressions / maxImpressions) * 100);
                    return (
                      <tr key={kw.keyword} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3 pr-4 text-slate-400 font-medium">{i + 1}</td>
                        <td className="py-3 pr-4 font-medium text-slate-800">{kw.keyword}</td>
                        <td className="py-3 pr-4 text-right font-semibold text-slate-900">
                          {kw.impressions.toLocaleString()}
                        </td>
                        <td className="py-3">
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 rounded-full"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Reconnect warning — only shown if token is known to be revoked */}
        {data.connected === false && (
          <div className="mt-6 bg-amber-50 border border-amber-200 rounded-2xl p-6 flex items-start gap-4">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-semibold text-amber-800 mb-1">
                Your Google connection needs to be refreshed.
              </p>
              <p className="text-sm text-amber-700 mb-3">
                Google access tokens expire periodically for security. Your historical data
                is safe — just reconnect to resume syncing.
              </p>
              <a
                href="/api/auth/google"
                className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                Reconnect Google Account →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
