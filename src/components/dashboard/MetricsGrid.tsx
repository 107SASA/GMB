import React from 'react';

interface MetricsGridProps {
  metrics: {
    totalLeads: number;
    convertedLeads: number;
    totalReviews: number;
    avgRating: number;
    unansweredReviews: number;
    postsPublished: number;
    bufferDays: number;
  };
}

export default function MetricsGrid({ metrics }: MetricsGridProps) {
  const isBufferLow = metrics.bufferDays < 7;
  const leadConversionRate = metrics.totalLeads > 0 ? Math.round((metrics.convertedLeads / metrics.totalLeads) * 100) : 0;

  const cards = [
    { label: 'Total Leads', value: metrics.totalLeads, icon: 'Users', trend: '+12%', color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Conversion Rate', value: `${leadConversionRate}%`, icon: 'TrendingUp', trend: '+2.4%', color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Avg Rating', value: metrics.avgRating.toFixed(1), icon: 'Star', trend: 'Stable', color: 'text-amber-500', bg: 'bg-amber-50' },
    { label: 'Reviews', value: metrics.totalReviews, icon: 'MessageSquare', alert: metrics.unansweredReviews > 0 ? `${metrics.unansweredReviews} unread` : null, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'Content Buffer', value: `${metrics.bufferDays} Days`, icon: 'Calendar', isDanger: isBufferLow, color: isBufferLow ? 'text-rose-600' : 'text-slate-600', bg: isBufferLow ? 'bg-rose-50' : 'bg-slate-50' },
    { label: 'Posts Published', value: metrics.postsPublished, icon: 'Megaphone', trend: '+5', color: 'text-violet-600', bg: 'bg-violet-50' }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
      {cards.map((c, i) => (
        <div key={i} className={`bg-white rounded-2xl p-4 border shadow-sm transition-all hover:shadow-md ${c.isDanger ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'}`}>
          <div className="flex justify-between items-start mb-2">
            <div className={`p-2 rounded-xl ${c.bg}`}>
              {/* Simple generic icon fallback based on label to avoid massive SVG block */}
              <div className={`w-5 h-5 ${c.color} font-bold text-center leading-5`}>{c.icon.charAt(0)}</div>
            </div>
            {c.trend && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">{c.trend}</span>}
            {c.alert && <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded">{c.alert}</span>}
          </div>
          <h3 className="text-sm font-medium text-slate-500 mb-1">{c.label}</h3>
          <p className={`text-2xl font-bold ${c.isDanger ? 'text-rose-600' : 'text-slate-900'}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}
