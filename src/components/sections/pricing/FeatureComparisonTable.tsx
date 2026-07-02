"use client";

import { Check, Minus } from "lucide-react";

const features = [
  { name: "Audits / Month", starter: "1", growth: "4", pro: "Unlimited", agency: "Unlimited" },
  { name: "AI Posts / Month", starter: "7", growth: "15", pro: "30", agency: "Unlimited" },
  { name: "Review Management", starter: true, growth: true, pro: true, agency: true },
  { name: "CRM & Lead Tracking", starter: false, growth: true, pro: true, agency: true },
  { name: "WhatsApp AI Agent", starter: false, growth: false, pro: true, agency: true },
  { name: "Competitor Tracking", starter: "Basic", growth: "Local", pro: "Advanced", agency: "Advanced" },
  { name: "Keyword Tracking", starter: false, growth: true, pro: true, agency: true },
  { name: "Multi-Business Support", starter: false, growth: false, pro: false, agency: true },
  { name: "White Label Reports", starter: false, growth: false, pro: false, agency: true },
  { name: "API Access", starter: false, growth: false, pro: false, agency: true }
];

export function FeatureComparisonTable() {
  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 mt-32 relative z-10">
      <div className="text-center mb-12">
        <h3 className="text-3xl font-bold text-slate-900 mb-4">Compare Plans & Features</h3>
        <p className="text-slate-500">Find the perfect balance of tools and growth capacity for your business.</p>
      </div>

      <div className="overflow-x-auto pb-8">
        <div className="min-w-[800px] bg-white rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/40 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="p-6 font-bold text-slate-900 w-1/3">Core Features</th>
                <th className="p-6 font-bold text-slate-900 text-center">Starter</th>
                <th className="p-6 font-bold text-indigo-600 text-center bg-indigo-50/50">Growth</th>
                <th className="p-6 font-bold text-slate-900 text-center">Pro</th>
                <th className="p-6 font-bold text-slate-900 text-center">Agency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {features.map((feature, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="p-6 font-medium text-slate-700">{feature.name}</td>
                  
                  {/* Starter */}
                  <td className="p-6 text-center text-slate-600 text-sm">
                    {typeof feature.starter === 'boolean' 
                      ? (feature.starter ? <Check className="w-5 h-5 mx-auto text-indigo-500" /> : <Minus className="w-5 h-5 mx-auto text-slate-300" />)
                      : feature.starter}
                  </td>
                  
                  {/* Growth */}
                  <td className="p-6 text-center text-slate-900 font-semibold text-sm bg-indigo-50/30">
                    {typeof feature.growth === 'boolean' 
                      ? (feature.growth ? <Check className="w-5 h-5 mx-auto text-indigo-600" /> : <Minus className="w-5 h-5 mx-auto text-slate-300" />)
                      : feature.growth}
                  </td>
                  
                  {/* Pro */}
                  <td className="p-6 text-center text-slate-600 text-sm">
                    {typeof feature.pro === 'boolean' 
                      ? (feature.pro ? <Check className="w-5 h-5 mx-auto text-indigo-500" /> : <Minus className="w-5 h-5 mx-auto text-slate-300" />)
                      : feature.pro}
                  </td>
                  
                  {/* Agency */}
                  <td className="p-6 text-center text-slate-600 text-sm">
                    {typeof feature.agency === 'boolean' 
                      ? (feature.agency ? <Check className="w-5 h-5 mx-auto text-indigo-500" /> : <Minus className="w-5 h-5 mx-auto text-slate-300" />)
                      : feature.agency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
