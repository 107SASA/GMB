import React from 'react';
import { Users, TrendingUp, Star, MessageSquare, Megaphone } from 'lucide-react';

interface MetricsGridProps {
  metrics: {
    totalLeads: number;
    convertedLeads: number;
    conversionRate: number;
    totalReviews: number;
    avgRating: number;
    unansweredReviews: number;
    postsPublished: number;
  };
}

export default function MetricsGrid({ metrics }: MetricsGridProps) {
  const cards = [
    {
      label: 'Total Leads',
      value: metrics.totalLeads.toLocaleString(),
      sub: null,
      Icon: Users,
      color: 'text-indigo-600',
      bg: 'bg-indigo-50',
      ring: 'ring-indigo-100',
      badge: null as React.ReactNode,
    },
    {
      label: 'Conversion Rate',
      value: `${metrics.conversionRate}%`,
      sub: `${metrics.convertedLeads} of ${metrics.totalLeads} converted`,
      Icon: TrendingUp,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      ring: 'ring-emerald-100',
      badge: null as React.ReactNode,
    },
    {
      label: 'Avg Rating',
      value: metrics.avgRating > 0 ? metrics.avgRating.toFixed(1) : '—',
      sub: `${metrics.totalReviews} reviews total`,
      Icon: Star,
      color: 'text-amber-500',
      bg: 'bg-amber-50',
      ring: 'ring-amber-100',
      badge: null as React.ReactNode,
    },
    {
      label: 'Unanswered Reviews',
      value: metrics.unansweredReviews.toLocaleString(),
      sub: metrics.unansweredReviews > 0 ? 'Need your reply' : 'All caught up!',
      Icon: MessageSquare,
      color: metrics.unansweredReviews > 0 ? 'text-rose-500' : 'text-blue-500',
      bg: metrics.unansweredReviews > 0 ? 'bg-rose-50' : 'bg-blue-50',
      ring: metrics.unansweredReviews > 0 ? 'ring-rose-100' : 'ring-blue-100',
      badge: metrics.unansweredReviews > 0
        ? <span className="text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">Action needed</span>
        : null,
    },
    {
      label: 'Posts Published',
      value: metrics.postsPublished.toLocaleString(),
      sub: 'All time published',
      Icon: Megaphone,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
      ring: 'ring-violet-100',
      badge: null as React.ReactNode,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      {cards.map((c, i) => (
        <div
          key={i}
          className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all group"
        >
          <div className="flex justify-between items-start mb-3">
            <div className={`p-2.5 rounded-xl ${c.bg} ring-4 ${c.ring} transition-all group-hover:ring-8`}>
              <c.Icon className={`w-4 h-4 ${c.color}`} strokeWidth={2.5} />
            </div>
            {c.badge}
          </div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{c.label}</p>
          <p className="text-2xl font-bold text-slate-900">{c.value}</p>
          {c.sub && <p className="text-[11px] text-slate-400 mt-1">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}
