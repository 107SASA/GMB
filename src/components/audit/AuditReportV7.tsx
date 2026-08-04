import React from 'react';
import { IAudit, IAuditData, IChecklistItem, IPriorityFix, IStrengthWeakness, IDataQuality, IBusinessIntelligence } from '@/models/Audit';
import { Download, Search, CheckCircle2, AlertCircle, TrendingUp, Zap, Target, Star, FileText, XCircle, Clock, ShieldCheck, BarChart3, Info, RefreshCw, MessageSquare } from 'lucide-react';

const EvidenceBadge = ({ text }: { text?: string }) => {
  if (!text) return null;
  return (
    <div className="group relative inline-flex items-center justify-center ml-2 align-middle">
      <div className="w-5 h-5 rounded-full bg-surface-container text-outline flex items-center justify-center cursor-help border border-outline-variant hover:bg-primary-fixed hover:text-primary hover:border-primary-fixed transition-colors">
        <span className="text-[10px] font-bold">?</span>
      </div>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[250px] p-2.5 bg-primary text-white text-xs rounded-lg card-shadow opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 text-left font-normal leading-relaxed">
        <div className="font-bold text-outline mb-1 text-[10px] uppercase tracking-wider">Data Source</div>
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-primary" />
      </div>
    </div>
  );
};

const QualityBadge = ({ status }: { status: string }) => {
  if (status === 'Complete') return <span className="px-2 py-1 bg-secondary-container text-on-secondary-container text-[10px] font-bold uppercase rounded-md tracking-wider">Complete</span>;
  if (status === 'Partial') return <span className="px-2 py-1 bg-primary-fixed text-primary text-[10px] font-bold uppercase rounded-md tracking-wider">Partial</span>;
  return <span className="px-2 py-1 bg-error-container text-on-error-container text-[10px] font-bold uppercase rounded-md tracking-wider">Unavailable</span>;
};

