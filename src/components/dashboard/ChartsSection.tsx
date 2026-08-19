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

// Fixed categorical order (never cycled per-series) — validated for
// colorblind-safe separation and contrast with the dataviz skill's
// scripts/validate_palette.js. Brand green leads, then genuinely distinct
// hues for the remaining lead-source slots.
const COLORS = ['#0a8a3e', '#2563a8', '#c2760a', '#7c3aed', '#c2410c', '#0891b2'];

export default function ChartsSection({ charts, rangeDays }: ChartsSectionProps) {
  const hasLeads = charts.leadsOverTime.length > 0;
  const hasSources = charts.sourceDonut.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      {/* Leads Line Chart */}
      <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow lg:col-span-2">
        <div className="flex items-center gap-2 mb-1">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h3 className="font-heading font-bold text-on-surface">Leads Growth</h3>
        </div>
        <p className="text-label-sm text-on-surface-variant normal-case tracking-normal mb-5">Last {rangeDays} days</p>
        <div className="h-56 relative">
          {!hasLeads && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <p className="text-sm font-medium text-on-surface-variant mb-1">No historical lead data yet</p>
              <p className="text-xs text-outline">Charts populate as new leads come in.</p>
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 224 }}>
            <LineChart data={hasLeads ? charts.leadsOverTime : [{ date: '', leads: 0 }]}>
              <defs>
                <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0a8a3e" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#0a8a3e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e0e3e5" />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: '#737781' }}
                dy={10}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#737781' }} dx={-8} />
              <Tooltip
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontSize: '12px' }}
              />
              <Line
                type="monotone"
                dataKey="leads"
                stroke="#0a8a3e"
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 6, fill: '#0a8a3e', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sources Donut */}
      <div className="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant card-shadow">
        <h3 className="font-heading font-bold text-on-surface mb-1">Lead Sources</h3>
        <p className="text-label-sm text-on-surface-variant normal-case tracking-normal mb-5">Where your leads come from</p>
        <div className="h-48 relative">
          {!hasSources && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
              <p className="text-sm font-medium text-on-surface-variant mb-1">No source data</p>
              <a href="/dashboard/crm" className="text-xs font-bold text-primary hover:text-primary">
                Connect Integrations →
              </a>
            </div>
          )}
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 400, height: 192 }}>
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
                  : <Cell fill="#e0e3e5" strokeWidth={0} />
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
            <div key={index} className="flex items-center gap-1.5 text-xs font-medium text-on-surface-variant">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              {entry.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
