'use client';

import { useEffect, useState } from 'react';
import { IAudit } from '@/models/Audit';
import { Download, Sparkles, Building2, Globe, MapPin, Zap, TrendingUp, Search, MessageSquare, AlertCircle, Calendar, Target, ShieldAlert, Award, Loader2, CheckCircle2, Share2, Copy, Check } from 'lucide-react';
import AuditDebugPanel from './AuditDebugPanel';
import AuditReportV6 from './AuditReportV6';
import AuditReportGrexa from './AuditReportGrexa';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

/* ─── Main dashboard ──────────────────────────────────────── */

// Generation is a real async pipeline (Inngest job, ~15-30s typical): review
// sync, then geo-grid rank + competitor discovery, then profile/SEO scoring,
// then the AI narrative call, then save. There's no per-step progress written
// to the DB, so these stages are elapsed-time-based rather than polled from
// the backend — but they mirror the pipeline's real order, and the 3s status
// poll below (not this timer) is what actually decides when to stop showing
// them, so it can never claim "done" before the backend says so.
const PROGRESS_STAGES = [
  { atSeconds: 0,  label: 'Starting audit…' },
  { atSeconds: 3,  label: 'Analyzing your Business Profile…' },
  { atSeconds: 8,  label: 'Checking SEO signals…' },
  { atSeconds: 14, label: 'Analyzing competitors nearby…' },
  { atSeconds: 20, label: 'Generating your report…' },
  { atSeconds: 27, label: 'Finalizing results…' },
];

