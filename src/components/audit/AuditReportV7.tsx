import React from 'react';
import { IAudit, IAuditData, IChecklistItem, IPriorityFix, IStrengthWeakness, IDataQuality, IBusinessIntelligence } from '@/models/Audit';
import { Download, Search, CheckCircle2, AlertCircle, TrendingUp, Zap, Target, Star, FileText, XCircle, Clock, ShieldCheck, BarChart3, Info, RefreshCw, MessageSquare } from 'lucide-react';

const EvidenceBadge = ({ text }: { text?: string }) => {
  if (!text) return null;
  return (
    <div className="group relative inline-flex items-center justify-center ml-2 align-middle">
      <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center cursor-help border border-slate-200 hover:bg-blue-50 hover:text-blue-500 hover:border-blue-200 transition-colors">
        <span className="text-[10px] font-bold">?</span>
      </div>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[250px] p-2.5 bg-slate-900 text-white text-xs rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10 text-left font-normal leading-relaxed">
        <div className="font-bold text-slate-400 mb-1 text-[10px] uppercase tracking-wider">Data Source</div>
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-slate-900" />
      </div>
    </div>
  );
};

const QualityBadge = ({ status }: { status: string }) => {
  if (status === 'Complete') return <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase rounded-md tracking-wider">Complete</span>;
  if (status === 'Partial') return <span className="px-2 py-1 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase rounded-md tracking-wider">Partial</span>;
  return <span className="px-2 py-1 bg-rose-100 text-rose-700 text-[10px] font-bold uppercase rounded-md tracking-wider">Unavailable</span>;
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

  if (!data) return <div className="p-8 text-center text-slate-500">No data available</div>;

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
      <div className="bg-slate-900 text-white rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-black">{audit.businessName}</h1>
            <span className="px-3 py-1 bg-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-wider rounded-full border border-blue-500/30">
              {data.businessTier || 'Unknown Tier'}
            </span>
          </div>
          <p className="text-slate-400 font-medium">Enterprise Business Intelligence Audit</p>
        </div>
        <button
          onClick={onDownload}
          className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold transition-colors flex items-center gap-2 w-max"
        >
          <Download className="w-5 h-5" /> Download Report
        </button>
      </div>

      {/* Review sync info banner */}
      <div className="flex items-center justify-between gap-4 px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm">
        <div className="flex items-center gap-2.5 text-slate-600">
          <MessageSquare className="w-4 h-4 text-slate-400 shrink-0" />
          {reviewCount > 0 ? (
            <span>
              Based on <span className="font-bold text-slate-900">{reviewCount} real Google reviews</span>
              {syncedAt && (
                <span className="text-slate-400"> · synced {formatSyncAge(syncedAt)}</span>
              )}
            </span>
          ) : (
            <span className="text-slate-400">No reviews synced yet — click Re-sync to fetch live data.</span>
          )}
        </div>
        {onResync && (
          <button
            onClick={onResync}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Syncing…' : 'Re-sync Reviews'}
          </button>
        )}
      </div>

      {/* Hero Data Quality & Scores Section */}
      <div className="grid lg:grid-cols-3 gap-6">
        
        {/* Audit Confidence */}
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm flex flex-col col-span-1">
          <div className="flex items-center gap-3 mb-6">
            <ShieldCheck className="w-6 h-6 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-900">Audit Confidence</h2>
          </div>
          
          <div className="flex items-end gap-2 mb-6">
            <div className="text-5xl font-black text-slate-900">{data.auditConfidence?.confidenceScore || 0}%</div>
            <div className="text-sm font-medium text-slate-500 mb-1">Data Reliability</div>
          </div>

          <div className="space-y-3 flex-1">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600 font-medium">Profile Data</span>
              <QualityBadge status={dq.profileData || 'Unavailable'} />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600 font-medium">Competitor Discovery</span>
              <QualityBadge status={dq.competitorDiscovery || 'Unavailable'} />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600 font-medium">Keyword Tracking</span>
              <QualityBadge status={dq.keywordDiscovery || 'Unavailable'} />
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-600 font-medium">Review Metrics</span>
              <QualityBadge status={dq.reviewAnalysis || 'Unavailable'} />
            </div>
          </div>
        </div>

        {/* Business Intelligence Summary */}
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-3 mb-6">
            <BarChart3 className="w-6 h-6 text-slate-700" />
            <h2 className="text-lg font-bold text-slate-900">Business Intelligence Summary</h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Competitive Position</div>
                <div className="text-slate-900 font-medium">{bi.competitivePosition || 'Unknown'}</div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Market Saturation</div>
                <div className="text-slate-900 font-medium">{bi.marketSaturation || 'Unknown'}</div>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Review Gap</div>
                <div className="text-slate-900 font-medium">
                  {bi.reviewGap > 0 ? `Needs ${bi.reviewGap} more reviews to match local average.` : 'Outperforming local average.'}
                </div>
              </div>
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Growth Potential</div>
                <div className="text-slate-900 font-medium">{bi.growthPotential || 'Unknown'}</div>
              </div>
            </div>
          </div>
          
          <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-700 leading-relaxed">
            <span className="font-bold mr-2 text-slate-900">Visibility Note:</span> 
            {bi.visibilityGap || 'Visibility gap analysis unavailable.'}
          </div>
        </div>

      </div>

      {/* Competitor Analysis Table */}
      <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
            <Zap className="w-6 h-6 text-slate-400" /> Tier-Matched Competitors
            <EvidenceBadge text={data.evidence?.competitors} />
          </h2>
        </div>
        
        {data.competitors?.length === 0 ? (
          <div className="text-center p-12 bg-slate-50 border border-dashed border-slate-200 rounded-xl">
            <Info className="w-8 h-8 text-slate-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-700">No Comparable Competitors Found</h3>
            <p className="text-slate-500 max-w-md mx-auto mt-2 text-sm">We could not identify sufficient businesses in your exact Tier, Category, and Area to form a reliable competitive baseline.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Business Name</th>
                  <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Metrics</th>
                  <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Gap Score</th>
                  <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Target Disadvantages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data.competitors || []).map((c: any, i: number) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="py-4 pr-4">
                      <div className="font-bold text-slate-900 mb-1">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.category}</div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="text-sm font-medium flex items-center gap-1 mb-1">
                        {c.rating} <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" /> 
                        <span className="text-slate-400 font-normal ml-1">({c.reviewCount})</span>
                      </div>
                    </td>
                    <td className="py-4 pr-4">
                      <div className="text-lg font-black text-slate-700">{c.gapAnalysis?.gapScore || 0}/100</div>
                    </td>
                    <td className="py-4">
                      {c.gapAnalysis?.missingAdvantages?.length > 0 ? (
                        <ul className="space-y-1">
                          {c.gapAnalysis.missingAdvantages.map((adv: string, j: number) => (
                            <li key={j} className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-1 rounded inline-block mr-2 mb-1">
                              {adv}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded inline-block">No clear advantage over you</span>
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
      <div className="bg-slate-900 rounded-2xl p-8 text-white shadow-xl">
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-2">
          Review Analytics
          <EvidenceBadge text={data.evidence?.reviewAnalysis} />
        </h2>
        
        {!hasReviews ? (
          <div className="text-center p-12 bg-white/5 border border-dashed border-white/10 rounded-xl">
            <Star className="w-8 h-8 text-slate-500 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-white">No Review Data Available</h3>
            <p className="text-slate-400 max-w-md mx-auto mt-2 text-sm">We could not detect any reviews for this business. Starting a review collection campaign is your highest priority.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8 border-b border-white/10 pb-8">
              <div>
                <div className="text-sm text-slate-400 font-medium mb-1">Total Reviews</div>
                <div className="text-4xl font-black">{data.reviewAnalysis?.reviewCount || 0}</div>
              </div>
              <div>
                <div className="text-sm text-slate-400 font-medium mb-1">Avg Rating</div>
                <div className="text-4xl font-black flex items-center gap-2">
                  {data.reviewAnalysis?.averageRating || 0}
                  <Star className="w-6 h-6 text-amber-400 fill-amber-400" />
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400 font-medium mb-1">Reviews / Week</div>
                <div className="text-4xl font-black text-emerald-400">{data.reviewAnalysis?.reviewsPerWeek || 0}</div>
              </div>
              <div>
                <div className="text-sm text-slate-400 font-medium mb-1">Response Rate</div>
                <div className="text-4xl font-black text-blue-400">{data.reviewAnalysis?.responseRate || '0%'}</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wide mb-4">Sentiment Breakdown</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="w-20 text-sm font-medium">Positive</div>
                    <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${data.reviewAnalysis?.positivePercent || 0}%` }} />
                    </div>
                    <div className="w-12 text-right text-sm font-bold">{data.reviewAnalysis?.positivePercent || 0}%</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 text-sm font-medium">Neutral</div>
                    <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${data.reviewAnalysis?.neutralPercent || 0}%` }} />
                    </div>
                    <div className="w-12 text-right text-sm font-bold">{data.reviewAnalysis?.neutralPercent || 0}%</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 text-sm font-medium">Negative</div>
                    <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: `${data.reviewAnalysis?.negativePercent || 0}%` }} />
                    </div>
                    <div className="w-12 text-right text-sm font-bold">{data.reviewAnalysis?.negativePercent || 0}%</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-bold text-emerald-400 uppercase tracking-wide mb-3">Top Praises</h3>
                  <ul className="space-y-2">
                    {(data.reviewAnalysis?.mostCommonPraises || []).map((p: string, i: number) => (
                      <li key={i} className="text-sm text-slate-300 flex gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0"/>{p}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-rose-400 uppercase tracking-wide mb-3">Top Complaints</h3>
                  <ul className="space-y-2">
                    {(data.reviewAnalysis?.mostCommonComplaints || []).map((c: string, i: number) => (
                      <li key={i} className="text-sm text-slate-300 flex gap-2"><XCircle className="w-4 h-4 mt-0.5 text-rose-500 shrink-0"/>{c}</li>
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
        <div className="bg-emerald-50 rounded-2xl p-8 border border-emerald-100">
          <h2 className="text-xl font-bold text-emerald-900 mb-6 flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" /> Validated Strengths
          </h2>
          <div className="space-y-5">
            {(data.strengths || []).map((s: IStrengthWeakness, i: number) => (
              <div key={i} className="bg-white p-4 rounded-xl border border-emerald-100 shadow-sm">
                <h3 className="font-bold text-emerald-800 mb-2">{s.title}</h3>
                <div className="text-sm text-slate-600 mb-2">{s.observation}</div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex gap-2"><span className="font-bold text-slate-400">Evidence:</span> <span className="font-medium text-slate-700">{s.evidence}</span></div>
                  <div className="flex gap-2"><span className="font-bold text-slate-400">Impact:</span> <span className="font-medium text-emerald-600">{s.impact}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="bg-rose-50 rounded-2xl p-8 border border-rose-100">
          <h2 className="text-xl font-bold text-rose-900 mb-6 flex items-center gap-2">
            <AlertCircle className="w-6 h-6 text-rose-600" /> Validated Weaknesses
          </h2>
          <div className="space-y-5">
            {(data.weaknesses || []).map((w: IStrengthWeakness, i: number) => (
              <div key={i} className="bg-white p-4 rounded-xl border border-rose-100 shadow-sm">
                <h3 className="font-bold text-rose-800 mb-2">{w.title}</h3>
                <div className="text-sm text-slate-600 mb-2">{w.observation}</div>
                <div className="flex flex-col gap-1 text-xs">
                  <div className="flex gap-2"><span className="font-bold text-slate-400">Evidence:</span> <span className="font-medium text-slate-700">{w.evidence}</span></div>
                  <div className="flex gap-2"><span className="font-bold text-slate-400">Risk:</span> <span className="font-medium text-rose-600">{w.risk}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Priority Fixes */}
      <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm border-l-4 border-l-rose-500">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
          <Zap className="w-6 h-6 text-rose-500" /> Priority Fixes
        </h2>
        <div className="grid gap-4">
          {(data.priorityFixes || []).map((fix: IPriorityFix, i: number) => (
            <div key={i} className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex-1">
                <h3 className="font-bold text-slate-900 text-lg mb-1">{fix.title}</h3>
                <p className="text-sm text-slate-500">{fix.reason}</p>
              </div>
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Impact</div>
                  <div className={`text-sm font-bold ${fix.impact === 'High' ? 'text-green-600' : 'text-amber-600'}`}>{fix.impact}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Effort</div>
                  <div className={`text-sm font-bold ${fix.effort === 'High' ? 'text-rose-600' : 'text-blue-600'}`}>{fix.effort}</div>
                </div>
                <div className="text-center bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
                  <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-0.5">Expected Gain</div>
                  <div className={`text-sm font-black text-blue-600`}>{fix.expectedScoreGain || fix.revenuePotential}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Plans */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-500" /> 30-Day Action Plan
          </h2>
          <div className="space-y-6">
            {(data.thirtyDayPlan || []).map((week: any, i: number) => (
              <div key={i}>
                <h3 className="font-bold text-blue-600 text-sm uppercase tracking-wide mb-2">{week.week}</h3>
                <p className="text-xs font-bold text-slate-400 mb-3">{week.expectedOutcome}</p>
                <ul className="space-y-2">
                  {(week.tasks || []).map((t: string, j: number) => (
                    <li key={j} className="text-sm text-slate-600 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 mt-0.5 text-slate-300 shrink-0" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex items-center gap-2">
            <Target className="w-5 h-5 text-purple-500" /> 90-Day Roadmap
          </h2>
          <div className="space-y-6">
            {(data.ninetyDayPlan || []).map((month: any, i: number) => (
              <div key={i}>
                <h3 className="font-bold text-purple-600 text-sm uppercase tracking-wide mb-2">{month.month}</h3>
                <div className="flex gap-2 mb-3 flex-wrap">
                  {(month.focusAreas || []).map((fa: string, j: number) => (
                    <span key={j} className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-500 rounded uppercase tracking-wider">{fa}</span>
                  ))}
                </div>
                <ul className="space-y-2">
                  {(month.tasks || []).map((t: string, j: number) => (
                    <li key={j} className="text-sm text-slate-600 flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
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
