import React from 'react';

interface CRMStatsRowProps {
  stats: {
    total: number;
    /** Pending follow-up tasks due today or overdue. */
    followUpsDue: number;
    /** Leads in the Won (converted) stage. */
    won: number;
    /** Sum of recorded Won deal values. */
    revenue: number;
    currency: string;
  };
}

export default function CRMStatsRow({ stats }: CRMStatsRowProps) {
  const revenue = new Intl.NumberFormat('en-IN', { style: 'currency', currency: stats.currency || 'INR', maximumFractionDigits: 0 }).format(stats.revenue);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow">
        <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Total Leads</div>
        <div className="text-3xl font-black text-on-surface">{stats.total}</div>
      </div>
      <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow">
        <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Follow-ups Due</div>
        <div className={`text-3xl font-black ${stats.followUpsDue > 0 ? 'text-error' : 'text-on-surface'}`}>{stats.followUpsDue}</div>
      </div>
      <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow">
        <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Won</div>
        <div className="text-3xl font-black text-secondary">{stats.won}</div>
      </div>
      <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow">
        <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Revenue</div>
        <div className="text-3xl font-black text-primary truncate">{revenue}</div>
      </div>
    </div>
  );
}
