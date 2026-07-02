'use client';

import { useEffect, useState } from 'react';
import { IAudit } from '@/models/Audit';
import { Download, Sparkles, Building2, Globe, MapPin, Zap, TrendingUp, Search, MessageSquare, AlertCircle, Calendar, Target, ShieldAlert, Award, Loader2, CheckCircle2, Share2, Copy, Check } from 'lucide-react';
import AuditDebugPanel from './AuditDebugPanel';
import AuditReportV6 from './AuditReportV6';
import AuditReportGrexa from './AuditReportGrexa';

/* ─── Main dashboard ──────────────────────────────────────── */

export default function AuditResultsDashboard({ auditId }: { auditId: string }) {
  const [audit, setAudit] = useState<IAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [shareUrl, setShareUrl]   = useState<string | null>(null);
  const [sharing, setSharing]     = useState(false);
  const [copied, setCopied]       = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    const fetchAudit = async () => {
      try {
        const res = await fetch(`/api/audit/${auditId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAudit(data.audit);
        if (data.audit.status !== 'PENDING') clearInterval(interval);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load');
        clearInterval(interval);
      }
    };
    fetchAudit();
    interval = setInterval(fetchAudit, 3000);
    return () => clearInterval(interval);
  }, [auditId]);

  async function handleResync() {
    if (!audit || isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/reviews/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: (audit as any).businessId }),
      });
      if (res.ok) {
        // Reload the audit to pick up updated reviewsSyncedAt / reviewsActualCount
        const auditRes = await fetch(`/api/audit/${auditId}`);
        const auditJson = await auditRes.json();
        if (auditJson.audit) setAudit(auditJson.audit);
      }
    } catch {
      // silent — user can retry
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    try {
      const res  = await fetch(`/api/audit/${auditId}/share`, { method: 'POST' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      const url = `${window.location.origin}/reports/${json.token}`;
      setShareUrl(url);
    } catch (err) {
      console.error('[handleShare]', err);
    } finally {
      setSharing(false);
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleDownload() {
    if (!audit || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/audit/${auditId}/pdf`);
      if (!res.ok) throw new Error(`PDF generation failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${audit.businessName}-GMB-Report.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[handleDownload]', err);
    } finally {
      setDownloading(false);
    }
  }

  /* Loading */
  if (error) return (
    <div className="max-w-xl mx-auto mt-20 text-center bg-red-50 border border-red-200 rounded-2xl p-10">
      <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
      <h2 className="text-xl font-bold text-red-700 mb-2">Audit Failed</h2>
      <p className="text-red-600">{error}</p>
    </div>
  );
  if (!audit || audit.status === 'PENDING') return (
    <div className="max-w-xl mx-auto mt-20 flex flex-col items-center gap-6 text-center">
      <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
      <div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Analyzing your Business Profile…</h2>
        <p className="text-slate-500">
          Fetching local data and analyzing with AI.<br />
          <small className="text-slate-400">This usually takes 15–30 seconds.</small>
        </p>
      </div>
    </div>
  );

  const data = audit.auditData || {} as any;

  const overallScore = data.overallScore ?? 0;
  const searchRankScore = data.googleSearchRank?.score ?? 0;
  const profileScore = data.profileScore?.score ?? 0;
  const seoScore = data.seoScore?.score ?? 0;
  const reviewScore = data.reviewAnalysis?.score ?? 0;

  const competitors = data.competitors || [];
  const topKeywords = data.topKeywords || [];

  if (audit.auditVersion === 'V7') {
    return (
      <>
        <AuditReportGrexa
          audit={audit}
          onDownload={handleDownload}
          onResync={handleResync}
          onShare={handleShare}
          isSyncing={isSyncing}
        />

        {/* Share link modal */}
        {shareUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-violet-100 rounded-xl flex items-center justify-center">
                  <Share2 className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">Share Report</h2>
                  <p className="text-xs text-slate-500">Anyone with this link can view the report for 30 days</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4">
                <span className="flex-1 text-xs text-slate-600 truncate">{shareUrl}</span>
                <button
                  onClick={handleCopy}
                  className="shrink-0 flex items-center gap-1 text-xs font-bold text-violet-600 hover:text-violet-700 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <button
                onClick={() => setShareUrl(null)}
                className="w-full text-sm text-slate-500 hover:text-slate-700 transition-colors py-2"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {sharing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
            <div className="bg-white rounded-2xl shadow-xl px-8 py-6 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
              <span className="text-sm font-medium text-slate-700">Generating share link…</span>
            </div>
          </div>
        )}
      </>
    );
  }

  if (audit.auditVersion === 'V6') {
    return <AuditReportV6 audit={audit} onDownload={handleDownload} />;
  }

  return (
    <>
      <div className="max-w-5xl mx-auto pb-20">

        {/* Action bar */}
        <div className="bg-slate-900 text-white rounded-2xl p-5 mb-8 flex items-center justify-between flex-wrap gap-4 shadow-xl shadow-slate-900/10">
          <div>
            <h1 className="font-bold text-xl mb-1">{audit.businessName} — Audit Report</h1>
            <p className="text-slate-400 text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4" /> {audit.location}
            </p>
          </div>
          <button
            data-pdf-hide="true"
            onClick={handleDownload}
            disabled={downloading}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors flex items-center gap-2 disabled:opacity-80"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {downloading ? 'Generating PDF…' : 'Download PDF Report'}
          </button>
        </div>

        {/* Top Level Scores */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <ScoreCard title="Overall Score" score={overallScore} icon={<Award className="w-5 h-5 text-blue-500" />} />
          <ScoreCard title="Search Rank" score={searchRankScore} icon={<Search className="w-5 h-5 text-green-500" />} />
          <ScoreCard title="Profile Score" score={profileScore} icon={<Building2 className="w-5 h-5 text-purple-500" />} />
          <ScoreCard title="SEO Score" score={seoScore} icon={<TrendingUp className="w-5 h-5 text-rose-500" />} />
          <ScoreCard title="Review Score" score={reviewScore} icon={<MessageSquare className="w-5 h-5 text-amber-500" />} />
        </div>

        {/* Executive Summary */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 shadow-sm mb-8">
          <h2 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-600" /> Executive Summary
          </h2>
          {data.executiveSummary ? (
            <div className="prose prose-slate max-w-none text-slate-600">
              {data.executiveSummary.split('\\n').map((p: string, i: number) => p.trim() ? <p key={i}>{p}</p> : null)}
            </div>
          ) : (
            <DataUnavailable />
          )}
        </div>

        {/* Strengths & Weaknesses */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          <div className="bg-emerald-50 rounded-2xl p-6 border border-emerald-100">
            <h3 className="font-bold text-emerald-900 mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" /> Key Strengths
            </h3>
            {data.strengths && data.strengths.length > 0 ? (
              <ul className="space-y-3">
                {data.strengths.map((s: string, i: number) => (
                  <li key={i} className="text-emerald-800 text-sm flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            ) : <DataUnavailable />}
          </div>
          <div className="bg-rose-50 rounded-2xl p-6 border border-rose-100">
            <h3 className="font-bold text-rose-900 mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-rose-600" /> Key Weaknesses
            </h3>
            {data.weaknesses && data.weaknesses.length > 0 ? (
              <ul className="space-y-3">
                {data.weaknesses.map((s: string, i: number) => (
                  <li key={i} className="text-rose-800 text-sm flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            ) : <DataUnavailable />}
          </div>
        </div>

        {/* Competitor Analysis */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 shadow-sm mb-8">
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-slate-600" /> Competitor Analysis
          </h2>

          <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">AI Competitors Mapping</h3>
          {competitors.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500">Business Name</th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500">Category</th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500 text-center">Rating</th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500 text-center">Reviews</th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500 text-center">Distance</th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500">Reason</th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500 text-right">Strength</th>
                  </tr>
                </thead>
                <tbody>
                  {competitors.map((c: any, i: number) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4 text-sm font-medium text-slate-900">{c.name}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">{c.category || '—'}</td>
                      <td className="py-3 px-4 text-sm font-bold text-slate-700 text-center">{c.rating || '—'}</td>
                      <td className="py-3 px-4 text-sm text-slate-600 text-center">{c.reviewCount || '—'}</td>
                      <td className="py-3 px-4 text-xs text-slate-500 text-center">{c.distance || '—'}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">{c.reason || '—'}</td>
                      <td className="py-3 px-4 text-sm font-bold text-amber-500 text-right">{c.strengthLevel || c.estimatedStrength || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <DataUnavailable />}
        </div>
        
        {/* Keywords Analysis */}
        <div className="bg-white rounded-2xl p-6 md:p-8 border border-slate-200 shadow-sm mb-8">
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Search className="w-5 h-5 text-slate-600" /> Top Keywords
          </h2>

          {topKeywords.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500">Keyword</th>
                    <th className="py-3 px-4 text-xs font-semibold text-slate-500">Estimated Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {topKeywords.map((k: any, i: number) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-3 px-4 text-sm font-medium text-slate-900">{k.keyword}</td>
                      <td className="py-3 px-4 text-xs text-slate-500">{k.rank || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <DataUnavailable />}
        </div>

        {/* Opportunities Matrix */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <OpportunityCard title="Quick Wins" items={data.quickWins} icon={<Zap className="w-5 h-5 text-amber-500" />} />
          <OpportunityCard title="Growth Opportunities" items={data.growthOpportunities} icon={<TrendingUp className="w-5 h-5 text-purple-500" />} />
        </div>

        {/* Action Plan */}
        <div className="bg-slate-900 rounded-2xl p-6 md:p-8 text-white shadow-xl mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Zap className="w-32 h-32" />
          </div>

          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
              <ShieldAlert className="w-6 h-6 text-rose-400" /> Priority Fixes
            </h2>

            {data.priorityFixes && data.priorityFixes.length > 0 ? (
              <div className="grid gap-4 mb-10">
                {data.priorityFixes.map((r: string, i: number) => (
                  <div key={i} className="bg-white/10 border border-white/20 rounded-xl p-5 flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center font-bold shrink-0">{i + 1}</div>
                    <p className="text-slate-200 mt-1">{r}</p>
                  </div>
                ))}
              </div>
            ) : <DataUnavailable light />}

            <div className="grid md:grid-cols-2 gap-8 pt-8 border-t border-white/10">
              <div>
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-blue-400">
                  <Calendar className="w-5 h-5" /> 30-Day Action Plan
                </h3>
                {data.thirtyDayPlan && data.thirtyDayPlan.length > 0 ? (
                  <ul className="space-y-4">
                    {data.thirtyDayPlan.map((item: any, i: number) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 shrink-0" />
                        <span>{typeof item === 'string' ? item : `${item.week}: ${item.expectedOutcome}`}</span>
                      </li>
                    ))}
                  </ul>
                ) : <DataUnavailable light />}
              </div>

              <div>
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-purple-400">
                  <Globe className="w-5 h-5" /> 90-Day Roadmap
                </h3>
                {data.ninetyDayPlan && data.ninetyDayPlan.length > 0 ? (
                  <ul className="space-y-4">
                    {data.ninetyDayPlan.map((item: any, i: number) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-slate-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-2 shrink-0" />
                        <span>{typeof item === 'string' ? item : `${item.month}: ${(item.tasks || []).join(', ')}`}</span>
                      </li>
                    ))}
                  </ul>
                ) : <DataUnavailable light />}
              </div>
            </div>
          </div>
        </div>

      </div>

      <AuditDebugPanel auditData={audit} />
    </>
  );
}

/* ─── UI Components ──────────────────────────────────────── */

function ScoreCard({ title, score, icon }: { title: string, score: number, icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
      <div className="mb-3">{icon}</div>
      <div className="text-3xl font-black text-slate-900 mb-1">{score}</div>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{title}</div>
    </div>
  );
}

function OpportunityCard({ title, items, icon }: { title: string, items: string[], icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-bold text-slate-900">{title}</h3>
      </div>
      <div className="flex-1">
        {items && items.length > 0 ? (
          <ul className="space-y-3">
            {items.map((item, i) => (
              <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : <DataUnavailable />}
      </div>
    </div>
  );
}

function DataUnavailable({ light = false }: { light?: boolean }) {
  return (
    <div className={`py-6 text-center rounded-xl border ${light ? 'bg-white/5 border-white/10 text-slate-400' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
      <span className="text-sm font-medium">Data Unavailable</span>
    </div>
  );
}
