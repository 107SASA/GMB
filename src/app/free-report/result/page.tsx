'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MapPin, Globe, Star, TrendingUp, Shield, Zap,
  AlertTriangle, CheckCircle2, Loader2, XCircle, Building2,
} from 'lucide-react';
import AuditPaywallSidebar from '@/components/audit/AuditPaywallSidebar';

interface AuditDoc {
  _id: string;
  status: string;
  businessName: string;
  location: string;
  website?: string;
  overallScore?: number;
  auditData?: any;
  createdAt: string;
}

function ScoreRing({ score }: { score: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div className="relative flex items-center justify-center" style={{ width: 130, height: 130 }}>
      <svg width={130} height={130} viewBox="0 0 130 130" className="-rotate-90">
        <circle cx={65} cy={65} r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
        <circle
          cx={65} cy={65} r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bold text-slate-900 text-3xl">{score}</span>
        <span className="text-[10px] text-slate-400 uppercase tracking-wide">/ 100</span>
      </div>
    </div>
  );
}

function ScoreCard({ title, score, icon: Icon }: { title: string; score: number; icon: React.ElementType }) {
  const color = score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-500';
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 text-center shadow-sm">
      <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center mx-auto mb-3">
        <Icon className="w-5 h-5 text-slate-500" />
      </div>
      <div className={`text-2xl font-bold mb-0.5 ${color}`}>{score}</div>
      <div className="text-xs text-slate-500 font-medium">{title}</div>
    </div>
  );
}

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 bg-violet-100 rounded-xl flex items-center justify-center">
        <Icon className="w-4 h-4 text-violet-600" />
      </div>
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
    </div>
  );
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~3 minutes

export default function FreeReportResultPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-violet-600" />
        </div>
      }
    >
      <FreeReportResultContent />
    </Suspense>
  );
}

function FreeReportResultContent() {
  const searchParams = useSearchParams();
  const auditId = searchParams.get('auditId');

  const [audit, setAudit] = useState<AuditDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempts = useRef(0);

  useEffect(() => {
    if (!auditId) {
      setError('Missing report reference.');
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/audit/${auditId}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setError(json.error || 'Could not load your report.');
          return;
        }
        setAudit(json.audit);
        if (json.audit.status === 'COMPLETED' || json.audit.status === 'FAILED') return;

        attempts.current += 1;
        if (attempts.current >= MAX_POLL_ATTEMPTS) {
          setError('This is taking longer than usual. Refresh the page in a minute to check again.');
          return;
        }
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) setError('Network error while loading your report.');
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [auditId]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <XCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">Report unavailable</h1>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const generating = !audit || audit.status === 'PENDING' || audit.status === 'PROCESSING';

  if (generating) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md flex flex-col items-center gap-8">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin text-violet-600 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">Generating your report…</h1>
            <p className="text-slate-500 text-sm">This usually takes about a minute.</p>
          </div>
          <AuditPaywallSidebar generating />
        </div>
      </div>
    );
  }

  if (audit!.status === 'FAILED') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <XCircle className="w-14 h-14 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 mb-2">We couldn't generate this report</h1>
          <p className="text-slate-500 text-sm">Please try again from the form.</p>
        </div>
      </div>
    );
  }

  const d = audit!.auditData || {};
  const profile = d.profileScore || {};
  const reviews = d.reviewAnalysis || {};
  const priorityFixes = d.priorityFixes || [];
  const overallScore = audit!.overallScore ?? profile.overallScore ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-2">
        <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
          <Zap className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-slate-900">GrowwMatics AI</span>
        <span className="text-slate-300 mx-2">·</span>
        <span className="text-sm text-slate-500">Your Free Business Report</span>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex-1 space-y-8 w-full">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-slate-900 mb-1">{audit!.businessName}</h1>
                <div className="flex items-center gap-2 text-slate-500 text-sm mb-3">
                  <MapPin className="w-4 h-4" />
                  <span>{audit!.location}</span>
                </div>
                {audit!.website && (
                  <div className="flex items-center gap-2 text-violet-600 text-sm">
                    <Globe className="w-4 h-4" />
                    <a href={audit!.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {audit!.website}
                    </a>
                  </div>
                )}
              </div>
              {overallScore > 0 && (
                <div className="flex flex-col items-center">
                  <ScoreRing score={overallScore} />
                  <span className="text-xs text-slate-500 mt-1 font-medium">Overall Score</span>
                </div>
              )}
            </div>
          </div>

          {Object.keys(profile).length > 0 && (
            <div>
              <SectionHeader title="Profile Score Breakdown" icon={Shield} />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { label: 'SEO Score', value: profile.seoScore ?? 0, Icon: TrendingUp },
                  { label: 'Review Score', value: profile.reviewScore ?? 0, Icon: Star },
                  { label: 'Profile Complete', value: profile.profileCompletionScore ?? 0, Icon: CheckCircle2 },
                  { label: 'Rating Score', value: profile.ratingScore ?? 0, Icon: Star },
                  { label: 'Content Score', value: profile.contentScore ?? 0, Icon: Building2 },
                ]
                  .filter((s) => s.value > 0)
                  .map((s) => (
                    <ScoreCard key={s.label} title={s.label} score={s.value} icon={s.Icon} />
                  ))}
              </div>
            </div>
          )}

          {reviews.reviewCount > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <SectionHeader title="Review Analytics" icon={Star} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-slate-900">{reviews.reviewCount}</div>
                  <div className="text-xs text-slate-500 mt-1">Total Reviews</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-500">{reviews.averageRating?.toFixed(1) ?? '—'}</div>
                  <div className="text-xs text-slate-500 mt-1">Avg Rating</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-emerald-600">{reviews.positivePercent ?? 0}%</div>
                  <div className="text-xs text-slate-500 mt-1">Positive</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-slate-700">{reviews.responseRate ?? '—'}</div>
                  <div className="text-xs text-slate-500 mt-1">Response Rate</div>
                </div>
              </div>
            </div>
          )}

          {priorityFixes.length > 0 && (
            <div>
              <SectionHeader title="Priority Action Items" icon={AlertTriangle} />
              <div className="space-y-3">
                {priorityFixes.map((fix: any, idx: number) => (
                  <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 bg-violet-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-violet-700">{idx + 1}</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 mb-1">{fix.title}</h3>
                        <p className="text-sm text-slate-500">{fix.reason}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <AuditPaywallSidebar />
      </div>
    </div>
  );
}
