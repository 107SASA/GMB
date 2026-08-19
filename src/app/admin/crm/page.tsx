'use client';

import { useEffect, useState } from 'react';
import { Users, TrendingUp, UserCheck, Percent } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface CRMData {
  stats: {
    totalLeads: number;
    newLeadsToday: number;
    convertedLeads: number;
    conversionRate: number;
  };
  pipelineBreakdown: Array<{ stage: string; count: number }>;
  recentLeads: Array<{
    _id: string;
    businessName: string;
    name: string;
    source: string;
    pipelineStage: string;
    aiLeadScore: number | null;
    createdAt: string;
  }>;
  topBusinessesByLeads: Array<{
    businessId: string;
    businessName: string;
    totalLeads: number;
  }>;
}

const SOURCE_COLORS: Record<string, string> = {
  WhatsApp: 'bg-secondary-container text-on-secondary-container',
  Website: 'bg-primary-fixed text-primary',
  Manual: 'bg-surface-container text-on-surface-variant',
  Instagram: 'bg-pink-100 text-pink-700',
  Facebook: 'bg-primary-fixed text-primary',
  Referral: 'bg-primary-fixed text-primary',
  'Demo Booking': 'bg-primary-fixed text-primary',
  'Phone Call': 'bg-secondary-container/40 text-on-secondary-container',
};


export default function CRMMonitorPage() {
  const [data, setData] = useState<CRMData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/crm-monitor')
      .then((r) => r.json())
      .then((json) => { if (json.success) setData(json.data); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">CRM Monitor</h1>
          <p className="text-sm text-on-surface-variant">All leads and pipeline stages across every tenant.</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Leads', value: loading ? '—' : data?.stats.totalLeads.toLocaleString(), icon: Users, color: 'text-primary bg-primary-fixed' },
          { label: 'New Today', value: loading ? '—' : data?.stats.newLeadsToday.toLocaleString(), icon: TrendingUp, color: 'text-primary bg-primary-fixed' },
          { label: 'Converted', value: loading ? '—' : data?.stats.convertedLeads.toLocaleString(), icon: UserCheck, color: 'text-secondary bg-secondary-container/40' },
          { label: 'Conversion Rate', value: loading ? '—' : `${data?.stats.conversionRate ?? 0}%`, icon: Percent, color: 'text-primary bg-primary-fixed' },
        ].map((card) => (
          <div key={card.label} className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant card-shadow">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-on-surface-variant">{card.label}</span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${card.color}`}>
                <card.icon className="w-4 h-4" />
              </div>
            </div>
            <p className="text-2xl font-bold text-on-surface">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline Breakdown Chart */}
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
          <h2 className="font-semibold text-on-surface mb-4">Pipeline Breakdown</h2>
          {loading ? (
            <div className="h-48 bg-surface-container rounded-xl animate-pulse" />
          ) : (data?.pipelineBreakdown ?? []).length === 0 ? (
            <div className="h-48 flex items-center justify-center text-outline text-sm">No pipeline data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data?.pipelineBreakdown} layout="vertical" margin={{ left: 8, right: 16 }}>
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="stage"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={90}
                />
                <Tooltip
                  cursor={{ fill: '#f1f5f9' }}
                  contentStyle={{ border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12 }}
                />
                <Bar dataKey="count" radius={[0, 6, 6, 0]} fill="#0a8a3e" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Top Businesses by Leads */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
          <h2 className="font-semibold text-on-surface mb-4">Top Businesses</h2>
          {loading ? (
            <div className="space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="h-3 w-28 bg-surface-container-high rounded" />
                  <div className="h-3 w-8 bg-surface-container-high rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {(data?.topBusinessesByLeads ?? []).map((biz, i) => (
                <div key={biz.businessId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-primary-fixed text-primary text-xs font-bold flex items-center justify-center">{i + 1}</span>
                    <span className="text-sm text-on-surface truncate max-w-35">{biz.businessName}</span>
                  </div>
                  <span className="text-sm font-bold text-on-surface">{biz.totalLeads}</span>
                </div>
              ))}
              {(data?.topBusinessesByLeads ?? []).length === 0 && (
                <p className="text-sm text-outline text-center py-4">No data yet</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recent Leads Table */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant">
          <h2 className="font-semibold text-on-surface">Recent Leads</h2>
          <p className="text-xs text-outline mt-0.5">Latest 20 leads across all businesses</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-label-sm text-on-surface-variant bg-surface-container-low">
                <th className="text-left px-4 py-3">Business</th>
                <th className="text-left px-4 py-3">Lead</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Stage</th>
                <th className="text-left px-4 py-3">AI Score</th>
                <th className="text-left px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 bg-surface-container-high rounded w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : (data?.recentLeads ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-outline">No leads yet</td>
                </tr>
              ) : (
                data?.recentLeads.map((lead) => (
                  <tr key={lead._id} className="hover:bg-surface transition-colors">
                    <td className="px-4 py-3 font-medium text-on-surface whitespace-nowrap">{lead.businessName}</td>
                    <td className="px-4 py-3 text-on-surface whitespace-nowrap">{lead.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${SOURCE_COLORS[lead.source] ?? 'bg-surface-container text-on-surface-variant'}`}>
                        {lead.source}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant whitespace-nowrap">{lead.pipelineStage}</td>
                    <td className="px-4 py-3">
                      {lead.aiLeadScore != null ? (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${
                          lead.aiLeadScore >= 70 ? 'bg-secondary-container/40 text-on-secondary-container' :
                          lead.aiLeadScore >= 40 ? 'bg-primary-fixed text-primary' :
                          'bg-error-container text-on-error-container'
                        }`}>
                          {lead.aiLeadScore}
                        </span>
                      ) : (
                        <span className="text-outline">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-outline whitespace-nowrap">
                      {new Date(lead.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
