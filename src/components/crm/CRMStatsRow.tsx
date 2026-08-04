import React from 'react';

interface CRMStatsRowProps {
  stats: {
    total: number;
    converted: number;
    conversionRate: number;
    avgScore: number;
  };
}

export default function CRMStatsRow({ stats }: CRMStatsRowProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow">
        <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Total Leads</div>
        <div className="text-3xl font-black text-on-surface">{stats.total}</div>
      </div>
      <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow">
        <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Converted</div>
        <div className="text-3xl font-black text-secondary">{stats.converted}</div>
      </div>
      <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow">
        <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Conversion %</div>
        <div className="text-3xl font-black text-primary">{stats.conversionRate}%</div>
      </div>
      <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow">
        <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Avg AI Score</div>
        <div className="text-3xl font-black text-primary">{stats.avgScore}</div>
      </div>
    </div>
  );
}