export default function AuditReportV7({
  audit,
  onDownload,
  onResync,
  isSyncing = false,
}: {
  audit: IAudit;
  onDownload: () => void;
  onResync?: () => void;
  isSyncing?: boolean;
}) {
  const data = audit.auditData as IAuditData;

  if (!data) return <div className="p-8 text-center text-on-surface-variant">No data available</div>;

  const hasReviews = (data.reviewAnalysis?.reviewCount || 0) > 0;
  const dq = data.auditConfidence?.dataQuality || {} as IDataQuality;
  const bi = data.businessIntelligence || {} as IBusinessIntelligence;

  const meta = (audit as any).metadata || {};
  const reviewCount: number = meta.reviewsActualCount ?? data.reviewAnalysis?.reviewCount ?? 0;
  const syncedAt: string | undefined = meta.reviewsSyncedAt;

  function formatSyncAge(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  return (
    <div className="max-w-6xl mx-auto pb-20 space-y-8 font-sans">

      {/* Header Bar */}
      <div className="bg-primary text-white rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 card-shadow">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-heading font-black">{audit.businessName}</h1>
            <span className="px-3 py-1 bg-white/20 text-primary-fixed text-xs font-bold uppercase tracking-wider rounded-full border border-white/30">
              {data.businessTier || 'Unknown Tier'}
            </span>
          </div>
          <p className="text-outline font-medium">Enterprise Business Intelligence Audit</p>
        </div>
        <button
          onClick={onDownload}
          className="bg-primary-container hover:bg-primary text-white px-6 py-3 rounded-xl font-bold transition-colors flex items-center gap-2 w-max"
        >
          <Download className="w-5 h-5" /> Download Report
        </button>
      </div>

      {/* Review sync info banner */}
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 bg-surface border border-outline-variant rounded-xl text-sm">
        <div className="flex items-center gap-2.5 text-on-surface-variant">
          <MessageSquare className="w-4 h-4 text-outline shrink-0" />
          {reviewCount > 0 ? (
            <span>
              Based on <span className="font-bold text-on-surface">{reviewCount} real Google reviews</span>
              {syncedAt && (
                <span className="text-outline"> · synced {formatSyncAge(syncedAt)}</span>
              )}
            </span>
          ) : (
            <span className="text-outline">No reviews synced yet — click Re-sync to fetch live data.</span>
          )}
        </div>
        {onResync && (
          <button
            onClick={onResync}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-surface-container-lowest border border-outline-variant rounded-lg text-xs font-bold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing…' : 'Re-sync Reviews'}
          </button>
        )}
      </div>

      {/* Hero Data Quality & Scores Section */}
      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Audit Confidence */}
        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm flex flex-col col-span-1">
          <div className="flex items-center gap-3 mb-6">
            <ShieldCheck className="w-6 h-6 text-on-surface" />
            <h2 className="text-lg font-bold text-on-surface">Audit Confidence</h2>
          </div>
          
          <div className="flex items-end gap-2 mb-6">
            <div className="text-5xl font-black text-on-surface">{data.auditConfidence?.confidenceScore || 0}%</div>
            <div className="text-sm font-medium text-on-surface-variant mb-1">Data Reliability</div>
          </div>

          <div className="space-y-3 flex-1">
            <div className="flex justify-between items-center text-sm">
              <span className="text-on-surface-variant font-medium">Profile Data</span>
              <QualityBadge status={dq.profileData || 'Unavailable'} />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-on-surface-variant font-medium">Competitor Discovery</span>
              <QualityBadge status={dq.competitorDiscovery || 'Unavailable'} />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-on-surface-variant font-medium">Keyword Tracking</span>
              <QualityBadge status={dq.keywordDiscovery || 'Unavailable'} />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-on-surface-variant font-medium">Review Metrics</span>
              <QualityBadge status={dq.reviewAnalysis || 'Unavailable'} />
            </div>
          </div>
        </div>

        {/* Business Intelligence Summary */}
        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm lg:col-span-2">
          <div className="flex items-center gap-3 mb-6">
            <BarChart3 className="w-6 h-6 text-on-surface" />
            <h2 className="text-lg font-bold text-on-surface">Business Intelligence Summary</h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold text-outline uppercase tracking-wider mb-1">Competitive Position</div>
                <div className="text-on-surface font-medium">{bi.competitivePosition || 'Unknown'}</div>
              </div>
              <div>
                <div className="text-xs font-bold text-outline uppercase tracking-wider mb-1">Market Saturation</div>
                <div className="text-on-surface font-medium">{bi.marketSaturation || 'Unknown'}</div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold text-outline uppercase tracking-wider mb-1">Review Gap</div>
                <div className="text-on-surface font-medium">
                  {bi.reviewGap > 0 ? `Needs ${bi.reviewGap} more reviews to match local average.` : 'Outperforming local average.'}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-outline uppercase tracking-wider mb-1">Growth Potential</div>
                <div className="text-on-surface font-medium">{bi.growthPotential || 'Unknown'}</div>
              </div>
            </div>
          </div>
          
          <div className="mt-6 p-4 bg-surface rounded-xl border border-outline-variant text-sm text-on-surface leading-relaxed">
            <span className="font-bold mr-2 text-on-surface">Visibility Note:</span> 
            {bi.visibilityGap || 'Visibility gap analysis unavailable.'}
          </div>
        </div>

      </div>

      {/* Competitor Analysis Table */}
      <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-on-surface flex items-center gap-3">
            <Zap className="w-6 h-6 text-outline" /> Tier-Matched Competitors
            <EvidenceBadge text={data.evidence?.competitors} />
          </h2>
        </div>
        
        {data.competitors?.length === 0 ? (
          <div className="text-center p-12 bg-surface border border-dashed border-outline-variant rounded-xl">
            <Info className="w-8 h-8 text-outline mx-auto mb-3" />
            <h3 className="text-lg font-bold text-on-surface">No Comparable Competitors Found</h3>
            <p className="text-on-surface-variant max-w-md mx-auto mt-2 text-sm">We could not identify sufficient businesses in your exact Tier, Category, and Area to form a reliable competitive baseline.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-outline-variant">
                  <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Business Name</th>
                  <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Metrics</th>
                  <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Gap Score</th>
                  <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Target Disadvantages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(data.competitors || []).map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-surface">
                    <td className="py-4 pr-4">
                      <div className="font-bold text-on-surface mb-1">{c.name}</div>
                      <div className="text-xs text-on-surface-variant">{c.category}</div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="text-sm font-medium flex items-center gap-1 mb-1">
                        {c.rating} <Star className="w-3.5 h-3.5 text-secondary-fixed fill-secondary-fixed" /> 
                        <span className="text-outline font-normal ml-1">({c.reviewCount})</span>
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="text-lg font-black text-on-surface">{c.gapAnalysis?.gapScore || 0}/100</div>
                    </td>
                    <td className="py-4">
                      {c.gapAnalysis?.missingAdvantages?.length > 0 ? (
                        <ul className="space-y-1">
                          {c.gapAnalysis.missingAdvantages.map((adv: string, j: number) => (
                            <li key={j} className="text-xs font-medium text-on-error-container bg-error-container px-2 py-1 rounded inline-block mr-2 mb-1">
                              {adv}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs font-bold text-secondary bg-secondary-container/40 px-2 py-1 rounded inline-block">No clear advantage over you</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Analytics Grid */}
      <div className="bg-primary rounded-2xl p-8 text-white card-shadow">
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-2">
          Review Analytics
          <EvidenceBadge text={data.evidence?.reviewAnalysis} />
        </h2>
        
        {!hasReviews ? (
          <div className="text-center p-12 bg-surface-container-lowest/5 border border-dashed border-white/10 rounded-xl">
            <Star className="w-8 h-8 text-on-surface-variant mx-auto mb-3" />
            <h3 className="text-lg font-bold text-white">No Review Data Available</h3>
            <p className="text-outline max-w-md mx-auto mt-2 text-sm">We could not detect any reviews for this business. Starting a review collection campaign is your highest priority.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8 border-b border-white/10 pb-8">
              <div>
                <div className="text-sm text-outline font-medium mb-1">Total Reviews</div>
                <div className="text-4xl font-black">{data.reviewAnalysis?.reviewCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-outline font-medium mb-1">Avg Rating</div>
                <div className="text-4xl font-black flex items-center gap-2">
                  {data.reviewAnalysis?.averageRating || 0}
                  <Star className="w-6 h-6 text-secondary-fixed fill-secondary-fixed" />
                </div>
              </div>
              <div>
                <div className="text-sm text-outline font-medium mb-1">Reviews / Week</div>
                <div className="text-4xl font-black text-secondary-fixed">{data.reviewAnalysis?.reviewsPerWeek || 0}</div>
              </div>
              <div>
                <div className="text-sm text-outline font-medium mb-1">Response Rate</div>
                <div className="text-4xl font-black text-primary-fixed">{data.reviewAnalysis?.responseRate || '0%'}</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-bold text-outline uppercase tracking-wide mb-4">Sentiment Breakdown</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-20 text-sm font-medium">Positive</div>
                    <div className="flex-1 h-3 bg-surface-container-lowest/10 rounded-full overflow-hidden">
                      <div className="h-full bg-secondary rounded-full" style={{ width: `${data.reviewAnalysis?.positivePercent || 0}%` }} />
                    </div>
                    <div className="w-12 text-right text-sm font-bold">{data.reviewAnalysis?.positivePercent || 0}%</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 text-sm font-medium">Neutral</div>
                    <div className="flex-1 h-3 bg-surface-container-lowest/10 rounded-full overflow-hidden">
                      <div className="h-full bg-outline rounded-full" style={{ width: `${data.reviewAnalysis?.neutralPercent || 0}%` }} />
                    </div>
                    <div className="w-12 text-right text-sm font-bold">{data.reviewAnalysis?.neutralPercent || 0}%</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 text-sm font-medium">Negative</div>
                    <div className="flex-1 h-3 bg-surface-container-lowest/10 rounded-full overflow-hidden">
                      <div className="h-full bg-error rounded-full" style={{ width: `${data.reviewAnalysis?.negativePercent || 0}%` }} />
                    </div>
                    <div className="w-12 text-right text-sm font-bold">{data.reviewAnalysis?.negativePercent || 0}%</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-bold text-secondary-fixed uppercase tracking-wide mb-3">Top Praises</h3>
                  <ul className="space-y-2">
                    {(data.reviewAnalysis?.mostCommonPraises || []).map((p: string, i: number) => (
                      <li key={i} className="text-sm text-outline flex gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-secondary shrink-0"/>{p}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-error uppercase tracking-wide mb-3">Top Complaints</h3>
                  <ul className="space-y-2">
                    {(data.reviewAnalysis?.mostCommonComplaints || []).map((c: string, i: number) => (
                      <li key={i} className="text-sm text-outline flex gap-2"><XCircle className="w-4 h-4 mt-0.5 text-error shrink-0"/>{c}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Strengths & Weaknesses (Evidence Based) */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-secondary-container/40 rounded-2xl p-8 border border-secondary-fixed">
          <h2 className="text-xl font-bold text-on-secondary-container mb-6 flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-secondary" /> Validated Strengths
          </h2>
          <div className="space-y-5">
            {(data.strengths || []).map((s: IStrengthWeakness, i: number) => (
              <div key={i} className="bg-surface-container-lowest p-4 rounded-xl border border-secondary-fixed shadow-sm">
                <h3 className="font-bold text-on-secondary-container mb-2">{s.title}</h3>
                <div className="text-sm text-on-surface-variant mb-2">{s.observation}</div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex gap-2"><span className="font-bold text-outline">Evidence:</span> <span className="font-medium text-on-surface">{s.evidence}</span></div>
                  <div className="flex gap-2"><span className="font-bold text-outline">Impact:</span> <span className="font-medium text-secondary">{s.impact}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="bg-error-container rounded-2xl p-8 border border-error-container">
          <h2 className="text-xl font-bold text-on-error-container mb-6 flex items-center gap-2">
            <AlertCircle className="w-6 h-6 text-on-error-container" /> Validated Weaknesses
          </h2>
          <div className="space-y-5">
            {(data.weaknesses || []).map((w: IStrengthWeakness, i: number) => (
              <div key={i} className="bg-surface-container-lowest p-4 rounded-xl border border-error-container shadow-sm">
                <h3 className="font-bold text-on-error-container mb-2">{w.title}</h3>
                <div className="text-sm text-on-surface-variant mb-2">{w.observation}</div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex gap-2"><span className="font-bold text-outline">Evidence:</span> <span className="font-medium text-on-surface">{w.evidence}</span></div>
                  <div className="flex gap-2"><span className="font-bold text-outline">Risk:</span> <span className="font-medium text-on-error-container">{w.risk}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Priority Fixes */}
      <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm border-l-4 border-l-error">
        <h2 className="text-2xl font-bold text-on-surface mb-6 flex items-center gap-3">
          <Zap className="w-6 h-6 text-error" /> Priority Fixes
        </h2>
        <div className="grid gap-4">
          {(data.priorityFixes || []).map((fix: IPriorityFix, i: number) => (
            <div key={i} className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-surface rounded-xl border border-outline-variant">
              <div className="flex-1">
                <h3 className="font-bold text-on-surface text-lg mb-1">{fix.title}</h3>
                <p className="text-sm text-on-surface-variant">{fix.reason}</p>
              </div>
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Impact</div>
                  <div className={`text-sm font-bold ${fix.impact === 'High' ? 'text-secondary' : 'text-primary'}`}>{fix.impact}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Effort</div>
                  <div className={`text-sm font-bold ${fix.effort === 'High' ? 'text-on-error-container' : 'text-primary'}`}>{fix.effort}</div>
                </div>
                <div className="text-center bg-primary-fixed px-3 py-1.5 rounded-lg border border-primary-fixed-dim">
                  <div className="text-[10px] font-bold text-primary-fixed uppercase tracking-wider mb-0.5">Expected Gain</div>
                  <div className={`text-sm font-black text-primary`}>{fix.expectedScoreGain || fix.revenuePotential}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Plans */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm">
          <h2 className="text-xl font-bold text-on-surface mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" /> 30-Day Action Plan
          </h2>
          <div className="space-y-6">
            {(data.thirtyDayPlan || []).map((week: any, i: number) => (
              <div key={i}>
                <h3 className="font-bold text-primary text-sm uppercase tracking-wide mb-2">{week.week}</h3>
                <p className="text-xs font-bold text-outline mb-3">{week.expectedOutcome}</p>
                <ul className="space-y-2">
                  {(week.tasks || []).map((t: string, j: number) => (
                    <li key={j} className="text-sm text-on-surface-variant flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 text-outline shrink-0" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm">
          <h2 className="text-xl font-bold text-on-surface mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-primary" /> 90-Day Roadmap
          </h2>
          <div className="space-y-6">
            {(data.ninetyDayPlan || []).map((month: any, i: number) => (
              <div key={i}>
                <h3 className="font-bold text-primary text-sm uppercase tracking-wide mb-2">{month.month}</h3>
                <div className="flex gap-2 mb-3 flex-wrap">
                  {(month.focusAreas || []).map((fa: string, j: number) => (
                    <span key={j} className="text-[10px] font-bold px-2 py-0.5 bg-surface-container text-on-surface-variant rounded uppercase tracking-wider">{fa}</span>
                  ))}
                </div>
                <ul className="space-y-2">
                  {(month.tasks || []).map((t: string, j: number) => (
                    <li key={j} className="text-sm text-on-surface-variant flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-outline-variant mt-1.5 shrink-0" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}
