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
          <h1 className="font-heading text-headline-md sm:text-headline-lg text-on-surface tracking-tight">{businessName}</h1>
          <span className="flex items-center gap-1.5 bg-secondary-container text-on-secondary-container text-label-sm px-2.5 py-1 rounded-lg">
            <Sparkles className="w-3 h-3" />
            AI Active
          </span>
        </div>
        <p className="text-label-sm text-on-surface-variant normal-case tracking-normal">Command Center · Updated at {timeStr}</p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 shrink-0">

        {/* Range picker */}
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 bg-surface-container-lowest border border-outline-variant hover:border-outline text-on-surface text-sm font-semibold rounded-lg px-4 py-2.5 card-shadow transition-all"
          >
            <Calendar className="w-4 h-4 text-outline" />
            {rangeLabel(range)}
            <ChevronDown className={`w-3.5 h-3.5 text-outline transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-surface-container-lowest border border-outline-variant rounded-2xl card-shadow overflow-hidden w-56">
              {/* Presets */}
              <div className="p-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.value}
                    onClick={() => selectPreset(p.value)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                      typeof range === 'number' && range === p.value
                        ? 'bg-primary-fixed text-primary'
                        : 'text-on-surface hover:bg-surface'
                    }`}
                  >
                    Last {p.label}
                  </button>
                ))}
                <button
                  onClick={() => setShowCustom((v) => !v)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                    showCustom || typeof range === 'object'
                      ? 'bg-primary-fixed text-primary'
                      : 'text-on-surface hover:bg-surface'
                  }`}
                >
                  Custom Range…
                </button>
              </div>

              {/* Custom date inputs */}
              {showCustom && (
                <div className="border-t border-outline-variant p-3 space-y-2">
                  <div>
                    <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1">From</label>
                    <input
                      type="date"
                      value={customStart}
                      max={customEnd || undefined}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="w-full text-sm border border-outline-variant rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-outline uppercase tracking-wider block mb-1">To</label>
                    <input
                      type="date"
                      value={customEnd}
                      min={customStart || undefined}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="w-full text-sm border border-outline-variant rounded-lg px-3 py-1.5 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <button
                    onClick={applyCustom}
                    disabled={!customStart || !customEnd}
                    className="w-full bg-primary hover:bg-primary-container disabled:opacity-40 text-white text-sm font-semibold py-1.5 rounded-lg transition-colors"
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
          className="flex items-center gap-2 bg-surface-container-lowest border border-outline-variant hover:bg-surface-container-low hover:border-outline text-on-surface text-sm font-semibold rounded-lg px-4 py-2.5 card-shadow transition-all disabled:opacity-50"
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
