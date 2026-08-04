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
          className={`w-3.5 h-3.5 ${s <= rating ? 'text-primary-fixed-dim fill-primary-fixed-dim' : 'text-outline-variant fill-outline-variant'}`}
        />
      ))}
    </span>
  );
}

function replyStatusBadge(status: string) {
  const map: Record<string, string> = {
    PENDING: 'bg-primary-fixed text-primary',
    APPROVED: 'bg-primary-fixed text-primary',
    POSTED: 'bg-secondary-container/40 text-on-secondary-container',
    REJECTED: 'bg-error-container text-on-error-container',
    FAILED: 'bg-error-container text-on-error-container',
  };
  return map[status] ?? 'bg-surface-container text-on-surface-variant';
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
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <Star className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Review Monitor</h1>
          <p className="text-sm text-on-surface-variant">All Google reviews across every business — live.</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Reviews', value: loading ? '—' : data?.stats.totalReviews.toLocaleString(), icon: Star, color: 'text-primary bg-primary-fixed' },
          { label: 'Avg Rating', value: loading ? '—' : `${data?.stats.averageRating ?? 0} ★`, icon: Star, color: 'text-primary bg-primary-fixed' },
          { label: 'Unanswered', value: loading ? '—' : data?.stats.unansweredCount.toLocaleString(), icon: MessageSquare, color: 'text-primary bg-primary-fixed' },
          { label: 'Critical (≤2★)', value: loading ? '—' : data?.stats.criticalCount.toLocaleString(), icon: AlertTriangle, color: 'text-error bg-error-container' },
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Rating Breakdown */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
          <h2 className="font-semibold text-on-surface mb-4">Rating Breakdown</h2>
          {loading ? (
            <div className="space-y-3 animate-pulse">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-3 w-8 bg-surface-container-high rounded" />
                  <div className="flex-1 h-3 bg-surface-container-high rounded-full" />
                  <div className="h-3 w-6 bg-surface-container-high rounded" />
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
                    <span className="w-6 text-on-surface-variant text-right">{star}★</span>
                    <div className="flex-1 bg-surface-container rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${star >= 4 ? 'bg-secondary' : star === 3 ? 'bg-primary-fixed-dim' : 'bg-error'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-on-surface-variant">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Replied vs Unanswered donut summary */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6 flex flex-col justify-between">
          <h2 className="font-semibold text-on-surface mb-4">Reply Status</h2>
          {loading ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-4 w-full bg-surface-container-high rounded" />
              <div className="h-4 w-3/4 bg-surface-container-high rounded" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-on-surface-variant">
                  <CheckCircle className="w-4 h-4 text-secondary" /> Replied
                </span>
                <span className="font-bold text-on-surface">{data?.stats.repliedCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-on-surface-variant">
                  <MessageSquare className="w-4 h-4 text-primary-fixed-dim" /> Unanswered
                </span>
                <span className="font-bold text-on-surface">{data?.stats.unansweredCount.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm text-on-surface-variant">
                  <AlertTriangle className="w-4 h-4 text-error" /> Critical
                </span>
                <span className="font-bold text-on-surface">{data?.stats.criticalCount.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Reviews Table */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant">
          <h2 className="font-semibold text-on-surface">Recent Reviews</h2>
          <p className="text-xs text-outline mt-0.5">Latest 20 reviews across all businesses</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-label-sm text-on-surface-variant bg-surface-container-low">
                <th className="text-left px-4 py-3">Business</th>
                <th className="text-left px-4 py-3">Reviewer</th>
                <th className="text-left px-4 py-3">Rating</th>
                <th className="text-left px-4 py-3">Review</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-surface-container-high rounded w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : (data?.recentReviews ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-outline">No reviews yet</td>
                </tr>
              ) : (
                data?.recentReviews.map((review) => (
                  <tr key={review._id} className="hover:bg-surface transition-colors">
                    <td className="px-4 py-3 font-medium text-on-surface whitespace-nowrap">{review.businessName}</td>
                    <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{review.reviewer}</td>
                    <td className="px-4 py-3"><Stars rating={review.rating} /></td>
                    <td className="px-4 py-3 text-on-surface-variant max-w-xs truncate">{review.textSnippet || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${replyStatusBadge(review.replyStatus)}`}>
                        {review.replyStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-outline whitespace-nowrap">
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