export default function AuditResultsDashboard({ auditId }: { auditId: string }) {
  const [audit, setAudit] = useState<IAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [shareUrl, setShareUrl]   = useState<string | null>(null);
  const [sharing, setSharing]     = useState(false);
  const [copied, setCopied]       = useState(false);
  // The freemium upgrade prompt used to be a modal fired from here. It is now a
  // persistent sidebar rendered alongside this component by GatedAuditReport,
  // so the user can read the whole report without being interrupted.

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let attempts = 0;
    // Generation normally finishes in 15–30s. The backend marks the audit
    // FAILED on a caught error, which stops this poll immediately — but if the
    // job never runs at all (e.g. the worker crashed or a queue never picked
    // it up), status stays PENDING forever and this would otherwise spin
    // indefinitely with no way out. Cap it at 4 minutes (80 x 3s) and surface
    // a clear message instead.
    const MAX_ATTEMPTS = 80;
    const fetchAudit = async () => {
      try {
        const res = await fetch(`/api/audit/${auditId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setAudit(data.audit);
        if (data.audit.status !== 'PENDING') {
          clearInterval(interval);
          return;
        }
        attempts += 1;
        if (attempts >= MAX_ATTEMPTS) {
          clearInterval(interval);
          setError(
            'This audit is taking much longer than usual. Refresh the page in a few minutes to check on it, or run a new one.'
          );
        }
      } catch (err: unknown) {
        setError(friendlyClientMessage(err, 'Failed to load'));
        clearInterval(interval);
      }
    };
    fetchAudit();
    interval = setInterval(fetchAudit, 3000);
    return () => clearInterval(interval);
  }, [auditId]);

  // Drives the staged progress label while PENDING — separate from the poll
  // above so the messages advance smoothly every second instead of jumping
  // only on 3s ticks.
  useEffect(() => {
    if (audit && audit.status !== 'PENDING') return;
    const tick = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, [audit?.status]);

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

  /* Loading / failure states */
  if (error) return (
    <div className="max-w-xl mx-auto mt-20 text-center bg-error-container border border-error-container rounded-2xl p-10">
      <AlertCircle className="w-12 h-12 text-error mx-auto mb-4" />
      <h2 className="text-xl font-bold text-on-error-container mb-2">Audit Failed</h2>
      <p className="text-error">{error}</p>
    </div>
  );
  // Was previously unhandled — a FAILED audit fell through to the normal
  // render below with an empty auditData, showing a blank/zeroed report
  // instead of telling the user anything went wrong.
  if (audit && audit.status === 'FAILED') return (
    <div className="max-w-xl mx-auto mt-20 text-center bg-error-container border border-error-container rounded-2xl p-10">
      <AlertCircle className="w-12 h-12 text-error mx-auto mb-4" />
      <h2 className="text-xl font-bold text-on-error-container mb-2">Audit Failed</h2>
      {/* audit.metadata.error is the raw backend exception message (logged
          server-side by auditService.ts) — never rendered to the user, same
          reasoning as friendlyMessage.ts on the server side. */}
      <p className="text-error">
        We couldn&apos;t finish generating this report. Please try running a new audit — if this keeps
        happening, contact support.
      </p>
    </div>
  );
  if (!audit || audit.status === 'PENDING') {
    const stage = [...PROGRESS_STAGES].reverse().find((s) => elapsedSeconds >= s.atSeconds) ?? PROGRESS_STAGES[0];
    return (
      <div className="max-w-xl mx-auto mt-20 flex flex-col items-center gap-6 text-center">
        <div className="w-16 h-16 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin" />
        <div>
          <h2 className="text-2xl font-bold text-on-surface mb-2">{stage.label}</h2>
          <p className="text-on-surface-variant">
            Fetching local data and analyzing with AI.<br />
            <small className="text-outline">This usually takes 15–30 seconds.</small>
          </p>
        </div>
      </div>
    );
  }

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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/60 backdrop-blur-sm">
            <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-primary-fixed rounded-xl flex items-center justify-center">
                  <Share2 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-on-surface">Share Report</h2>
                  <p className="text-xs text-on-surface-variant">Anyone with this link can view the report for 30 days</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-surface border border-outline-variant rounded-xl p-3 mb-4">
                <span className="flex-1 text-xs text-on-surface-variant truncate">{shareUrl}</span>
                <button
                  onClick={handleCopy}
                  className="shrink-0 flex items-center gap-1 text-xs font-bold text-primary hover:text-primary transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-secondary" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <button
                onClick={() => setShareUrl(null)}
                className="w-full text-sm text-on-surface-variant hover:text-on-surface transition-colors py-2"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {sharing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40">
            <div className="bg-surface-container-lowest rounded-2xl card-shadow px-8 py-6 flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="text-sm font-medium text-on-surface">Generating share link…</span>
            </div>
          </div>
        )}

      </>
    );
  }

  if (audit.auditVersion === 'V6') {
    return (
      <>
        <AuditReportV6 audit={audit} onDownload={handleDownload} />
      </>
    );
  }

  return (
    <>
      <div className="max-w-5xl mx-auto pb-20">

        {/* Action bar */}
        <div className="bg-primary text-white rounded-2xl p-5 mb-8 flex items-center justify-between flex-wrap gap-4 card-shadow">
          <div>
            <h1 className="font-bold text-xl mb-1">{audit.businessName} — Audit Report</h1>
            <p className="text-outline text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4" /> {audit.location}
            </p>
          </div>
          <button
            data-pdf-hide="true"
            onClick={handleDownload}
            disabled={downloading}
            className="bg-primary hover:bg-primary-container text-white px-6 py-3 rounded-xl font-bold text-sm transition-colors flex items-center gap-2 disabled:opacity-80"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {downloading ? 'Generating PDF…' : 'Download PDF Report'}
          </button>
        </div>

        {/* Top Level Scores */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <ScoreCard title="Overall Score" score={overallScore} icon={<Award className="w-5 h-5 text-primary" />} />
          <ScoreCard title="Search Rank" score={searchRankScore} icon={<Search className="w-5 h-5 text-secondary" />} />
          <ScoreCard title="Profile Score" score={profileScore} icon={<Building2 className="w-5 h-5 text-primary" />} />
          <ScoreCard title="SEO Score" score={seoScore} icon={<TrendingUp className="w-5 h-5 text-error" />} />
          <ScoreCard title="Review Score" score={reviewScore} icon={<MessageSquare className="w-5 h-5 text-error" />} />
        </div>

        {/* Executive Summary */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant shadow-sm mb-8">
          <h2 className="text-xl font-bold text-on-surface mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" /> Executive Summary
          </h2>
          {data.executiveSummary ? (
            <div className="prose prose max-w-none text-on-surface-variant">
              {data.executiveSummary.split('\\n').map((p: string, i: number) => p.trim() ? <p key={i}>{p}</p> : null)}
            </div>
          ) : (
            <DataUnavailable />
          )}
        </div>

        {/* Strengths & Weaknesses */}
        <div className="grid md:grid-cols-2 gap-8 mb-8">
          <div className="bg-secondary-container/40 rounded-2xl p-6 border border-secondary-fixed">
            <h3 className="font-bold text-on-secondary-container mb-4 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-secondary" /> Key Strengths
            </h3>
            {data.strengths && data.strengths.length > 0 ? (
              <ul className="space-y-3">
                {data.strengths.map((s: string, i: number) => (
                  <li key={i} className="text-on-secondary-container text-sm flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-secondary mt-1.5 shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            ) : <DataUnavailable />}
          </div>
          <div className="bg-error-container rounded-2xl p-6 border border-error">
            <h3 className="font-bold text-on-error-container mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-on-error-container" /> Key Weaknesses
            </h3>
            {data.weaknesses && data.weaknesses.length > 0 ? (
              <ul className="space-y-3">
                {data.weaknesses.map((s: string, i: number) => (
                  <li key={i} className="text-error text-sm flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-error mt-1.5 shrink-0" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            ) : <DataUnavailable />}
          </div>
        </div>

        {/* Competitor Analysis */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant shadow-sm mb-8">
          <h2 className="text-xl font-bold text-on-surface mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-on-surface-variant" /> Competitor Analysis
          </h2>

          <h3 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider mb-3">AI Competitors Mapping</h3>
          {competitors.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant">
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant">Business Name</th>
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant">Category</th>
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant text-center">Rating</th>
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant text-center">Reviews</th>
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant text-center">Distance</th>
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant">Reason</th>
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant text-right">Strength</th>
                  </tr>
                </thead>
                <tbody>
                  {competitors.map((c: any, i: number) => (
                    <tr key={i} className="border-b border-outline-variant hover:bg-surface">
                      <td className="py-3 px-4 text-sm font-medium text-on-surface">{c.name}</td>
                      <td className="py-3 px-4 text-xs text-on-surface-variant">{c.category || '—'}</td>
                      <td className="py-3 px-4 text-sm font-bold text-on-surface text-center">{c.rating || '—'}</td>
                      <td className="py-3 px-4 text-sm text-on-surface-variant text-center">{c.reviewCount || '—'}</td>
                      <td className="py-3 px-4 text-xs text-on-surface-variant text-center">{c.distance || '—'}</td>
                      <td className="py-3 px-4 text-xs text-on-surface-variant">{c.reason || '—'}</td>
                      <td className="py-3 px-4 text-sm font-bold text-error text-right">{c.strengthLevel || c.estimatedStrength || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <DataUnavailable />}
        </div>
        
        {/* Keywords Analysis */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 md:p-8 border border-outline-variant shadow-sm mb-8">
          <h2 className="text-xl font-bold text-on-surface mb-6 flex items-center gap-2">
            <Search className="w-5 h-5 text-on-surface-variant" /> Top Keywords
          </h2>

          {topKeywords.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant">
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant">Keyword</th>
                    <th className="py-3 px-4 text-xs font-semibold text-on-surface-variant">Estimated Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {topKeywords.map((k: any, i: number) => (
                    <tr key={i} className="border-b border-outline-variant hover:bg-surface">
                      <td className="py-3 px-4 text-sm font-medium text-on-surface">{k.keyword}</td>
                      <td className="py-3 px-4 text-xs text-on-surface-variant">{k.rank || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <DataUnavailable />}
        </div>

        {/* Opportunities Matrix */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <OpportunityCard title="Quick Wins" items={data.quickWins} icon={<Zap className="w-5 h-5 text-error" />} />
          <OpportunityCard title="Growth Opportunities" items={data.growthOpportunities} icon={<TrendingUp className="w-5 h-5 text-primary" />} />
        </div>

        {/* Action Plan */}
        <div className="bg-primary rounded-2xl p-6 md:p-8 text-white card-shadow mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Zap className="w-32 h-32" />
          </div>

          <div className="relative z-10">
            <h2 className="text-2xl font-bold mb-8 flex items-center gap-3">
              <ShieldAlert className="w-6 h-6 text-error" /> Priority Fixes
            </h2>

            {data.priorityFixes && data.priorityFixes.length > 0 ? (
              <div className="grid gap-4 mb-10">
                {data.priorityFixes.map((r: string, i: number) => (
                  <div key={i} className="bg-surface-container-lowest/10 border border-white/20 rounded-xl p-5 flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-error-container text-error flex items-center justify-center font-bold shrink-0">{i + 1}</div>
                    <p className="text-outline-variant mt-1">{r}</p>
                  </div>
                ))}
              </div>
            ) : <DataUnavailable light />}

            <div className="grid md:grid-cols-2 gap-8 pt-8 border-t border-white/10">
              <div>
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-primary">
                  <Calendar className="w-5 h-5" /> 30-Day Action Plan
                </h3>
                {data.thirtyDayPlan && data.thirtyDayPlan.length > 0 ? (
                  <ul className="space-y-4">
                    {data.thirtyDayPlan.map((item: any, i: number) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-outline">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                        <span>{typeof item === 'string' ? item : `${item.week}: ${item.expectedOutcome}`}</span>
                      </li>
                    ))}
                  </ul>
                ) : <DataUnavailable light />}
              </div>

              <div>
                <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-primary">
                  <Globe className="w-5 h-5" /> 90-Day Roadmap
                </h3>
                {data.ninetyDayPlan && data.ninetyDayPlan.length > 0 ? (
                  <ul className="space-y-4">
                    {data.ninetyDayPlan.map((item: any, i: number) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-outline">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
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
    <div className="bg-surface-container-lowest rounded-xl p-5 border border-outline-variant card-shadow flex flex-col items-center justify-center text-center">
      <div className="mb-3">{icon}</div>
      <div className="text-3xl font-black text-on-surface mb-1">{score}</div>
      <div className="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">{title}</div>
    </div>
  );
}

function OpportunityCard({ title, items, icon }: { title: string, items: string[], icon: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest rounded-2xl p-6 border border-outline-variant shadow-sm flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-bold text-on-surface">{title}</h3>
      </div>
      <div className="flex-1">
        {items && items.length > 0 ? (
          <ul className="space-y-3">
            {items.map((item, i) => (
              <li key={i} className="text-sm text-on-surface-variant flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-surface-container-highest mt-1.5 shrink-0" />
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
    <div className={`py-6 text-center rounded-xl border ${light ? 'bg-surface-container-lowest/5 border-white/10 text-outline' : 'bg-surface border-outline-variant text-on-surface-variant'}`}>
      <span className="text-sm font-medium">Data Unavailable</span>
    </div>
  );
}
