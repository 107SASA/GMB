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
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Leads</div>
        <div className="text-3xl font-black text-slate-900">{stats.total}</div>
      </div>
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Converted</div>
        <div className="text-3xl font-black text-emerald-600">{stats.converted}</div>
      </div>
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Conversion %</div>
        <div className="text-3xl font-black text-blue-600">{stats.conversionRate}%</div>
      </div>
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
        <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Avg AI Score</div>
        <div className="text-3xl font-black text-indigo-600">{stats.avgScore}</div>
      </div>
    </div>
  );
}
