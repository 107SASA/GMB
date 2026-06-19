import React from 'react';

interface DashboardHeaderProps {
  businessName: string;
  onRefresh: () => void;
  lastRefreshed: Date;
  isRefreshing: boolean;
}

export default function DashboardHeader({ businessName, onRefresh, lastRefreshed, isRefreshing }: DashboardHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{businessName}</h1>
          <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">AI Active</span>
        </div>
        <p className="text-sm text-slate-500">Welcome back. Here is your AI Command Center & Unified Analytics.</p>
      </div>

      <div className="flex items-center gap-3">
        {/* Date Range Picker (Placeholder UI for now) */}
        <select className="bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-sm">
          <option>Last 30 Days</option>
          <option>Last 7 Days</option>
          <option>Last 90 Days</option>
          <option>Custom Range</option>
        </select>

        <button 
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold rounded-xl px-4 py-2.5 shadow-sm transition-all disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          {isRefreshing ? 'Syncing...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
