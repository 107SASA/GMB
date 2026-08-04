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
    { label: 'Avg Rating', value: analytics.avgRating, suffix: ' / 5.0', color: 'text-error' },
    { label: 'Response Rate', value: analytics.responseRate, suffix: '%', color: 'text-primary' },
    { label: 'Sentiment Score', value: analytics.sentimentScore, suffix: '/100', color: analytics.sentimentScore > 70 ? 'text-secondary' : 'text-error' },
    { label: 'Total Reviews', value: analytics.totalReviews, suffix: '', color: 'text-on-surface' },
    { label: 'Unanswered', value: analytics.unansweredCount, suffix: '', color: 'text-error' },
    { label: 'Critical / 1-Star', value: analytics.criticalReviews, suffix: '', color: 'text-on-error-container' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {cards.map((c, i) => (
        <div key={i} className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow flex flex-col justify-between hover:card-shadow transition-shadow">
          <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">{c.label}</span>
          <div className="flex items-baseline gap-1">
            <span className={`text-2xl font-black ${c.color}`}>{c.value}</span>
            <span className="text-sm font-semibold text-outline">{c.suffix}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
