"use client";

import { useSearchParams, useRouter } from 'next/navigation';
import { Lock, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';

export default function UpgradePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const moduleName = searchParams.get('module') || 'Premium Feature';

  const formatModuleName = (name: string) => {
    return name
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-3xl p-10 shadow-sm text-center relative overflow-hidden">
        
        {/* Background Accents */}
        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-primary/5 rounded-full blur-[80px] pointer-events-none -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-blue-500/5 rounded-full blur-[80px] pointer-events-none translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10">
          <div className="w-20 h-20 bg-slate-50 border border-slate-100 rounded-3xl mx-auto flex items-center justify-center mb-8 shadow-sm">
            <Lock className="w-10 h-10 text-slate-400" />
          </div>

          <h1 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight">
            Unlock {formatModuleName(moduleName)}
          </h1>
          <p className="text-lg text-slate-500 mb-10 max-w-md mx-auto">
            This module requires a Premium subscription. Upgrade your workspace to access advanced AI growth tools.
          </p>

          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 mb-10 text-left max-w-md mx-auto">
            <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500" />
              Pro Plan Benefits
            </h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-sm text-slate-600">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                Access to all AI Agents (Sales, Rep, Content)
              </li>
              <li className="flex items-center gap-3 text-sm text-slate-600">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                Unlimited GMB Audits & Insights
              </li>
              <li className="flex items-center gap-3 text-sm text-slate-600">
                <CheckCircle2 className="w-5 h-5 text-primary" />
                Automated Review Responses
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={() => router.back()}
              className="px-8 py-4 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-2xl font-bold transition-all shadow-sm"
            >
              Go Back
            </button>
            <button 
              className="px-8 py-4 bg-primary hover:bg-primary/90 text-white rounded-2xl font-bold transition-all shadow-md flex items-center justify-center gap-2"
            >
              Upgrade to Premium
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
