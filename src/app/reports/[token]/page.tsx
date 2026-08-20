'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

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
  const r = size === 'lg' ? 54 : 36;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 75 ? '#0a8a3e' : score >= 50 ? '#fab219' : '#ba1a1a';
  const dim = size === 'lg' ? 130 : 88;
  const font = size === 'lg' ? 'text-3xl' : 'text-xl';

  return (
    <div className="relative flex items-center justify-center" style={{ width: dim, height: dim }}>
      <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="-rotate-90">
        <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke="#e0e3e5" strokeWidth="8" />
        <circle
          cx={dim / 2}
          cy={dim / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold text-on-surface ${font}`}>{score}</span>
        <span className="text-[10px] text-outline uppercase tracking-wide">/ 100</span>
      </div>
    </div>
  );
}

function ScoreCard({ title, score, icon }: { title: string; score: number; icon: string }) {
  const color = score >= 75 ? 'text-secondary' : score >= 50 ? 'text-primary' : 'text-error';
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-5 text-center card-shadow">
      <div className="w-10 h-10 bg-surface rounded-xl flex items-center justify-center mx-auto mb-3">
        <MaterialIcon name={icon} size={20} className="text-on-surface-variant" />
      </div>
      <div className={`text-2xl font-bold mb-0.5 ${color}`}>{score}</div>
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

const IMPACT_COLORS: Record<string, string> = {
  High: 'bg-error-container text-on-error-container border-error-container',
  Medium: 'bg-primary-fixed text-primary border-primary-fixed-dim',
  Low: 'bg-primary-fixed text-primary border-primary-fixed-dim',
};

export default function PublicReportPage() {
  const params = useParams();
  const token = params.token as string;

  const [audit, setAudit] = useState<AuditPublic | null>(null);
  const [expiresAt, setExpires] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/reports/${token}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) throw new Error(json.error);
        setAudit(json.audit);
        setExpires(json.expiresAt);
      })
      .catch((err) => setError(friendlyClientMessage(err)))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <MaterialIcon name="progress_activity" size={40} className="animate-spin text-primary mx-auto mb-3" />
          <p className="text-sm text-on-surface-variant">Loading your report…</p>
        </div>
      </div>
    );
  }

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

  if (!audit) return null;

  const d = audit.auditData || {};
  const profile = d.profileScore || {};
  const reviews = d.reviewAnalysis || {};
  const priorityFixes = d.priorityFixes || [];
  const strengths = d.strengths || [];
  const weaknesses = d.weaknesses || [];
  const plan30 = d.thirtyDayPlan || [];
  const overallScore = audit.overallScore ?? profile.overallScore ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-surface-container-lowest border-b border-outline-variant px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
            <MaterialIcon name="bolt" size={16} className="text-on-primary" />
          </div>
          <span className="font-heading font-bold text-on-surface">GrowwMatics AI</span>
          <span className="text-outline mx-2">·</span>
          <span className="text-sm text-on-surface-variant">Business Profile Audit Report</span>
        </div>
        {expiresAt && (
          <span className="text-xs text-outline flex items-center gap-1">
            <MaterialIcon name="schedule" size={12} />
            Expires {new Date(expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <div className="flex-1">
              <h1 className="font-heading text-3xl font-bold text-on-surface mb-1">{audit.businessName}</h1>
              <div className="flex items-center gap-2 text-on-surface-variant text-sm mb-3">
                <MaterialIcon name="location_on" size={16} />
                <span>{audit.location}</span>
              </div>
              {audit.website && (
                <div className="flex items-center gap-2 text-primary text-sm">
                  <MaterialIcon name="language" size={16} />
                  <a href={audit.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {audit.website}
                  </a>
                </div>
              )}
              <div className="mt-4 text-xs text-outline">
                Report generated {new Date(audit.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            </div>

            {overallScore > 0 && (
              <div className="flex flex-col items-center">
                <ScoreRing score={overallScore} />
                <span className="text-xs text-on-surface-variant mt-1 font-medium">Overall Score</span>
              </div>
            )}
          </div>
        </div>

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
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="text-center">
                <div className="text-3xl font-bold text-on-surface">{reviews.reviewCount}</div>
                <div className="text-xs text-on-surface-variant mt-1">Total Reviews</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-primary-fixed-dim">{reviews.averageRating?.toFixed(1) ?? '—'}</div>
                <div className="text-xs text-on-surface-variant mt-1">Avg Rating</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-secondary">{reviews.positivePercent ?? 0}%</div>
                <div className="text-xs text-on-surface-variant mt-1">Positive</div>
              </div>
              <div className="text-center">
                <div className="text-3xl font-bold text-on-surface">{reviews.responseRate ?? '—'}</div>
                <div className="text-xs text-on-surface-variant mt-1">Response Rate</div>
              </div>
            </div>

            {reviews.mostCommonPraises?.length > 0 && (
              <div>
                <div className="text-sm font-semibold text-on-surface mb-2">What customers love</div>
                <div className="flex flex-wrap gap-2">
                  {reviews.mostCommonPraises.map((p: string) => (
                    <span
                      key={p}
                      className="px-3 py-1 bg-secondary-container/40 text-on-secondary-container text-xs font-medium rounded-full border border-secondary-fixed"
                    >
                      {p}
                    </span>
                  ))}
                </div>
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="w-7 h-7 bg-primary-fixed rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-primary">{idx + 1}</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-on-surface mb-1">{fix.title}</h3>
                        <p className="text-sm text-on-surface-variant">{fix.reason}</p>
                        {fix.expectedScoreGain && (
                          <span className="inline-block mt-2 text-xs font-bold text-primary bg-primary-fixed px-2 py-0.5 rounded-md">
                            {fix.expectedScoreGain}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={`flex-shrink-0 px-2 py-0.5 text-xs font-bold rounded-md border ${IMPACT_COLORS[fix.impact] ?? IMPACT_COLORS.Low}`}
                    >
                      {fix.impact} impact
                    </span>
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
                <SectionHeader title="Strengths" icon="check_circle" />
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
                <SectionHeader title="Areas to Improve" icon="warning" />
                <ul className="space-y-3">
                  {weaknesses.map((w: any, i: number) => (
                    <li key={i} className="flex items-start gap-2">
                      <MaterialIcon name="warning" size={16} className="text-primary-fixed-dim mt-0.5 flex-shrink-0" />
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

        {plan30.length > 0 && (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
            <SectionHeader title="30-Day Action Plan" icon="flag" />
            <div className="space-y-4">
              {plan30.map((week: any, idx: number) => (
                <div key={idx} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-8 h-8 bg-primary text-on-primary rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                      {idx + 1}
                    </div>
                    {idx < plan30.length - 1 && <div className="w-0.5 flex-1 bg-surface-container-high mt-1" />}
                  </div>
                  <div className="pb-4 flex-1">
                    <div className="font-semibold text-on-surface mb-1">{week.week}</div>
                    {week.expectedOutcome && (
                      <div className="text-xs text-primary font-medium mb-2">{week.expectedOutcome}</div>
                    )}
                    <ul className="space-y-1">
                      {week.tasks?.map((task: string, ti: number) => (
                        <li key={ti} className="flex items-center gap-2 text-sm text-on-surface-variant">
                          <MaterialIcon name="chevron_right" size={12} className="text-outline flex-shrink-0" />
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

        <div className="bg-primary rounded-xl p-8 text-center text-on-primary">
          <h2 className="font-heading text-2xl font-bold mb-2">Ready to boost your Google ranking?</h2>
          <p className="text-primary-fixed-dim text-sm mb-6">
            GrowwMatics AI automates reviews, content, and GBP optimisation — so you show up first.
          </p>
          <a
            href="/"
            className="inline-block bg-surface-container-lowest text-primary font-bold px-6 py-3 rounded-lg hover:bg-primary-fixed transition-colors"
          >
            Get Started Free
          </a>
        </div>
      </div>
    </div>
  );
}
