import React, { useMemo } from 'react';
import { BarChart3, TrendingUp, Users, Target, CheckCircle2 } from 'lucide-react';

export default function CRMAnalytics({ leads }: { leads: any[] }) {
  const analytics = useMemo(() => {
    const total = leads.length;
    const qualified = leads.filter(l => l.pipelineStage === 'Qualified').length;
    const converted = leads.filter(l => l.pipelineStage === 'Converted').length;
    const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;
    const avgScore = leads.length > 0 
      ? Math.round(leads.reduce((sum, l) => sum + (l.aiLeadScore || 0), 0) / leads.length) 
      : 0;
    
    // Top Source
    const sources: Record<string, number> = {};
    leads.forEach(l => {
      sources[l.source] = (sources[l.source] || 0) + 1;
    });
    const topSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

    // Pipeline Distribution
    const stages: Record<string, number> = {};
    leads.forEach(l => {
      const stage = l.pipelineStage || 'New';
      stages[stage] = (stages[stage] || 0) + 1;
    });

    return { total, qualified, converted, conversionRate, avgScore, topSource, stages };
  }, [leads]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Total Leads</p>
            <p className="text-2xl font-bold text-slate-900">{analytics.total}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Qualified Leads</p>
            <p className="text-2xl font-bold text-slate-900">{analytics.qualified}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Converted Leads</p>
            <p className="text-2xl font-bold text-slate-900">{analytics.converted} <span className="text-sm font-medium text-emerald-500 ml-2">({analytics.conversionRate}%)</span></p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Avg Lead Score</p>
            <p className="text-2xl font-bold text-slate-900">{analytics.avgScore}</p>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-xl">
            <BarChart3 className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Top Source</p>
            <p className="text-2xl font-bold text-slate-900">{analytics.topSource}</p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900 mb-6">Pipeline Distribution</h3>
        <div className="space-y-4">
          {Object.entries(analytics.stages).map(([stage, count]) => (
            <div key={stage}>
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-slate-700">{stage}</span>
                <span className="text-slate-500">{count} leads</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2.5">
                <div 
                  className="bg-indigo-600 h-2.5 rounded-full" 
                  style={{ width: `${(count / Math.max(analytics.total, 1)) * 100}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
