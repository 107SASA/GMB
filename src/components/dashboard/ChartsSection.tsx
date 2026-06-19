import React from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ChartsSectionProps {
  charts: {
    leadsOverTime: any[];
    starsDistribution: any[];
    sourceDonut: any[];
  };
}

export default function ChartsSection({ charts }: ChartsSectionProps) {
  const COLORS = ['#4f46e5', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      {/* Leads Line Chart */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2">
        <h3 className="font-bold text-slate-900 mb-6">Leads Growth</h3>
        <div className="h-64 relative">
          <ResponsiveContainer width="100%" height="100%" className="relative">
            {charts.leadsOverTime.length === 0 ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm rounded-xl">
                <p className="text-sm font-medium text-slate-600 mb-2">No historical lead data</p>
                <p className="text-xs text-slate-400 max-w-[200px] text-center">Charts will populate as new leads are captured.</p>
              </div>
            ) : null}
            <LineChart data={charts.leadsOverTime}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Line type="monotone" dataKey="leads" stroke="#4f46e5" strokeWidth={3} dot={false} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sources Donut */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="font-bold text-slate-900 mb-6">Lead Sources</h3>
        <div className="h-64 flex flex-col justify-center">
          <ResponsiveContainer width="100%" height="100%" className="relative">
            {charts.sourceDonut.length === 0 ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm rounded-xl">
                <p className="text-sm font-medium text-slate-600 mb-2">No source data</p>
                <a href="/dashboard/crm" className="text-xs font-bold text-indigo-600 hover:text-indigo-700">Connect Integrations &rarr;</a>
              </div>
            ) : null}
            <PieChart>
              <Pie
                data={charts.sourceDonut.length > 0 ? charts.sourceDonut : [{name: 'Empty', value: 1}]}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
                fill={charts.sourceDonut.length > 0 ? undefined : '#e2e8f0'}
              >
                {charts.sourceDonut.length > 0 && charts.sourceDonut.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              {charts.sourceDonut.length > 0 && <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />}
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap justify-center gap-3 mt-4 h-6">
            {charts.sourceDonut.map((entry, index) => (
              <div key={index} className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                {entry.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
