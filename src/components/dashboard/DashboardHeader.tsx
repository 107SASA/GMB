'use client';

import React, { useState } from 'react';
import { RefreshCw, Sparkles, ChevronDown, Calendar } from 'lucide-react';

export type RangePreset = 7 | 15 | 30;
export interface CustomRange { start: string; end: string; }
export type RangeValue = RangePreset | CustomRange;

interface DashboardHeaderProps {
  businessName: string;
  onRefresh: () => void;
  lastRefreshed: Date;
  isRefreshing: boolean;
  range: RangeValue;
  onRangeChange: (r: RangeValue) => void;
}

const PRESETS: { label: string; value: RangePreset }[] = [
  { label: '7 Days',  value: 7  },
  { label: '15 Days', value: 15 },
  { label: '30 Days', value: 30 },
];

function rangeLabel(r: RangeValue): string {
  if (typeof r === 'number') return PRESETS.find((p) => p.value === r)?.label ?? `${r} Days`;
  const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(r.start)} – ${fmt(r.end)}`;
}

export default function DashboardHeader({
  businessName,
  onRefresh,
  lastRefreshed,
  isRefreshing,
  range,
  onRangeChange,
}: DashboardHeaderProps) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const timeStr = lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const selectPreset = (v: RangePreset) => {
    onRangeChange(v);
    setShowCustom(false);
    setOpen(false);
  };

  const applyCustom = () => {
    if (!customStart || !customEnd) return;
    if (new Date(customEnd) < new Date(customStart)) return;
    onRangeChange({ start: customStart, end: customEnd });
    setOpen(false);
    setShowCustom(false);
  };

  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
      {/* Title */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">{businessName}</h1>
          <span className="flex items-center gap-1.5 bg-emerald-100 text-emerald-700 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
            <Sparkles className="w-3 h-3" />
            AI Active
          </span>
        </div>
        <p className="text-sm text-slate-400">Command Center · Updated at {timeStr}</p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Range picker */}
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-sm font-semibold rounded-xl px-4 py-2.5 shadow-sm transition-all"
          >
            <Calendar className="w-4 h-4 text-slate-400" />
            {rangeLabel(range)}
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden w-56">
              {/* Presets */}
              <div className="p-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => selectPreset(p.value)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                      typeof range === 'number' && range === p.value
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    Last {p.label}
                  </button>
                ))}
                <button
                  onClick={() => setShowCustom((v) => !v)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    showCustom || typeof range === 'object'
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Custom Range…
                </button>
              </div>

              {/* Custom date inputs */}
              {showCustom && (
                <div className="border-t border-slate-100 p-3 space-y-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">From</label>
                    <input
                      type="date"
                      value={customStart}
                      max={customEnd || undefined}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">To</label>
                    <input
                      type="date"
                      value={customEnd}
                      min={customStart || undefined}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  </div>
                  <button
                    onClick={applyCustom}
                    disabled={!customStart || !customEnd}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold py-1.5 rounded-lg transition-colors"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 text-slate-700 text-sm font-semibold rounded-xl px-4 py-2.5 shadow-sm transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Close dropdown on outside click */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setShowCustom(false); }} />
      )}
    </div>
  );
}
