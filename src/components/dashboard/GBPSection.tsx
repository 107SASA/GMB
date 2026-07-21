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
import { Eye, Phone, Globe, MapPin, MessageCircle, Search, Map, RefreshCw } from 'lucide-react';

type GBPRange = 7 | 14 | 28 | 90;

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

function GoogleGLogo({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  );
}

function ChangeBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">N/A</span>;
  }
  if (value === 0) {
    return <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">—</span>;
  }
  const positive = value > 0;
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${positive ? 'text-emerald-700 bg-emerald-50' : 'text-rose-600 bg-rose-50'}`}>
      {positive ? '+' : ''}{value}%
    </span>
  );
}

function relTime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 animate-pulse">
      <div className="flex justify-between items-start mb-3">
        <div className="w-10 h-10 bg-slate-100 rounded-xl" />
        <div className="w-10 h-5 bg-slate-100 rounded-full" />
      </div>
      <div className="h-3 bg-slate-100 rounded w-2/3 mb-2" />
      <div className="h-7 bg-slate-100 rounded w-1/2" />
    </div>
  );
}

const METRIC_CONFIG = [
  { key: 'totalViews',             label: 'Total Views',      Icon: Eye,           color: 'text-indigo-600',  bg: 'bg-indigo-50',  ring: 'ring-indigo-100',  changeKey: 'views'             },
  { key: 'totalSearchViews',       label: 'Search Views',     Icon: Search,        color: 'text-sky-600',     bg: 'bg-sky-50',     ring: 'ring-sky-100',     changeKey: 'searchViews'       },
  { key: 'totalMapsViews',         label: 'Maps Views',       Icon: Map,           color: 'text-rose-600',    bg: 'bg-rose-50',    ring: 'ring-rose-100',    changeKey: 'mapsViews'         },
  { key: 'totalCallClicks',        label: 'Call Clicks',      Icon: Phone,         color: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-100', changeKey: 'callClicks'        },
  { key: 'totalWebsiteClicks',     label: 'Website Clicks',   Icon: Globe,         color: 'text-blue-600',    bg: 'bg-blue-50',    ring: 'ring-blue-100',    changeKey: 'websiteClicks'     },
  { key: 'totalDirectionRequests', label: 'Directions',       Icon: MapPin,        color: 'text-amber-600',   bg: 'bg-amber-50',   ring: 'ring-amber-100',   changeKey: 'directionRequests' },
  { key: 'totalConversations',     label: 'Conversations',    Icon: MessageCircle, color: 'text-violet-600',  bg: 'bg-violet-50',  ring: 'ring-violet-100',  changeKey: 'conversations'     },
] as const;

export default function GBPSection() {
  const [data, setData]       = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [range, setRange]     = useState<GBPRange>(28);

  const fetchInsights = useCallback(async (r: GBPRange = range) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/gbp/insights?range=${r}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('GBP fetch failed', e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchInsights(); }, [fetchInsights]);

  const handleRangeChange = (r: GBPRange) => {
    setRange(r);
    fetchInsights(r);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/gbp/sync', { method: 'POST' });
      await fetchInsights(range);
    } finally {
      setSyncing(false);
    }
  };

  const connected   = data?.connected ?? false;
  const summary     = data?.summary;
  const changes     = data?.changes;
  const timeSeries  = data?.timeSeries ?? [];
  const searchData  = data?.searchData;
  const keywords    = searchData?.topKeywords ?? [];

  return (
    <div>
      {/* Stale data warning */}
      {data?.needsSync && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
          <span>⚠️</span>
          <span>Data may be up to 5 days old — GBP metrics have a natural delay from Google.</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-2">
          <GoogleGLogo size={22} />
          <h2 className="text-lg font-bold text-slate-900">GBP Performance</h2>
          {connected && data?.googleEmail && (
            <div className="hidden md:flex items-center gap-1.5 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-xs text-slate-400">{data.googleEmail}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Range pills — same style as insights page */}
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {([7, 14, 28, 90] as GBPRange[]).map((r) => (
              <button
                key={r}
                onClick={() => handleRangeChange(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  range === r
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {r}D
              </button>
            ))}
          </div>

          {/* Sync / Connect button */}
          {connected ? (
            <button
              onClick={handleSync}
              disabled={syncing}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          ) : (
            <a
              href="/api/auth/google"
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-colors"
            >
              Connect Account
            </a>
          )}

          {/* Last sync time */}
          <span className="text-xs text-slate-400">
            Last synced {relTime(data?.lastSyncAt)}
          </span>
        </div>
      </div>

      {/* KPI Cards — every metric we fetch from Google */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
        {loading
          ? Array.from({ length: 7 }).map((_, i) => <CardSkeleton key={i} />)
          : METRIC_CONFIG.map((m) => {
              const value  = summary ? (summary as any)[m.key] : 0;
              const change = changes ? (changes as any)[m.changeKey] : null;
              return (
                <div
                  key={m.key}
                  className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`p-2.5 rounded-xl ${m.bg} ring-4 ${m.ring} transition-all group-hover:ring-8`}>
                      <m.Icon className={`w-4 h-4 ${m.color}`} strokeWidth={2.5} />
                    </div>
                    <ChangeBadge value={change} />
                  </div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{m.label}</p>
                  <p className="text-2xl font-bold text-slate-900">{(value ?? 0).toLocaleString()}</p>
                </div>
              );
            })}
      </div>

      {/* Chart + Search Visibility */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Performance Over Time */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="font-bold text-slate-900 mb-5">Performance Over Time</h3>
          <div className="h-56">
            {loading ? (
              <div className="h-full bg-slate-50 rounded-xl animate-pulse" />
            ) : timeSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeries}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    dy={8}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} dx={-8} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: 'none',
                      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      fontSize: '11px',
                    }}
                  />
                  <Line type="monotone" dataKey="views"             name="Views"          stroke="#4f46e5" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="callClicks"        name="Call Clicks"    stroke="#10b981" strokeWidth={2}   dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="websiteClicks"     name="Website Clicks" stroke="#8b5cf6" strokeWidth={2}   dot={false} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="directionRequests" name="Directions"     stroke="#f59e0b" strokeWidth={2}   dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">
                <p className="text-sm font-medium mb-1">
                  {connected ? 'No data for this range yet' : 'Connect GBP to see your chart'}
                </p>
                {connected && (
                  <button onClick={handleSync} disabled={syncing} className="text-xs font-bold text-indigo-600 hover:text-indigo-700 mt-1">
                    {syncing ? 'Syncing...' : 'Sync Now →'}
                  </button>
                )}
              </div>
            )}
          </div>
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

        {/* Search Visibility */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-5">
            <Search className="w-4 h-4 text-slate-400" />
            <h3 className="font-bold text-slate-900">Search Visibility</h3>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-7 bg-slate-100 rounded w-1/3 mb-1" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="space-y-5 mb-6">
                <div>
                  <p className="text-2xl font-bold text-slate-900">{(searchData?.totalSearchImpressions ?? 0).toLocaleString()}</p>
                  <p className="text-xs font-semibold text-slate-500 mt-0.5">Search Impressions</p>
                  <p className="text-xs text-slate-400">Times you appeared for a search term</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">{(searchData?.uniqueKeywords ?? 0).toLocaleString()}</p>
                  <p className="text-xs font-semibold text-slate-500 mt-0.5">Unique Keywords</p>
                  <p className="text-xs text-slate-400">Distinct terms that surfaced your profile</p>
                </div>
              </div>
            </>
          )}

          <p className="text-[10px] text-slate-300 mt-4">
            {searchData?.keywordMonth ? `Search terms for ${searchData.keywordMonth} · ` : ''}Updated monthly by Google
          </p>
        </div>
      </div>

      {/* Top Keywords Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-slate-900">Top Search Keywords</h3>
          <span className="text-xs text-slate-400">{searchData?.keywordMonth ?? 'This month'}</span>
        </div>
        <p className="text-xs text-slate-400 mb-5">Keywords bringing customers to your business on Google</p>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-8 bg-slate-50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : keywords.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <p className="text-sm font-medium mb-1">
              {connected ? 'Keyword data updates monthly' : 'Connect GBP to see search keywords'}
            </p>
            <p className="text-xs">
              {connected ? 'Check back after your first full month of data.' : 'Your top search terms will appear here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider pb-3 w-8">#</th>
                  <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider pb-3 pr-4">Keyword</th>
                  <th className="text-right text-xs font-semibold text-slate-400 uppercase tracking-wider pb-3 pr-4 w-28">Impressions</th>
                  <th className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider pb-3 w-40">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {keywords.map((kw, i) => {
                  const maxImp = keywords[0]?.impressions ?? 1;
                  const pct = Math.round((kw.impressions / maxImp) * 100);
                  return (
                    <tr key={kw.keyword} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 pr-2 text-slate-400 font-medium text-xs">{i + 1}</td>
                      <td className="py-3 pr-4 font-medium text-slate-800">{kw.keyword}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-slate-900">{kw.impressions.toLocaleString()}</td>
                      <td className="py-3">
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
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
    </div>
  );
}
