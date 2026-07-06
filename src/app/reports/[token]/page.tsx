'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Building2, MapPin, Globe, Star, TrendingUp, Shield, Zap,
  AlertTriangle, CheckCircle2, Clock, Target, ChevronRight,
  Loader2, XCircle,
} from 'lucide-react';

interface AuditPublic {
  _id: string;
  businessName: string;
  location: string;
  website?: string;
  overallScore?: number;
  auditVersion: string;
  auditData?: any;
  createdAt: string;
}

function ScoreRing({ score, size = 'lg' }: { score: number; size?: 'sm' | 'lg' }) {
  const r      = size === 'lg' ? 54 : 36;
  const circ   = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color  = score >= 75 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
  const dim    = size === 'lg' ? 130 : 88;
  const font   = size === 'lg' ? 'text-3xl' : 'text-xl';

  return (
    <div className="relative flex items-center justify-center" style={{ width: dim, height: dim }}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="-rotate-90">
        <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
        <circle
          cx={dim / 2} cy={dim / 2} r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold text-slate-900 ${font}`}>{score}</span>
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

const IMPACT_COLORS: Record<string, string> = {
  High:   'bg-red-50 text-red-700 border-red-100',
  Medium: 'bg-amber-50 text-amber-700 border-amber-100',
  Low:    'bg-blue-50 text-blue-700 border-blue-100',
};

export default function PublicReportPage() {
  const params = useParams();
  const token  = params.token as string;

  const [audit, setAudit]       = useState<AuditPublic | null>(null);
  const [expiresAt, setExpires] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/reports/${token}`)
      .then(r => r.json())
      .then(json => {
        if (!json.success) throw new Error(json.error);
        setAudit(json.audit);
        setExpires(json.expiresAt);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-violet-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading your report…</p>
        </div>
      </div>
    );
  }

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

  if (!audit) return null;

  const d           = audit.auditData || {};
  const profile     = d.profileScore  || {};
  const reviews     = d.reviewAnalysis || {};
  const priorityFixes = d.priorityFixes || [];
  const strengths   = d.strengths     || [];
  const weaknesses  = d.weaknesses    || [];
  const plan30      = d.thirtyDayPlan || [];
  const seo         = d.seoScore      || {};
  const overallScore = audit.overallScore ?? profile.overallScore ?? 0;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Branded header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-slate-900">GMBBoost</span>
          <span className="text-slate-300 mx-2">·</span>
          <span className="text-sm text-slate-500">Business Profile Audit Report</span>
        </div>
        {expiresAt && (
          <span className="text-xs text-slate-400 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Expires {new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        {/* Business summary */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-slate-900 mb-1">{audit.businessName}</h1>
              <div className="flex items-center gap-2 text-slate-500 text-sm mb-3">
                <MapPin className="w-4 h-4" />
                <span>{audit.location}</span>
              </div>
              {audit.website && (
                <div className="flex items-center gap-2 text-violet-600 text-sm">
                  <Globe className="w-4 h-4" />
                  <a href={audit.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {audit.website}
                  </a>
                </div>
              )}
              <div className="mt-4 text-xs text-slate-400">
                Report generated {new Date(audit.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>

            {overallScore > 0 && (
              <div className="flex flex-col items-center">
                <ScoreRing score={overallScore} />
                <span className="text-xs text-slate-500 mt-1 font-medium">Overall Score</span>
              </div>
            )}
          </div>
        </div>

        {/* Sub-scores */}
        {Object.keys(profile).length > 0 && (
          <div>
            <SectionHeader title="Profile Score Breakdown" icon={Shield} />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: 'SEO Score',        value: profile.seoScore              ?? 0, Icon: TrendingUp },
                { label: 'Review Score',     value: profile.reviewScore           ?? 0, Icon: Star },
                { label: 'Profile Complete', value: profile.profileCompletionScore ?? 0, Icon: CheckCircle2 },
                { label: 'Rating Score',     value: profile.ratingScore           ?? 0, Icon: Star },
                { label: 'Content Score',    value: profile.contentScore          ?? 0, Icon: Building2 },
              ].filter(s => s.value > 0).map(s => (
                <ScoreCard key={s.label} title={s.label} score={s.value} icon={s.Icon} />
              ))}
            </div>
          </div>
        )}

        {/* Review analytics */}
        {reviews.reviewCount > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <SectionHeader title="Review Analytics" icon={Star} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
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

            {reviews.mostCommonPraises?.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-slate-700 mb-2">What customers love</div>
                <div className="flex flex-wrap gap-2">
                  {reviews.mostCommonPraises.map((p: string) => (
                    <span key={p} className="px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-full border border-emerald-100">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Priority fixes */}
        {priorityFixes.length > 0 && (
          <div>
            <SectionHeader title="Priority Action Items" icon={AlertTriangle} />
            <div className="space-y-3">
              {priorityFixes.map((fix: any, idx: number) => (
                <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-7 h-7 bg-violet-50 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-violet-700">{idx + 1}</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900 mb-1">{fix.title}</h3>
                        <p className="text-sm text-slate-500">{fix.reason}</p>
                        {fix.expectedScoreGain && (
                          <span className="inline-block mt-2 text-xs font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-md">
                            {fix.expectedScoreGain}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`flex-shrink-0 px-2 py-0.5 text-xs font-bold rounded-md border ${IMPACT_COLORS[fix.impact] ?? IMPACT_COLORS.Low}`}>
                      {fix.impact} impact
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Strengths & Weaknesses */}
        {(strengths.length > 0 || weaknesses.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {strengths.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <SectionHeader title="Strengths" icon={CheckCircle2} />
                <ul className="space-y-3">
                  {strengths.map((s: any, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{s.title}</div>
                        {s.evidence && <div className="text-xs text-slate-500">{s.evidence}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {weaknesses.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                <SectionHeader title="Areas to Improve" icon={AlertTriangle} />
                <ul className="space-y-3">
                  {weaknesses.map((w: any, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-semibold text-slate-800">{w.title}</div>
                        {w.evidence && <div className="text-xs text-slate-500">{w.evidence}</div>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* 30-day plan */}
        {plan30.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
            <SectionHeader title="30-Day Action Plan" icon={Target} />
            <div className="space-y-4">
              {plan30.map((week: any, idx: number) => (
                <div key={idx} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 bg-violet-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {idx + 1}
                    </div>
                    {idx < plan30.length - 1 && <div className="w-0.5 flex-1 bg-slate-200 mt-1" />}
                  </div>
                  <div className="pb-4 flex-1">
                    <div className="font-semibold text-slate-900 mb-1">{week.week}</div>
                    {week.expectedOutcome && (
                      <div className="text-xs text-violet-600 font-medium mb-2">{week.expectedOutcome}</div>
                    )}
                    <ul className="space-y-1">
                      {week.tasks?.map((task: string, ti: number) => (
                        <li key={ti} className="flex items-center gap-2 text-sm text-slate-600">
                          <ChevronRight className="w-3 h-3 text-slate-300 flex-shrink-0" />
                          {task}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer CTA */}
        <div className="bg-violet-600 rounded-2xl p-8 text-center text-white">
          <h2 className="text-2xl font-bold mb-2">Ready to boost your Google ranking?</h2>
          <p className="text-violet-200 text-sm mb-6">
            GMBBoost automates reviews, content, and GBP optimisation — so you show up first.
          </p>
          <a
            href="/"
            className="inline-block bg-white text-violet-700 font-bold px-6 py-3 rounded-xl hover:bg-violet-50 transition-colors"
          >
            Get Started Free
          </a>
        </div>
      </div>
    </div>
  );
}
