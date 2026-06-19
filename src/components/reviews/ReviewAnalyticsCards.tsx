import React from 'react';

interface ReviewAnalyticsCardsProps {
  analytics: {
    avgRating: number;
    responseRate: number;
    sentimentScore: number;
    unansweredCount: number;
    totalReviews: number;
    criticalReviews: number;
  };
}

export default function ReviewAnalyticsCards({ analytics }: ReviewAnalyticsCardsProps) {
  const cards = [
    { label: 'Avg Rating', value: analytics.avgRating, suffix: ' / 5.0', color: 'text-amber-500' },
    { label: 'Response Rate', value: analytics.responseRate, suffix: '%', color: 'text-blue-500' },
    { label: 'Sentiment Score', value: analytics.sentimentScore, suffix: '/100', color: analytics.sentimentScore > 70 ? 'text-emerald-500' : 'text-amber-500' },
    { label: 'Total Reviews', value: analytics.totalReviews, suffix: '', color: 'text-slate-900' },
    { label: 'Unanswered', value: analytics.unansweredCount, suffix: '', color: 'text-rose-500' },
    { label: 'Critical / 1-Star', value: analytics.criticalReviews, suffix: '', color: 'text-rose-600' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {cards.map((c, i) => (
        <div key={i} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">{c.label}</span>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-black ${c.color}`}>{c.value}</span>
            <span className="text-sm font-semibold text-slate-400">{c.suffix}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
