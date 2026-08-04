'use client';

import { X, Zap, TrendingUp } from 'lucide-react';
import Link from 'next/link';

interface UpgradeLimitModalProps {
  message: string;
  onClose: () => void;
}

export default function UpgradeLimitModal({ message, onClose }: UpgradeLimitModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-primary/60 backdrop-blur-sm">
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md overflow-hidden">
        {/* Gradient header */}
        <div className="bg-gradient-to-br from-primary to-primary-container px-6 pt-8 pb-10 text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="w-14 h-14 bg-surface-container-lowest/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">You've Reached Your Limit</h2>
          <p className="text-on-primary-container text-sm">Upgrade your plan to unlock more capacity</p>
        </div>

        {/* Body */}
        <div className="-mt-5 mx-6 mb-6">
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-4 mb-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-error-container rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                <TrendingUp className="w-4 h-4 text-error" />
              </div>
              <p className="text-sm text-on-surface leading-relaxed">{message}</p>
            </div>
          </div>

          <div className="space-y-2.5 text-sm mb-6">
            {[
              'More AI generations every month',
              'Higher audit & post limits',
              'Priority processing',
            ].map(benefit => (
              <div key={benefit} className="flex items-center gap-2 text-on-surface-variant">
                <div className="w-4 h-4 bg-secondary-container rounded-full flex items-center justify-center shrink-0">
                  <svg className="w-2.5 h-2.5 text-secondary" viewBox="0 0 10 10" fill="none">
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
              className="flex-1 py-2.5 text-sm font-semibold text-on-surface-variant bg-surface-container rounded-xl hover:bg-surface-container-high transition-colors"
            >
              Maybe Later
            </button>
            <Link
              href="/dashboard/billing"
              className="flex-1 py-2.5 text-sm font-bold text-white bg-primary rounded-xl hover:bg-primary-container transition-colors text-center"
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
