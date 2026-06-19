import React from 'react';

export default function AdminRootPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Platform Operations Center</h1>
        <p className="text-slate-500 text-sm mt-1">Monitor overall platform health, revenue, and usage.</p>
      </div>
      
      {/* Metrics Grid Placeholder */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Customers', value: '1,204' },
          { label: 'Active Businesses', value: '890' },
          { label: 'MRR', value: '$45,200' },
          { label: 'AI Requests (Today)', value: '14.2k' },
        ].map((metric) => (
          <div key={metric.label} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="text-sm font-medium text-slate-500">{metric.label}</h3>
            <p className="text-2xl font-bold text-slate-900 mt-2">{metric.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
