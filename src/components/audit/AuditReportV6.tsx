import React from 'react';
import { IAudit, IAuditData, IChecklistItem, IPriorityFix } from '@/models/Audit';
import { Download, Search, CheckCircle2, AlertCircle, TrendingUp, Zap, Target, Star, FileText, XCircle, Clock } from 'lucide-react';

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

export default function AuditReportV6({ audit, onDownload }: { audit: IAudit; onDownload: () => void }) {
  const data = audit.auditData as IAuditData;

  if (!data) return <div className="p-8 text-center text-slate-500">No data available</div>;

  return (
    <div className="max-w-6xl mx-auto pb-20 space-y-8 font-sans">
      
      {/* Header Bar */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div>
          <h1 className="text-2xl font-black mb-1">{audit.businessName}</h1>
          <p className="text-slate-400 font-medium">Complete Google Business Profile Audit</p>
        </div>
        <button
          onClick={onDownload}
          className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-bold transition-colors flex items-center gap-2 w-max"
        >
          <Download className="w-5 h-5" /> Download Report
        </button>
      </div>

      {/* Hero Scores Section */}
      <div className="grid md:grid-cols-2 gap-6">
        
        {/* Search Rank Card */}
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm flex flex-col justify-center text-center">
          <div className="mx-auto bg-green-50 w-16 h-16 rounded-full flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-500 uppercase tracking-wide mb-2">Average Local Search Rank</h2>
          <div className="text-6xl font-black text-slate-900 mb-2">#{data.googleSearchRank?.averageRank || '-'}</div>
          <p className="text-slate-500 font-medium text-sm">Based on Top 5 Primary Keywords</p>
        </div>

        {/* Profile Score Card */}
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm flex flex-col justify-center text-center">
          <div className="mx-auto bg-blue-50 w-16 h-16 rounded-full flex items-center justify-center mb-4">
            <Star className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-500 uppercase tracking-wide mb-2">Overall Profile Score</h2>
          <div className="text-6xl font-black text-blue-600 mb-2">{data.profileScore?.overallScore || 0}/100</div>
          <p className="text-slate-500 font-medium text-sm">Aggregated health metric across 5 dimensions</p>
        </div>
      </div>

      {/* Keyword Rankings Table */}
      <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
          <Target className="w-6 h-6 text-slate-400" /> Live Keyword Rankings
          <EvidenceBadge text={data.evidence?.searchRankings} />
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Search Term</th>
                <th className="pb-3 text-sm font-bold text-slate-500 uppercase text-right">Current Rank</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data.googleSearchRank?.topKeywords || []).map((k: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="py-4 text-slate-900 font-medium">{k.keyword}</td>
                  <td className="py-4 text-right">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${
                      k.rank <= 3 ? 'bg-green-100 text-green-700' : 
                      k.rank <= 10 ? 'bg-amber-100 text-amber-700' : 
                      'bg-rose-100 text-rose-700'
                    }`}>
                      {k.rank > 20 ? '20+' : `#${k.rank}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Competitor Analysis Table */}
      <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center gap-3">
          <Zap className="w-6 h-6 text-slate-400" /> Top Local Competitors
          <EvidenceBadge text={data.evidence?.competitors} />
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Business Name</th>
                <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Rating</th>
                <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Reviews</th>
                <th className="pb-3 text-sm font-bold text-slate-500 uppercase">Distance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data.competitors || []).map((c: any, i: number) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="py-4 text-slate-900 font-bold">{c.name}</td>
                  <td className="py-4 text-slate-700 font-medium flex items-center gap-1">
                    {c.rating} <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
                  </td>
                  <td className="py-4 text-slate-600">{c.reviewCount}</td>
                  <td className="py-4 text-slate-500">{c.distance || 'Unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Keyword Gap & Profile SEO */}
      <div className="grid md:grid-cols-2 gap-6">
        
        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-6">Keyword Gap Analysis</h2>
          <div className="space-y-4">
            {(data.keywordGapAnalysis || []).map((gap: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="font-medium text-slate-700">{gap.keyword}</span>
                {gap.missing ? (
                  <span className="text-xs font-bold px-2 py-1 bg-rose-100 text-rose-700 rounded-lg">Missing</span>
                ) : (
                  <span className="text-xs font-bold px-2 py-1 bg-green-100 text-green-700 rounded-lg">Found</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-6 flex justify-between items-center">
            Profile SEO
            <span className="text-2xl font-black text-blue-600">{data.seoScore?.score || 0}/100</span>
          </h2>
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-3">Optimization Opportunities</h3>
          <ul className="space-y-3">
            {(data.seoScore?.optimizationOpportunities || []).map((opp: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-slate-700 text-sm">
                <TrendingUp className="w-4 h-4 mt-0.5 text-blue-500 shrink-0" />
                <span>{opp}</span>
              </li>
            ))}
          </ul>
        </div>

      </div>

      {/* Review Analytics Grid */}
      <div className="bg-slate-900 rounded-2xl p-8 text-white shadow-xl">
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-2">
          Review Analytics
          <EvidenceBadge text={data.evidence?.reviewAnalysis} />
        </h2>
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
      </div>

      {/* Profile Completion Checklist */}
      <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-slate-400" /> Profile Completion Checklist
            <EvidenceBadge text={data.evidence?.profileCompletion} />
          </div>
          <span className="text-blue-600 font-black">{data.profileCompletion?.completionPercentage || 0}%</span>
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {(data.profileCompletion?.checklist || []).map((item: IChecklistItem, i: number) => (
            <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-slate-100 bg-slate-50/50">
              <span className="font-medium text-slate-700">{item.field}</span>
              {item.status === 'Complete' ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : item.status === 'Partial' ? (
                <AlertCircle className="w-5 h-5 text-amber-500" />
              ) : (
                <XCircle className="w-5 h-5 text-rose-500" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-emerald-50 rounded-2xl p-8 border border-emerald-100">
          <h2 className="text-xl font-bold text-emerald-900 mb-6 flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" /> Strengths
          </h2>
          <ul className="space-y-4">
            {(data.strengths || []).map((s: any, i: number) => (
              <li key={i} className="flex items-start gap-3 text-emerald-800 font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-500 mt-2 shrink-0" />
                <span>{typeof s === 'string' ? s : s.title}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-rose-50 rounded-2xl p-8 border border-rose-100">
          <h2 className="text-xl font-bold text-rose-900 mb-6 flex items-center gap-2">
            <AlertCircle className="w-6 h-6 text-rose-600" /> Weaknesses
          </h2>
          <ul className="space-y-4">
            {(data.weaknesses || []).map((w: any, i: number) => (
              <li key={i} className="flex items-start gap-3 text-rose-800 font-medium">
                <span className="w-2 h-2 rounded-full bg-rose-500 mt-2 shrink-0" />
                <span>{typeof w === 'string' ? w : w.title}</span>
              </li>
            ))}
          </ul>
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
              </div>
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="text-xs font-bold text-slate-400 uppercase mb-1">Impact</div>
                  <div className={`text-sm font-bold ${fix.impact === 'High' ? 'text-green-600' : 'text-amber-600'}`}>{fix.impact}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs font-bold text-slate-400 uppercase mb-1">Effort</div>
                  <div className={`text-sm font-bold ${fix.effort === 'High' ? 'text-rose-600' : 'text-blue-600'}`}>{fix.effort}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs font-bold text-slate-400 uppercase mb-1">Rev. Potential</div>
                  <div className={`text-sm font-bold text-emerald-600`}>{fix.revenuePotential}</div>
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
                <h3 className="font-bold text-blue-600 text-sm uppercase tracking-wide mb-3">{week.week}</h3>
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
                <h3 className="font-bold text-purple-600 text-sm uppercase tracking-wide mb-3">{month.month}</h3>
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
