import React from 'react';
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';

interface ChartsSectionProps {
  charts: {
    leadsOverTime: any[];
    starsDistribution: any[];
    sourceDonut: any[];
  };
  rangeDays: number;
}

const COLORS = ['#4f46e5', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4'];

export default function ChartsSection({ charts, rangeDays }: ChartsSectionProps) {
  const hasLeads = charts.leadsOverTime.length > 0;
  const hasSources = charts.sourceDonut.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      {/* Leads Line Chart */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-4 h-4 text-indigo-500" />
          <h3 className="font-bold text-slate-900">Leads Growth</h3>
        </div>
        <p className="text-xs text-slate-400 mb-5">Last {rangeDays} days</p>
        <div className="h-56 relative">
          {!hasLeads && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <p className="text-sm font-medium text-slate-500 mb-1">No historical lead data yet</p>
              <p className="text-xs text-slate-400">Charts populate as new leads come in.</p>
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hasLeads ? charts.leadsOverTime : [{ date: '', leads: 0 }]}>
              <defs>
                <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                dy={10}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} dx={-8} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
              />
              <Line
                type="monotone"
                dataKey="leads"
                stroke="#4f46e5"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 6, fill: '#4f46e5', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sources Donut */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="font-bold text-slate-900 mb-1">Lead Sources</h3>
        <p className="text-xs text-slate-400 mb-5">Where your leads come from</p>
        <div className="h-48 relative">
          {!hasSources && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <p className="text-sm font-medium text-slate-500 mb-1">No source data</p>
              <a href="/dashboard/crm" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">
                Connect Integrations →
              </a>
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={hasSources ? charts.sourceDonut : [{ name: 'Empty', value: 1 }]}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={75}
                paddingAngle={hasSources ? 4 : 0}
                dataKey="value"
              >
                {hasSources
                  ? charts.sourceDonut.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                    ))
                  : <Cell fill="#e2e8f0" strokeWidth={0} />
                }
              </Pie>
              {hasSources && (
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }} />
              )}
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-2 mt-2">
          {charts.sourceDonut.map((entry, index) => (
            <div key={index} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              {entry.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
