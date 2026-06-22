'use client';

import { useEffect, useState } from 'react';
import { Megaphone, FileText, Calendar, CheckCircle, XCircle } from 'lucide-react';

interface ContentData {
  stats: {
    totalPosts: number;
    scheduledCount: number;
    publishedCount: number;
    draftCount: number;
    failedCount: number;
  };
  recentPosts: Array<{
    _id: string;
    businessName: string;
    title: string;
    status: string;
    scheduledDate: string | null;
    createdAt: string;
  }>;
  bufferHealth: Array<{
    businessId: string;
    businessName: string;
    scheduledAhead: number;
  }>;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    published: 'bg-emerald-50 text-emerald-700',
    scheduled: 'bg-blue-50 text-blue-700',
    draft: 'bg-slate-100 text-slate-500',
    failed: 'bg-red-50 text-red-700',
    pending_approval: 'bg-amber-50 text-amber-700',
    approved: 'bg-teal-50 text-teal-700',
    rejected: 'bg-red-50 text-red-700',
    archived: 'bg-slate-100 text-slate-400',
  };
  return map[status] ?? 'bg-slate-100 text-slate-500';
}

function bufferColor(days: number) {
  if (days < 3) return { bar: 'bg-red-400', badge: 'bg-red-50 text-red-700' };
  if (days < 7) return { bar: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700' };
  return { bar: 'bg-emerald-400', badge: 'bg-emerald-50 text-emerald-700' };
}

export default function ContentMonitorPage() {
  const [data, setData] = useState<ContentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/content-monitor')
      .then((r) => r.json())
      .then((json) => { if (json.success) setData(json.data); })
      .finally(() => setLoading(false));
  }, []);

  const maxBuffer = Math.max(...(data?.bufferHealth.map((b) => b.scheduledAhead) ?? [1]), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center shadow-sm">
          <Megaphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Content Monitor</h1>
          <p className="text-sm text-slate-500">AI-generated posts and scheduled content across all businesses.</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Generated', value: loading ? '—' : data?.stats.totalPosts.toLocaleString(), icon: FileText, color: 'text-violet-600 bg-violet-50' },
          { label: 'Scheduled', value: loading ? '—' : data?.stats.scheduledCount.toLocaleString(), icon: Calendar, color: 'text-blue-600 bg-blue-50' },
          { label: 'Published', value: loading ? '—' : data?.stats.publishedCount.toLocaleString(), icon: CheckCircle, color: 'text-emerald-600 bg-emerald-50' },
          { label: 'Drafts', value: loading ? '—' : data?.stats.draftCount.toLocaleString(), icon: FileText, color: 'text-slate-600 bg-slate-100' },
        ].map((card) => (
          <div key={card.label} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-slate-500">{card.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${card.color}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Buffer Health */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Content Buffer Health</h2>
          <p className="text-xs text-slate-400 mt-0.5">Businesses sorted by days of scheduled content ahead — most at-risk first</p>
        </div>
        <div className="divide-y divide-slate-100">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-3 w-36 bg-slate-200 rounded" />
                <div className="flex-1 h-2.5 bg-slate-200 rounded-full" />
                <div className="h-5 w-20 bg-slate-200 rounded-full" />
              </div>
            ))
          ) : (data?.bufferHealth ?? []).length === 0 ? (
            <div className="px-6 py-10 text-center text-slate-400 text-sm">No businesses found</div>
          ) : (
            data?.bufferHealth.map((biz) => {
              const colors = bufferColor(biz.scheduledAhead);
              const pct = Math.min(100, Math.round((biz.scheduledAhead / maxBuffer) * 100));
              return (
                <div key={biz.businessId} className="px-6 py-4 flex items-center gap-4">
                  <span className="text-sm font-medium text-slate-900 w-48 truncate">{biz.businessName}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${colors.badge}`}>
                    {biz.scheduledAhead} {biz.scheduledAhead === 1 ? 'post' : 'posts'} ahead
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Recent Posts Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Recent Posts</h2>
          <p className="text-xs text-slate-400 mt-0.5">Latest 20 posts across all businesses</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                <th className="text-left px-4 py-3">Business</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Scheduled</th>
                <th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-slate-200 rounded w-24" /></td>
                    ))}
                  </tr>
                ))
              ) : (data?.recentPosts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">No posts yet</td>
                </tr>
              ) : (
                data?.recentPosts.map((post) => (
                  <tr key={post._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{post.businessName}</td>
                    <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{post.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusBadge(post.status)}`}>
                        {post.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {post.scheduledDate
                        ? new Date(post.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {new Date(post.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
