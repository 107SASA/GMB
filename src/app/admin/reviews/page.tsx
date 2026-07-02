'use client';

import { useEffect, useState } from 'react';
import { Star, MessageSquare, AlertTriangle, CheckCircle } from 'lucide-react';

interface ReviewsData {
  stats: {
    totalReviews: number;
    averageRating: number;
    unansweredCount: number;
    repliedCount: number;
    criticalCount: number;
  };
  recentReviews: Array<{
    _id: string;
    businessName: string;
    reviewer: string;
    rating: number;
    textSnippet: string;
    replyStatus: string;
    postedAt: string;
  }>;
  ratingBreakdown: Array<{ star: number; count: number }>;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-3.5 h-3.5 ${s <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200'}`}
        />
      ))}
    </span>
  );
}

function replyStatusBadge(status: string) {
  const map: Record<string, string> = {
    PENDING: 'bg-amber-50 text-amber-700',
    APPROVED: 'bg-blue-50 text-blue-700',
    POSTED: 'bg-emerald-50 text-emerald-700',
    REJECTED: 'bg-red-50 text-red-700',
    FAILED: 'bg-red-50 text-red-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-500';
}

export default function ReviewMonitorPage() {
  const [data, setData] = useState<ReviewsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/reviews-monitor')
      .then((r) => r.json())
      .then((json) => { if (json.success) setData(json.data); })
      .finally(() => setLoading(false));
  }, []);

  const totalForPct = data?.stats.totalReviews ?? 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-violet-600 rounded-xl flex items-center justify-center shadow-sm">
          <Star className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Review Monitor</h1>
          <p className="text-sm text-slate-500">All Google reviews across every business — live.</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Reviews', value: loading ? '—' : data?.stats.totalReviews.toLocaleString(), icon: Star, color: 'text-violet-600 bg-violet-50' },
          { label: 'Avg Rating', value: loading ? '—' : `${data?.stats.averageRating ?? 0} ★`, icon: Star, color: 'text-amber-600 bg-amber-50' },
          { label: 'Unanswered', value: loading ? '—' : data?.stats.unansweredCount.toLocaleString(), icon: MessageSquare, color: 'text-blue-600 bg-blue-50' },
          { label: 'Critical (≤2★)', value: loading ? '—' : data?.stats.criticalCount.toLocaleString(), icon: AlertTriangle, color: 'text-red-600 bg-red-50' },
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rating Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Rating Breakdown</h2>
          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-3 w-8 bg-slate-200 rounded" />
                  <div className="flex-1 h-3 bg-slate-200 rounded-full" />
                  <div className="h-3 w-6 bg-slate-200 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {[5, 4, 3, 2, 1].map((star) => {
                const row = data?.ratingBreakdown.find((r) => r.star === star);
                const count = row?.count ?? 0;
                const pct = totalForPct > 0 ? Math.round((count / totalForPct) * 100) : 0;
                return (
                  <div key={star} className="flex items-center gap-3 text-sm">
                    <span className="w-6 text-slate-500 text-right">{star}★</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${star >= 4 ? 'bg-emerald-400' : star === 3 ? 'bg-amber-400' : 'bg-red-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-slate-500">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Replied vs Unanswered donut summary */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
          <h2 className="font-semibold text-slate-900 mb-4">Reply Status</h2>
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 w-full bg-slate-200 rounded" />
              <div className="h-4 w-3/4 bg-slate-200 rounded" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  <CheckCircle className="w-4 h-4 text-emerald-500" /> Replied
                </span>
                <span className="font-bold text-slate-900">{data?.stats.repliedCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  <MessageSquare className="w-4 h-4 text-amber-500" /> Unanswered
                </span>
                <span className="font-bold text-slate-900">{data?.stats.unansweredCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-slate-600">
                  <AlertTriangle className="w-4 h-4 text-red-500" /> Critical
                </span>
                <span className="font-bold text-slate-900">{data?.stats.criticalCount.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Reviews Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Recent Reviews</h2>
          <p className="text-xs text-slate-400 mt-0.5">Latest 20 reviews across all businesses</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-50">
                <th className="text-left px-4 py-3">Business</th>
                <th className="text-left px-4 py-3">Reviewer</th>
                <th className="text-left px-4 py-3">Rating</th>
                <th className="text-left px-4 py-3">Review</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-slate-200 rounded w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : (data?.recentReviews ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400">No reviews yet</td>
                </tr>
              ) : (
                data?.recentReviews.map((review) => (
                  <tr key={review._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{review.businessName}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{review.reviewer}</td>
                    <td className="px-4 py-3"><Stars rating={review.rating} /></td>
                    <td className="px-4 py-3 text-slate-500 max-w-xs truncate">{review.textSnippet || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${replyStatusBadge(review.replyStatus)}`}>
                        {review.replyStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap">
                      {new Date(review.postedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
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
