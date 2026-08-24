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
  // null = not known yet (GBPSection is still loading its own data) — only
  // render the CTA once we actually know the business isn't connected, never
  // as a guess.
  const [gbpConnected, setGbpConnected] = useState<boolean | null>(null);

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

  // Clear the connect-CTA's known state on workspace switch — otherwise the
  // PREVIOUS business's connection status would briefly show for the newly
  // active one until GBPSection's own re-fetch reports back.
  useEffect(() => {
    setGbpConnected(null);
  }, [activeBusiness?._id]);

  const handleRangeChange = (newRange: RangeValue) => {
    setRange(newRange);
    setLoading(true);
    fetchStats(false, newRange);
  };

  if (loading || contextLoading) {
    return (
      <div className="min-h-screen bg-surface/50 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin" />
        <p className="text-sm font-medium text-on-surface-variant">Loading Command Center...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-surface/50 p-8 text-center text-on-surface-variant">
        Failed to load dashboard data.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface/50 p-4 sm:p-8 pt-10">
      <div className="max-w-[1600px] mx-auto">

        {/* GBP connected success banner */}
        {connectedBanner && (
          <div className="mb-6 bg-secondary-container/40 border border-secondary-fixed rounded-xl px-5 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-on-secondary-container">
              <span className="text-base">✅</span>
              <span><strong>Google Business Profile connected!</strong> Your data is syncing in the background — it'll appear below shortly.</span>
            </div>
            <button onClick={() => setConnectedBanner(false)} className="text-secondary hover:text-on-secondary-container text-lg leading-none shrink-0">×</button>
          </div>
        )}

        {/* Primary "Connect Profile" CTA — a fresh signup's dashboard is
            mostly/all zeros until Google is connected, which otherwise looks
            broken rather than "not set up yet." This is the unmissable,
            page-level version; GBPSection's own header button below still
            exists too for someone already scrolled past this. */}
        {gbpConnected === false && !connectedBanner && (
          <div className="mb-6 bg-primary-fixed border border-primary-fixed-dim rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none">👋</span>
              <div>
                <p className="font-bold text-on-surface">Connect your Google Business Profile to get started</p>
                <p className="text-sm text-on-surface-variant mt-0.5">
                  The metrics below are showing zero because there's no live data source connected yet — not because
                  nothing's happening. Connecting takes under a minute.
                </p>
              </div>
            </div>
            <a
              href="/api/auth/google"
              className="shrink-0 flex items-center justify-center gap-2 bg-primary hover:bg-primary-container text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
            >
              Connect Profile
            </a>
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

        {/* GBP Section — self-contained, manages its own data fetch.
            Shown first: this is the headline metric set for the product. */}
        <GBPSection onConnectionChange={setGbpConnected} />

        <div className="border-t border-outline-variant pt-8 mt-2 mb-2">
          <SectionLabel>CRM & AI Activity</SectionLabel>
          <QuickPanels panels={data.panels} />
        </div>

        <div className="pt-6">
          <SectionLabel>Performance Overview</SectionLabel>
          <MetricsGrid metrics={data.metrics} />
        </div>

        <ChartsSection charts={data.charts} rangeDays={data.range?.days ?? 30} />

      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="text-xs font-bold text-outline uppercase tracking-widest whitespace-nowrap">{children}</span>
      <div className="flex-1 h-px bg-surface-container" />
    </div>
  );
}
