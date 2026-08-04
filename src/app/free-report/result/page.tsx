'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AuditPaywallSidebar from '@/components/audit/AuditPaywallSidebar';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

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
  const color = score >= 75 ? '#006c45' : score >= 50 ? '#1a4f8b' : '#ba1a1a';
  return (
    <div className="relative flex items-center justify-center" style={{ width: 130, height: 130 }}>
      <svg width={130} height={130} viewBox="0 0 130 130" className="-rotate-90">
        <circle cx={65} cy={65} r={r} fill="none" stroke="#eceef0" strokeWidth="8" />
        <circle
          cx={65} cy={65} r={r} fill="none"
          stroke={color} strokeWidth="8"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-heading font-bold text-on-surface text-3xl">{score}</span>
        <span className="text-[10px] text-outline uppercase tracking-wide">/ 100</span>
      </div>
    </div>
  );
}

function ScoreCard({ title, score, icon }: { title: string; score: number; icon: string }) {
  const color = score >= 75 ? 'text-secondary' : score >= 50 ? 'text-primary-container' : 'text-error';
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 text-center card-shadow">
      <div className="w-10 h-10 bg-surface-container rounded-xl flex items-center justify-center mx-auto mb-3">
        <MaterialIcon name={icon} size={20} className="text-on-surface-variant" />
      </div>
      <div className={`font-heading text-2xl font-bold mb-0.5 ${color}`}>{score}</div>
      <div className="text-xs text-on-surface-variant font-medium">{title}</div>
    </div>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 bg-primary-fixed rounded-xl flex items-center justify-center">
        <MaterialIcon name={icon} size={16} className="text-primary" />
      </div>
      <h2 className="font-heading text-lg font-bold text-on-surface">{title}</h2>
    </div>
  );
}

