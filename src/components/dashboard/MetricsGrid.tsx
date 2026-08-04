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
      color: 'text-primary',
      bg: 'bg-primary-fixed',
      ring: 'ring-primary',
      badge: null as React.ReactNode,
    },
    {
      label: 'Conversion Rate',
      value: `${metrics.conversionRate}%`,
      sub: `${metrics.convertedLeads} of ${metrics.totalLeads} converted`,
      Icon: TrendingUp,
      color: 'text-secondary',
      bg: 'bg-secondary-container/40',
      ring: 'ring-secondary-container',
      badge: null as React.ReactNode,
    },
    {
      label: 'Avg Rating',
      value: metrics.avgRating > 0 ? metrics.avgRating.toFixed(1) : '—',
      sub: `${metrics.totalReviews} reviews total`,
      Icon: Star,
      color: 'text-primary',
      bg: 'bg-primary-fixed',
      ring: 'ring-primary-fixed',
      badge: null as React.ReactNode,
    },
    {
      label: 'Unanswered Reviews',
      value: metrics.unansweredReviews.toLocaleString(),
      sub: metrics.unansweredReviews > 0 ? 'Need your reply' : 'All caught up!',
      Icon: MessageSquare,
      color: metrics.unansweredReviews > 0 ? 'text-error' : 'text-primary',
      bg: metrics.unansweredReviews > 0 ? 'bg-error-container' : 'bg-primary-fixed',
      ring: metrics.unansweredReviews > 0 ? 'ring-error-container' : 'ring-primary-fixed',
      badge: metrics.unansweredReviews > 0
        ? <span className="text-[10px] font-bold text-on-error-container bg-error-container border border-error-container px-1.5 py-0.5 rounded-full">Action needed</span>
        : null,
    },
    {
      label: 'Posts Published',
      value: metrics.postsPublished.toLocaleString(),
      sub: 'All time published',
      Icon: Megaphone,
      color: 'text-primary',
      bg: 'bg-primary-fixed',
      ring: 'ring-primary',
      badge: null as React.ReactNode,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
      {cards.map((c, i) => (
        <div
          key={i}
          className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow hover:card-shadow hover:-translate-y-0.5 transition-all group"
        >
          <div className="flex justify-between items-start mb-3">
            <div className={`p-2.5 rounded-xl ${c.bg} ring-4 ${c.ring} transition-all group-hover:ring-8`}>
              <c.Icon className={`w-4 h-4 ${c.color}`} strokeWidth={2.5} />
            </div>
            {c.badge}
          </div>
          <p className="text-label-sm text-on-surface-variant mb-1">{c.label}</p>
          <p className="text-2xl font-bold text-on-surface">{c.value}</p>
          {c.sub && <p className="text-[11px] text-outline mt-1">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}
