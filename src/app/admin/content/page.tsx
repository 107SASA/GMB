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
    published: 'bg-secondary-container/40 text-on-secondary-container',
    scheduled: 'bg-primary-fixed text-primary',
    draft: 'bg-surface-container text-on-surface-variant',
    failed: 'bg-error-container text-on-error-container',
    pending_approval: 'bg-primary-fixed text-primary',
    approved: 'bg-secondary-container/40 text-on-secondary-container',
    rejected: 'bg-error-container text-on-error-container',
    archived: 'bg-surface-container text-outline',
  };
  return map[status] ?? 'bg-surface-container text-on-surface-variant';
}

function bufferColor(days: number) {
  if (days < 3) return { bar: 'bg-error', badge: 'bg-error-container text-on-error-container' };
  if (days < 7) return { bar: 'bg-primary-fixed-dim', badge: 'bg-primary-fixed text-primary' };
  return { bar: 'bg-secondary', badge: 'bg-secondary-container/40 text-on-secondary-container' };
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
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <Megaphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Content Monitor</h1>
          <p className="text-sm text-on-surface-variant">AI-generated posts and scheduled content across all businesses.</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Generated', value: loading ? '—' : data?.stats.totalPosts.toLocaleString(), icon: FileText, color: 'text-primary bg-primary-fixed' },
          { label: 'Scheduled', value: loading ? '—' : data?.stats.scheduledCount.toLocaleString(), icon: Calendar, color: 'text-primary bg-primary-fixed' },
          { label: 'Published', value: loading ? '—' : data?.stats.publishedCount.toLocaleString(), icon: CheckCircle, color: 'text-secondary bg-secondary-container/40' },
          { label: 'Drafts', value: loading ? '—' : data?.stats.draftCount.toLocaleString(), icon: FileText, color: 'text-on-surface-variant bg-surface-container' },
        ].map((card) => (
          <div key={card.label} className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-on-surface-variant">{card.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${card.color}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-on-surface">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Buffer Health */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant">
          <h2 className="font-semibold text-on-surface">Content Buffer Health</h2>
          <p className="text-xs text-outline mt-0.5">Businesses sorted by days of scheduled content ahead — most at-risk first</p>
        </div>
        <div className="divide-y divide-outline-variant">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-3 w-36 bg-surface-container-high rounded" />
                <div className="flex-1 h-2.5 bg-surface-container-high rounded-full" />
                <div className="h-5 w-20 bg-surface-container-high rounded-full" />
              </div>
            ))
          ) : (data?.bufferHealth ?? []).length === 0 ? (
            <div className="px-6 py-10 text-center text-outline text-sm">No businesses found</div>
          ) : (
            data?.bufferHealth.map((biz) => {
              const colors = bufferColor(biz.scheduledAhead);
              const pct = Math.min(100, Math.round((biz.scheduledAhead / maxBuffer) * 100));
              return (
                <div key={biz.businessId} className="px-6 py-4 flex items-center gap-4">
                  <span className="text-sm font-medium text-on-surface w-48 truncate">{biz.businessName}</span>
                  <div className="flex-1 bg-surface-container rounded-full h-2.5 overflow-hidden">
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
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant">
          <h2 className="font-semibold text-on-surface">Recent Posts</h2>
          <p className="text-xs text-outline mt-0.5">Latest 20 posts across all businesses</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-label-sm text-on-surface-variant bg-surface-container-low">
                <th className="text-left px-4 py-3">Business</th>
                <th className="text-left px-4 py-3">Title</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Scheduled</th>
                <th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-surface-container-high rounded w-24" /></td>
                    ))}
                  </tr>
                ))
              ) : (data?.recentPosts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-outline">No posts yet</td>
                </tr>
              ) : (
                data?.recentPosts.map((post) => (
                  <tr key={post._id} className="hover:bg-surface transition-colors">
                    <td className="px-4 py-3 font-medium text-on-surface whitespace-nowrap">{post.businessName}</td>
                    <td className="px-4 py-3 text-on-surface-variant max-w-xs truncate">{post.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusBadge(post.status)}`}>
                        {post.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-outline whitespace-nowrap">
                      {post.scheduledDate
                        ? new Date(post.scheduledDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-outline whitespace-nowrap">
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
