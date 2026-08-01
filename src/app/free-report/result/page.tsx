'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MapPin, Globe, Star, TrendingUp, Shield, Zap,
  AlertTriangle, CheckCircle2, Loader2, XCircle, Building2,
  Trophy, HelpCircle, ArrowRight, ThumbsUp, ThumbsDown,
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

function ChecklistIcon({ status }: { status: string }) {
  if (status === 'Complete') return <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />;
  if (status === 'Missing') return <XCircle className="w-5 h-5 text-red-500 shrink-0" />;
  if (status === 'Partial') return <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />;
  return <HelpCircle className="w-5 h-5 text-slate-300 shrink-0" />;
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
            <p className="text-slate-500 text-sm">This usually takes about 20–30 seconds.</p>
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

  // ── Derived data ──────────────────────────────────────────────────────────
  const d = audit!.auditData || {};
  const profile = d.profileScore || {};
  const reviews = d.reviewAnalysis || {};
  const priorityFixes = d.priorityFixes || [];
  const strengths = d.strengths || [];
  const weaknesses = d.weaknesses || [];
  const checklist: Array<{ field: string; status: string }> = d.profileCompletion?.checklist || [];
  const missingOrPartial = checklist.filter((c) => c.status === 'Missing' || c.status === 'Partial');
  // "Unknown" fields (Photos, Hours, Videos, Logo, Attributes, Booking Link)
  // genuinely can't be checked without a real Google connection — shown as
  // one summary line below instead of repeating "Connect Google to check"
  // on every row.
  const knownChecklist = checklist.filter((c) => c.status !== 'Unknown');
  const unknownChecklistCount = checklist.length - knownChecklist.length;
  const keywordGaps: Array<{ keyword: string; missing: boolean; priority: string }> =
    (d.keywordGapAnalysis || []).filter((k: any) => k.missing);
  const overallScore = audit!.overallScore ?? profile.overallScore ?? 0;
  const rank = d.googleSearchRank?.averageRank;

  const localCompetitors: Array<{ name: string; avgRank?: number; rating?: number; reviewCount?: number }> =
    d.localPackCompetitors?.length
      ? d.localPackCompetitors
      : (d.competitors || []).map((c: any) => ({
          name: c.name,
          avgRank: c.estimatedRank,
          rating: c.rating,
          reviewCount: c.reviewCount,
        }));
  const competitorsAhead = localCompetitors.length;
  const issuesCount = missingOrPartial.length + keywordGaps.length;
  const profileCompletionPct = d.profileCompletion?.completionPercentage ?? profile.profileCompletionScore ?? 0;

  // "Why {business} isn't ranking" — built from real audit data only.
  const issueLines: string[] = [];
  if (reviews.reviewCount > 0 && reviews.responseRate) {
    const respPct = parseInt(reviews.responseRate, 10) || 0;
    if (respPct < 60) {
      const unanswered = Math.max(0, Math.round(reviews.reviewCount * (1 - respPct / 100)));
      issueLines.push(`${unanswered.toLocaleString('en-IN')} reviews unanswered — only ${reviews.responseRate} have a reply`);
    }
  }
  if (keywordGaps.length > 0) {
    issueLines.push(`${keywordGaps.length} important keyword${keywordGaps.length > 1 ? 's are' : ' is'} missing from your profile`);
  }
  keywordGaps.slice(0, 3).forEach((k) => issueLines.push(`Keyword "${k.keyword}" not found on your profile`));
  missingOrPartial.slice(0, 5).forEach((c) => issueLines.push(`${c.field} is ${c.status.toLowerCase()} on your profile`));

  const location = audit!.location;
  const city = location?.split(',')[0]?.trim() || 'your area';

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
          {/* Business summary */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="flex-1">
                <h1 className="text-3xl font-bold text-slate-900 mb-1">{audit!.businessName}</h1>
                <div className="flex items-center gap-2 text-slate-500 text-sm mb-3">
                  <MapPin className="w-4 h-4" />
                  <span>{audit!.location}</span>
                </div>
                {reviews.reviewCount > 0 && (
                  <div className="flex items-center gap-1.5 text-sm mb-2">
                    <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                    <span className="font-bold text-slate-900">{reviews.averageRating?.toFixed(1)}</span>
                    <span className="text-slate-400">({reviews.reviewCount.toLocaleString('en-IN')} reviews)</span>
                  </div>
                )}
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

          {/* Losing-customers headline */}
          {competitorsAhead > 0 && (
            <div className="bg-white rounded-2xl border border-red-100 shadow-sm p-8">
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                {audit!.businessName} is losing customers to {competitorsAhead} competitor{competitorsAhead > 1 ? 's' : ''} on Google.
              </h2>
              <p className="text-slate-500 text-sm mb-6">
                Right now, when people search your business in {city}, your competitors show up first.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-red-50 rounded-xl p-4 text-center border border-red-100">
                  <div className="text-2xl font-bold text-red-600">{competitorsAhead}</div>
                  <div className="text-xs text-slate-500 mt-1">Competitors ranking higher</div>
                </div>
                <div className="bg-amber-50 rounded-xl p-4 text-center border border-amber-100">
                  <div className="text-2xl font-bold text-amber-600">{issuesCount}</div>
                  <div className="text-xs text-slate-500 mt-1">Issues hurting your ranking</div>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-center border border-slate-200">
                  <div className="text-2xl font-bold text-slate-900">{Math.round(profileCompletionPct)}%</div>
                  <div className="text-xs text-slate-500 mt-1">Profile complete</div>
                </div>
              </div>
              <a
                href="#unlock"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl font-bold hover:opacity-90 transition-all shadow-md"
              >
                Fix My Google Profile <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          )}

          {/* Local competitors — only rows with real rating/review data are
              shown (no Rank column and no "you" comparison row: neither
              geo-grid rank nor your own review data is fetched for this
              free report, so showing dashes for them would look broken). */}
          {localCompetitors.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <SectionHeader title="Other businesses in your area" icon={Trophy} />
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm min-w-90">
                  <thead>
                    <tr className="text-left text-xs text-slate-400 uppercase tracking-wide">
                      <th className="px-2 py-2 font-medium">Business</th>
                      <th className="px-2 py-2 font-medium">Rating</th>
                      <th className="px-2 py-2 font-medium">Reviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {localCompetitors.slice(0, 3).map((c, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-3 font-medium text-slate-700">{c.name}</td>
                        <td className="px-2 py-3 text-amber-600">{c.rating != null ? `★ ${c.rating.toFixed(1)}` : '—'}</td>
                        <td className="px-2 py-3 text-emerald-600">{c.reviewCount ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Why isn't ranking */}
          {issueLines.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <SectionHeader title={`Why ${audit!.businessName} isn't ranking`} icon={AlertTriangle} />
              <ul className="space-y-3">
                {issueLines.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sub-scores */}
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

          {/* Review analytics */}
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

          {/* Profile completion checklist */}
          {checklist.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <SectionHeader title="Profile Completion" icon={CheckCircle2} />
              <div className="mb-5">
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                  <span>{Math.round(profileCompletionPct)}% filled in</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                    style={{ width: `${Math.min(100, Math.round(profileCompletionPct))}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {knownChecklist.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm">
                    <ChecklistIcon status={c.status} />
                    <span className={c.status === 'Missing' ? 'text-slate-700 font-medium' : 'text-slate-600'}>
                      {c.field}
                    </span>
                  </div>
                ))}
              </div>
              {unknownChecklistCount > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
                  <HelpCircle className="w-4 h-4 shrink-0" />
                  {unknownChecklistCount} more item{unknownChecklistCount > 1 ? 's' : ''} verified once you connect your Google account
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

          {/* Strengths & Weaknesses */}
          {(strengths.length > 0 || weaknesses.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {strengths.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                  <SectionHeader title="Strengths" icon={ThumbsUp} />
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
                  <SectionHeader title="Areas to Improve" icon={ThumbsDown} />
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
        </div>

        <div id="unlock">
          <AuditPaywallSidebar
            unlockHeadline="Your report is free to keep. Unlock the full detailed report — every issue, every keyword gap, and a step-by-step action plan — plus the whole platform."
            showComparison
          />
        </div>
      </div>
    </div>
  );
}
