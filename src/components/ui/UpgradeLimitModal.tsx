'use client';

import { X, Zap, TrendingUp } from 'lucide-react';
import Link from 'next/link';

interface UpgradeLimitModalProps {
  message: string;
  onClose: () => void;
}

export default function UpgradeLimitModal({ message, onClose }: UpgradeLimitModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Gradient header */}
        <div className="bg-gradient-to-br from-violet-600 to-indigo-600 px-6 pt-8 pb-10 text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">You've Reached Your Limit</h2>
          <p className="text-violet-200 text-sm">Upgrade your plan to unlock more capacity</p>
        </div>

        {/* Body */}
        <div className="-mt-5 mx-6 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                <TrendingUp className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">{message}</p>
            </div>
          </div>

          <div className="space-y-2.5 text-sm mb-6">
            {[
              'More AI generations every month',
              'Higher audit & post limits',
              'Priority processing',
            ].map(benefit => (
              <div key={benefit} className="flex items-center gap-2 text-slate-600">
                <div className="w-4 h-4 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                  <svg className="w-2.5 h-2.5 text-emerald-600" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                {benefit}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
            >
              Maybe Later
            </button>
            <Link
              href="/dashboard/billing"
              className="flex-1 py-2.5 text-sm font-bold text-white bg-violet-600 rounded-xl hover:bg-violet-700 transition-colors text-center"
              onClick={onClose}
            >
              Upgrade Now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
