'use client';

import React, { useState, useEffect, useCallback } from 'react';
import DashboardHeader, { RangeValue } from '@/components/dashboard/DashboardHeader';
import MetricsGrid from '@/components/dashboard/MetricsGrid';
import ChartsSection from '@/components/dashboard/ChartsSection';
import QuickPanels from '@/components/dashboard/QuickPanels';
import GBPSection from '@/components/dashboard/GBPSection';
import { useBusiness } from '@/context/BusinessContext';

function buildUrl(range: RangeValue): string {
  if (typeof range === 'number') return `/api/dashboard/stats?range=${range}`;
  return `/api/dashboard/stats?start=${range.start}&end=${range.end}`;
}

export default function CommandCenter() {
  const { activeBusiness, loading: contextLoading } = useBusiness();
  const [data, setData]             = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [range, setRange]           = useState<RangeValue>(30);
  const [connectedBanner, setConnectedBanner] = useState(false);

  // Show success banner when redirected back from GBP OAuth
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      setConnectedBanner(true);
      // Clean the URL without a hard reload
      window.history.replaceState({}, '', '/dashboard');
      setTimeout(() => setConnectedBanner(false), 6000);
    }
  }, []);

  const fetchStats = useCallback(async (isManualRefresh = false, currentRange?: RangeValue) => {
    if (isManualRefresh) setRefreshing(true);
    try {
      const url  = buildUrl(currentRange ?? range);
      const res  = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setLastRefreshed(new Date());
      }
    } catch (e) {
      console.error('Failed to fetch dashboard stats', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => {
    if (!activeBusiness) return;
    fetchStats();
    const interval = setInterval(() => fetchStats(), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchStats, activeBusiness]);

  const handleRangeChange = (newRange: RangeValue) => {
    setRange(newRange);
    setLoading(true);
    fetchStats(false, newRange);
  };

  if (loading || contextLoading) {
    return (
      <div className="min-h-screen bg-slate-50/50 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-500">Loading Command Center...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50/50 p-8 text-center text-slate-500">
        Failed to load dashboard data.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 p-4 sm:p-8 pt-10">
      <div className="max-w-[1600px] mx-auto">

        {/* GBP connected success banner */}
        {connectedBanner && (
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-emerald-700">
              <span className="text-base">✅</span>
              <span><strong>Google Business Profile connected!</strong> Your data is syncing in the background — it'll appear below shortly.</span>
            </div>
            <button onClick={() => setConnectedBanner(false)} className="text-emerald-500 hover:text-emerald-700 text-lg leading-none shrink-0">×</button>
          </div>
        )}

        <DashboardHeader
          businessName={activeBusiness?.name || 'Your Business'}
          onRefresh={() => fetchStats(true)}
          lastRefreshed={lastRefreshed}
          isRefreshing={refreshing}
          range={range}
          onRangeChange={handleRangeChange}
        />

        <SectionLabel>Performance Overview</SectionLabel>
        <MetricsGrid metrics={data.metrics} />

        <ChartsSection charts={data.charts} rangeDays={data.range?.days ?? 30} />

        {/* GBP Section — self-contained, manages its own data fetch */}
        <div className="border-t border-slate-100 pt-8 mt-2 mb-2">
          <SectionLabel>Google Business Profile</SectionLabel>
          <GBPSection />
        </div>

        <div className="pt-6">
          <SectionLabel>CRM & AI Activity</SectionLabel>
          <QuickPanels panels={data.panels} />
        </div>

      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">{children}</span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}
