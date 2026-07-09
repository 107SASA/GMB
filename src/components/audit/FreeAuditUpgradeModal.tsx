'use client';

import Link from 'next/link';
import { Zap, TrendingUp } from 'lucide-react';

interface FreeAuditUpgradeModalProps {
  onClose: () => void;
}

/**
 * Shown once, right after a freemium (audit-only) user's single free audit
 * report finishes generating. Explains the free plan limit and sends them
 * to Billing to upgrade. Dismissible here (they can still look at their
 * report), but every other page in the app remains blocked by src/proxy.ts
 * until they upgrade.
 */
export default function FreeAuditUpgradeModal({ onClose }: FreeAuditUpgradeModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-br from-violet-600 to-indigo-600 px-6 pt-8 pb-10 text-center relative">
          <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Zap className="w-7 h-7 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">Your Free Audit Report is Ready</h2>
          <p className="text-violet-200 text-sm">Your free plan includes one audit report</p>
        </div>

        <div className="-mt-5 mx-6 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-5">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                <TrendingUp className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">
                All remaining platform features — Dashboard, Content Generator, Scheduler, Inbox, Leads and more —
                require an upgrade. Your report stays saved and accessible either way.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
            >
              View Report
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