function ChecklistIcon({ status }: { status: string }) {
  if (status === 'Complete') return <MaterialIcon name="check_circle" size={20} className="text-secondary shrink-0" />;
  if (status === 'Missing') return <MaterialIcon name="cancel" size={20} className="text-error shrink-0" />;
  if (status === 'Partial') return <MaterialIcon name="warning" size={20} className="text-primary-container shrink-0" />;
  return <MaterialIcon name="help" size={20} className="text-outline shrink-0" />;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // ~3 minutes

export default function FreeReportResultPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <MaterialIcon name="progress_activity" size={40} className="animate-spin text-primary" />
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
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <MaterialIcon name="cancel" size={56} className="text-error mx-auto mb-4" />
          <h1 className="font-heading text-xl font-bold text-on-surface mb-2">Report unavailable</h1>
          <p className="text-on-surface-variant text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const generating = !audit || audit.status === 'PENDING' || audit.status === 'PROCESSING';

  if (generating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md flex flex-col items-center gap-8">
          <div className="text-center">
            <MaterialIcon name="progress_activity" size={40} className="animate-spin text-primary mx-auto mb-4" />
            <h1 className="font-heading text-xl font-bold text-on-surface mb-2">Generating your report…</h1>
            <p className="text-on-surface-variant text-sm">This usually takes about 20–30 seconds.</p>
          </div>
          <AuditPaywallSidebar generating />
        </div>
      </div>
    );
  }

  if (audit!.status === 'FAILED') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <MaterialIcon name="cancel" size={56} className="text-error mx-auto mb-4" />
          <h1 className="font-heading text-xl font-bold text-on-surface mb-2">We couldn't generate this report</h1>
          <p className="text-on-surface-variant text-sm">Please try again from the form.</p>
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
    <div className="min-h-screen bg-background">
      <div className="bg-surface-container-lowest border-b border-outline-variant px-6 py-4 flex items-center gap-2">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
          <MaterialIcon name="bolt" size={16} className="text-on-primary" />
        </div>
        <span className="font-heading font-bold text-on-surface">GrowwMatics AI</span>
        <span className="text-outline mx-2">·</span>
        <span className="text-sm text-on-surface-variant">Your Free Business Report</span>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10 flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex-1 space-y-8 w-full">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              <div className="flex-1">
                <h1 className="font-heading text-3xl font-bold text-on-surface mb-1">{audit!.businessName}</h1>
                <div className="flex items-center gap-2 text-on-surface-variant text-sm mb-3">
                  <MaterialIcon name="location_on" size={16} />
                  <span>{audit!.location}</span>
                </div>
                {reviews.reviewCount > 0 && (
                  <div className="flex items-center gap-1.5 text-sm mb-2">
                    <MaterialIcon name="star" size={16} className="text-primary" filled />
                    <span className="font-bold text-on-surface">{reviews.averageRating?.toFixed(1)}</span>
                    <span className="text-outline">({reviews.reviewCount.toLocaleString('en-IN')} reviews)</span>
                  </div>
                )}
                {audit!.website && (
                  <div className="flex items-center gap-2 text-primary text-sm">
                    <MaterialIcon name="language" size={16} className="text-primary" />
                    <a href={audit!.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {audit!.website}
                    </a>
                  </div>
                )}
              </div>
              {overallScore > 0 && (
                <div className="flex flex-col items-center">
                  <ScoreRing score={overallScore} />
                  <span className="text-xs text-on-surface-variant mt-1 font-medium">Overall Score</span>
                </div>
              )}
            </div>
          </div>

          {competitorsAhead > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-error-container card-shadow p-8">
              <h2 className="font-heading text-2xl font-bold text-on-surface mb-2">
                {audit!.businessName} is losing customers to {competitorsAhead} competitor{competitorsAhead > 1 ? 's' : ''} on Google.
              </h2>
              <p className="text-on-surface-variant text-sm mb-6">
                Right now, when people search your business in {city}, your competitors show up first.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-error-container rounded-xl p-4 text-center border border-error-container">
                  <div className="font-heading text-2xl font-bold text-error">{competitorsAhead}</div>
                  <div className="text-xs text-on-surface-variant mt-1">Competitors ranking higher</div>
                </div>
                <div className="bg-primary-fixed rounded-xl p-4 text-center border border-primary-fixed-dim">
                  <div className="font-heading text-2xl font-bold text-primary">{issuesCount}</div>
                  <div className="text-xs text-on-surface-variant mt-1">Issues hurting your ranking</div>
                </div>
                <div className="bg-surface-container rounded-xl p-4 text-center border border-outline-variant">
                  <div className="font-heading text-2xl font-bold text-on-surface">{Math.round(profileCompletionPct)}%</div>
                  <div className="text-xs text-on-surface-variant mt-1">Profile complete</div>
                </div>
              </div>
            </div>
          )}

          {localCompetitors.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Other businesses in your area" icon="emoji_events" />
              <div className="overflow-x-auto -mx-2">
                <table className="w-full text-sm min-w-90">
                  <thead>
                    <tr className="text-left text-xs text-outline uppercase tracking-wide">
                      <th className="px-2 py-2 font-medium">Business</th>
                      <th className="px-2 py-2 font-medium">Rating</th>
                      <th className="px-2 py-2 font-medium">Reviews</th>
                    </tr>
                  </thead>
                  <tbody>
                    {localCompetitors.slice(0, 3).map((c, i) => (
                      <tr key={i} className="border-t border-outline-variant">
                        <td className="px-2 py-3 font-medium text-on-surface">{c.name}</td>
                        <td className="px-2 py-3 text-primary">{c.rating != null ? `★ ${c.rating.toFixed(1)}` : '—'}</td>
                        <td className="px-2 py-3 text-secondary">{c.reviewCount ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {issueLines.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title={`Why ${audit!.businessName} isn't ranking`} icon="warning" />
              <ul className="space-y-3">
                {issueLines.map((line, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-on-surface">
                    <MaterialIcon name="cancel" size={16} className="text-error mt-0.5 shrink-0" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Object.keys(profile).length > 0 && (
            <div>
              <SectionHeader title="Profile Score Breakdown" icon="shield" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { label: 'SEO Score', value: profile.seoScore ?? 0, icon: 'trending_up' },
                  { label: 'Review Score', value: profile.reviewScore ?? 0, icon: 'star' },
                  { label: 'Profile Complete', value: profile.profileCompletionScore ?? 0, icon: 'check_circle' },
                  { label: 'Rating Score', value: profile.ratingScore ?? 0, icon: 'star' },
                  { label: 'Content Score', value: profile.contentScore ?? 0, icon: 'apartment' },
                ]
                  .filter((s) => s.value > 0)
                  .map((s) => (
                    <ScoreCard key={s.label} title={s.label} score={s.value} icon={s.icon} />
                  ))}
              </div>
            </div>
          )}

          {reviews.reviewCount > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Review Analytics" icon="star" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="font-heading text-3xl font-bold text-on-surface">{reviews.reviewCount}</div>
                  <div className="text-xs text-on-surface-variant mt-1">Total Reviews</div>
                </div>
                <div className="text-center">
                  <div className="font-heading text-3xl font-bold text-primary">{reviews.averageRating?.toFixed(1) ?? '—'}</div>
                  <div className="text-xs text-on-surface-variant mt-1">Avg Rating</div>
                </div>
                <div className="text-center">
                  <div className="font-heading text-3xl font-bold text-secondary">{reviews.positivePercent ?? 0}%</div>
                  <div className="text-xs text-on-surface-variant mt-1">Positive</div>
                </div>
                <div className="text-center">
                  <div className="font-heading text-3xl font-bold text-on-surface">{reviews.responseRate ?? '—'}</div>
                  <div className="text-xs text-on-surface-variant mt-1">Response Rate</div>
                </div>
              </div>
            </div>
          )}

          {checklist.length > 0 && (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
              <SectionHeader title="Profile Completion" icon="check_circle" />
              <div className="mb-5">
                <div className="flex items-center justify-between text-xs text-on-surface-variant mb-1.5">
                  <span>{Math.round(profileCompletionPct)}% filled in</span>
                </div>
                <div className="h-2 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, Math.round(profileCompletionPct))}%` }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {knownChecklist.map((c, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-sm">
                    <ChecklistIcon status={c.status} />
                    <span className={c.status === 'Missing' ? 'text-on-surface font-medium' : 'text-on-surface-variant'}>
                      {c.field}
                    </span>
                  </div>
                ))}
              </div>
              {unknownChecklistCount > 0 && (
                <div className="mt-4 pt-4 border-t border-outline-variant flex items-center gap-2 text-xs text-outline">
                  <MaterialIcon name="help" size={16} className="shrink-0" />
                  {unknownChecklistCount} more item{unknownChecklistCount > 1 ? 's' : ''} verified once you connect your Google account
                </div>
              )}
            </div>
          )}

          {priorityFixes.length > 0 && (
            <div>
              <SectionHeader title="Priority Action Items" icon="warning" />
              <div className="space-y-3">
                {priorityFixes.map((fix: any, idx: number) => (
                  <div key={idx} className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 bg-primary-fixed rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">{idx + 1}</span>
                      </div>
                      <div>
                        <h3 className="font-heading font-semibold text-on-surface mb-1">{fix.title}</h3>
                        <p className="text-sm text-on-surface-variant">{fix.reason}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(strengths.length > 0 || weaknesses.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {strengths.length > 0 && (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
                  <SectionHeader title="Strengths" icon="thumb_up" />
                  <ul className="space-y-3">
                    {strengths.map((s: any, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <MaterialIcon name="check_circle" size={16} className="text-secondary mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-on-surface">{s.title}</div>
                          {s.evidence && <div className="text-xs text-on-surface-variant">{s.evidence}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {weaknesses.length > 0 && (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
                  <SectionHeader title="Areas to Improve" icon="thumb_down" />
                  <ul className="space-y-3">
                    {weaknesses.map((w: any, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <MaterialIcon name="warning" size={16} className="text-primary-container mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-on-surface">{w.title}</div>
                          {w.evidence && <div className="text-xs text-on-surface-variant">{w.evidence}</div>}
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

