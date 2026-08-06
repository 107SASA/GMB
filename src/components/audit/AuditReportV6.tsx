import React from 'react';
import { IAudit, IAuditData, IChecklistItem, IPriorityFix } from '@/models/Audit';
import { Download, Search, CheckCircle2, AlertCircle, TrendingUp, Zap, Target, Star, FileText, XCircle, Clock } from 'lucide-react';

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

export default function AuditReportV6({ audit, onDownload }: { audit: IAudit; onDownload: () => void }) {
  const data = audit.auditData as IAuditData;

  if (!data) return <div className="p-8 text-center text-on-surface-variant">No data available</div>;

  // Competitor RANK lookup — the "Top Local Competitors" table below already
  // lists name/rating/reviews/distance but never showed each competitor's
  // search rank (the actual gap: "competitor ranking is missing"). Same
  // fallback AuditReportGrexa (current template) uses: prefer real geo-grid
  // avgRank from localPackCompetitors, keyed by name since data.competitors
  // itself may not carry a rank on older audits.
  const rankByName = new Map<string, number | undefined>(
    (data.localPackCompetitors ?? []).map((c: any) => [c.name, c.avgRank])
  );
  const competitorRank = (c: any): number | undefined =>
    rankByName.get(c.name) ?? c.avgRank ?? c.estimatedRank;

  return (
    <div className="max-w-6xl mx-auto pb-20 space-y-8 font-sans">
      
      {/* Header Bar */}
      <div className="bg-primary text-white rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 card-shadow">
        <div>
          <h1 className="text-2xl font-heading font-black mb-1">{audit.businessName}</h1>
          <p className="text-outline font-medium">Complete Google Business Profile Audit</p>
        </div>
        <button
          data-pdf-hide="true"
          onClick={onDownload}
          className="bg-primary-container hover:bg-primary text-white px-6 py-3 rounded-xl font-bold transition-colors flex items-center gap-2 w-max"
        >
          <Download className="w-5 h-5" /> Download Report
        </button>
      </div>

      {/* Hero Scores Section */}
      <div className="grid md:grid-cols-2 gap-6">
        
        {/* Search Rank Card */}
        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm flex flex-col justify-center text-center">
          <div className="mx-auto bg-secondary-container/40 w-16 h-16 rounded-full flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-secondary" />
          </div>
          <h2 className="text-lg font-bold text-on-surface-variant uppercase tracking-wide mb-2">Average Local Search Rank</h2>
          <div className="text-6xl font-black text-on-surface mb-2">#{data.googleSearchRank?.averageRank || '-'}</div>
          <p className="text-on-surface-variant font-medium text-sm">Based on Top 5 Primary Keywords</p>
        </div>

        {/* Profile Score Card */}
        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm flex flex-col justify-center text-center">
          <div className="mx-auto bg-primary-fixed w-16 h-16 rounded-full flex items-center justify-center mb-4">
            <Star className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-on-surface-variant uppercase tracking-wide mb-2">Overall Profile Score</h2>
          <div className="text-6xl font-black text-primary mb-2">{data.profileScore?.overallScore || 0}/100</div>
          <p className="text-on-surface-variant font-medium text-sm">Aggregated health metric across 5 dimensions</p>
        </div>
      </div>

      {/* Keyword Rankings Table */}
      <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm">
        <h2 className="text-2xl font-bold text-on-surface mb-6 flex items-center gap-3">
          <Target className="w-6 h-6 text-outline" /> Live Keyword Rankings
          <EvidenceBadge text={data.evidence?.searchRankings} />
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-outline-variant">
                <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Search Term</th>
                <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase text-right">Current Rank</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {(data.googleSearchRank?.topKeywords || []).map((k: any, i: number) => (
                <tr key={i} className="hover:bg-surface">
                  <td className="py-4 text-on-surface font-medium">{k.keyword}</td>
                  <td className="py-4 text-right">
                    <span className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${
                      k.rank <= 3 ? 'bg-secondary-container text-on-secondary-container' : 
                      k.rank <= 10 ? 'bg-primary-fixed text-primary' : 
                      'bg-error-container text-on-error-container'
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
      <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm">
        <h2 className="text-2xl font-bold text-on-surface mb-6 flex items-center gap-3">
          <Zap className="w-6 h-6 text-outline" /> Top Local Competitors
          <EvidenceBadge text={data.evidence?.competitors} />
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-outline-variant">
                <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Business Name</th>
                <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase text-right">Avg. Rank</th>
                <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Rating</th>
                <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Reviews</th>
                <th className="pb-3 text-sm font-bold text-on-surface-variant uppercase">Distance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {(data.competitors || []).map((c: any, i: number) => {
                const rank = competitorRank(c);
                return (
                  <tr key={i} className="hover:bg-surface">
                    <td className="py-4 text-on-surface font-bold">{c.name}</td>
                    <td className="py-4 text-right">
                      <span className="inline-block px-3 py-1 rounded-full text-sm font-bold bg-surface-container text-on-surface-variant">
                        {rank ? `#${Math.round(rank)}` : '—'}
                      </span>
                    </td>
                    <td className="py-4 text-on-surface font-medium flex items-center gap-1">
                      {c.rating} <Star className="w-4 h-4 text-secondary-fixed fill-secondary-fixed" />
                    </td>
                    <td className="py-4 text-on-surface-variant">{c.reviewCount}</td>
                    <td className="py-4 text-on-surface-variant">{c.distance || 'Unknown'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Keyword Gap & Profile SEO */}
      <div className="grid md:grid-cols-2 gap-6">
        
        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm">
          <h2 className="text-xl font-bold text-on-surface mb-6">Keyword Gap Analysis</h2>
          <div className="space-y-4">
            {(data.keywordGapAnalysis || []).map((gap: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-3 bg-surface rounded-xl border border-outline-variant">
                <span className="font-medium text-on-surface">{gap.keyword}</span>
                {gap.missing ? (
                  <span className="text-xs font-bold px-2 py-1 bg-error-container text-on-error-container rounded-lg">Missing</span>
                ) : (
                  <span className="text-xs font-bold px-2 py-1 bg-secondary-container text-on-secondary-container rounded-lg">Found</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm">
          <h2 className="text-xl font-bold text-on-surface mb-6 flex justify-between items-center">
            Profile SEO
            <span className="text-2xl font-black text-primary">{data.seoScore?.score || 0}/100</span>
          </h2>
          <h3 className="text-sm font-bold text-on-surface-variant uppercase mb-3">Optimization Opportunities</h3>
          <ul className="space-y-3">
            {(data.seoScore?.optimizationOpportunities || []).map((opp: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-on-surface text-sm">
                <TrendingUp className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                <span>{opp}</span>
              </li>
            ))}
          </ul>
        </div>

      </div>

      {/* Review Analytics Grid */}
      <div className="bg-primary rounded-2xl p-8 text-white card-shadow">
        <h2 className="text-2xl font-bold mb-8 flex items-center gap-2">
          Review Analytics
          <EvidenceBadge text={data.evidence?.reviewAnalysis} />
        </h2>
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
      </div>

      {/* Profile Completion Checklist */}
      <div className="bg-surface-container-lowest rounded-2xl p-8 border border-outline-variant shadow-sm">
        <h2 className="text-2xl font-bold text-on-surface mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-6 h-6 text-outline" /> Profile Completion Checklist
            <EvidenceBadge text={data.evidence?.profileCompletion} />
          </div>
          <span className="text-primary font-black">{data.profileCompletion?.completionPercentage || 0}%</span>
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {(data.profileCompletion?.checklist || []).map((item: IChecklistItem, i: number) => (
            <div key={i} className="flex items-center justify-between p-4 rounded-xl border border-outline-variant bg-surface/50">
              <span className="font-medium text-on-surface">{item.field}</span>
              {item.status === 'Complete' ? (
                <CheckCircle2 className="w-5 h-5 text-secondary" />
              ) : item.status === 'Partial' ? (
                <AlertCircle className="w-5 h-5 text-primary" />
              ) : (
                <XCircle className="w-5 h-5 text-error" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-secondary-container/40 rounded-2xl p-8 border border-secondary-fixed">
          <h2 className="text-xl font-bold text-on-secondary-container mb-6 flex items-center gap-2">
            <CheckCircle2 className="w-6 h-6 text-secondary" /> Strengths
          </h2>
          <ul className="space-y-4">
            {(data.strengths || []).map((s: any, i: number) => (
              <li key={i} className="flex items-start gap-3 text-on-secondary-container font-medium">
                <span className="w-2 h-2 rounded-full bg-secondary mt-2 shrink-0" />
                <span>{typeof s === 'string' ? s : s.title}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-error-container rounded-2xl p-8 border border-error-container">
          <h2 className="text-xl font-bold text-on-error-container mb-6 flex items-center gap-2">
            <AlertCircle className="w-6 h-6 text-on-error-container" /> Weaknesses
          </h2>
          <ul className="space-y-4">
            {(data.weaknesses || []).map((w: any, i: number) => (
              <li key={i} className="flex items-start gap-3 text-on-error-container font-medium">
                <span className="w-2 h-2 rounded-full bg-error mt-2 shrink-0" />
                <span>{typeof w === 'string' ? w : w.title}</span>
              </li>
            ))}
          </ul>
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
              </div>
              <div className="flex gap-4">
                <div className="text-center">
                  <div className="text-xs font-bold text-outline uppercase mb-1">Impact</div>
                  <div className={`text-sm font-bold ${fix.impact === 'High' ? 'text-secondary' : 'text-primary'}`}>{fix.impact}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs font-bold text-outline uppercase mb-1">Effort</div>
                  <div className={`text-sm font-bold ${fix.effort === 'High' ? 'text-on-error-container' : 'text-primary'}`}>{fix.effort}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs font-bold text-outline uppercase mb-1">Rev. Potential</div>
                  <div className={`text-sm font-bold text-secondary`}>{fix.revenuePotential}</div>
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
                <h3 className="font-bold text-primary text-sm uppercase tracking-wide mb-3">{week.week}</h3>
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
                <h3 className="font-bold text-primary text-sm uppercase tracking-wide mb-3">{month.month}</h3>
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
