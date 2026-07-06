'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useBusiness } from '@/context/BusinessContext';
import { Zap, AlertTriangle, CheckCircle2, Building2, MapPin, Tag, Globe, Phone, Map as MapIcon, Edit3, CalendarRange } from 'lucide-react';
import UpgradeLimitModal from '@/components/ui/UpgradeLimitModal';

type ReviewPeriod = '7' | '15' | '30' | 'all';

const REVIEW_PERIOD_OPTIONS: { value: ReviewPeriod; label: string }[] = [
  { value: '7',   label: 'Last 7 Days' },
  { value: '15',  label: 'Last 15 Days' },
  { value: '30',  label: 'Last 30 Days' },
  { value: 'all', label: 'All Reviews (default)' },
];

export default function AuditForm() {
  const router = useRouter();
  const { activeBusiness } = useBusiness();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);

  // Editable overrides — pre-filled from profile, user can adjust before each audit run
  const [categoryOverride, setCategoryOverride] = useState(
    (activeBusiness as any)?.userDefinedCategory || ''
  );
  const [cityOverride, setCityOverride] = useState(
    (activeBusiness as any)?.city || ''
  );
  const [reviewPeriod, setReviewPeriod] = useState<ReviewPeriod>('all');

  const missingCategory = !categoryOverride.trim();
  const isReady = !!activeBusiness && !missingCategory;

  const triggerAudit = async () => {
    if (!isReady) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: activeBusiness?._id,
          categoryOverride: categoryOverride.trim(),
          cityOverride: cityOverride.trim(),
          reviewPeriod,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'UPGRADE_REQUIRED') {
          setUpgradeMsg(data.error);
          return;
        }
        throw new Error(data.error || 'Failed to generate audit');
      }

      router.push(`/dashboard/audit/${data.auditId}`);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  if (!activeBusiness) {
    return (
      <div className="p-8 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
        Please select or create a business to run an audit.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {upgradeMsg && (
        <UpgradeLimitModal message={upgradeMsg} onClose={() => setUpgradeMsg(null)} />
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-10"
      >
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-50 to-indigo-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-blue-100">
            <Zap size={32} className={isReady ? 'text-blue-600' : 'text-slate-400'} />
          </div>
          <h2 className="text-3xl font-bold text-slate-900 mb-3 tracking-tight">Generate AI Audit</h2>
          <p className="text-slate-500 text-lg max-w-xl mx-auto">
            Review your business details below, set the category and city, then run the audit.
          </p>
        </div>

        <div className="bg-white rounded-xl mb-10 text-left border border-slate-200 overflow-hidden shadow-sm">
          <div className="bg-slate-50 border-b border-slate-200 p-5 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-slate-500" />
              Audit Configuration
            </h3>
            {isReady ? (
              <span className="inline-flex items-center gap-1.5 py-1 px-3 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Ready for Audit
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 py-1 px-3 bg-amber-50 text-amber-700 text-xs font-semibold rounded-full border border-amber-200">
                <AlertTriangle className="w-3.5 h-3.5" />
                Category Required
              </span>
            )}
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Business Name — read-only */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Business Name
              </label>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-700 font-medium truncate">
                {activeBusiness.name}
              </div>
            </div>

            {/* Category — EDITABLE */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" /> Category
                <span className="ml-auto text-blue-500 flex items-center gap-0.5 font-normal normal-case tracking-normal text-xs">
                  <Edit3 className="w-3 h-3" /> editable
                </span>
              </label>
              <input
                type="text"
                value={categoryOverride}
                onChange={e => setCategoryOverride(e.target.value)}
                placeholder="e.g. IT Company, Restaurant, Hospital"
                className={`w-full p-3 border rounded-lg text-slate-800 font-medium focus:outline-none focus:ring-2 transition-colors ${
                  missingCategory
                    ? 'border-amber-300 bg-amber-50 focus:ring-amber-300 placeholder:text-amber-400'
                    : 'border-blue-200 bg-blue-50 focus:ring-blue-300 placeholder:text-slate-400'
                }`}
              />
              {missingCategory && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Required for competitor discovery
                </p>
              )}
            </div>

            {/* City — EDITABLE */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> City
                <span className="ml-auto text-blue-500 flex items-center gap-0.5 font-normal normal-case tracking-normal text-xs">
                  <Edit3 className="w-3 h-3" /> editable
                </span>
              </label>
              <input
                type="text"
                value={cityOverride}
                onChange={e => setCityOverride(e.target.value)}
                placeholder="e.g. Kolkata, Mumbai, Pune"
                className="w-full p-3 border border-blue-200 bg-blue-50 rounded-lg text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-300 placeholder:text-slate-400 transition-colors"
              />
            </div>

            {/* Full Address — read-only */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <MapIcon className="w-3.5 h-3.5" /> Full Address
              </label>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-700 font-medium truncate">
                {activeBusiness.address || 'N/A'}
              </div>
            </div>

            {/* Website — read-only */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> Website
              </label>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-700 font-medium truncate">
                {activeBusiness.website || 'N/A'}
              </div>
            </div>

            {/* Phone — read-only */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Phone
              </label>
              <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-700 font-medium truncate">
                {activeBusiness.phone || 'N/A'}
              </div>
            </div>

            {/* Review Analysis Period — EDITABLE */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <CalendarRange className="w-3.5 h-3.5" /> Review Analysis Period
                <span className="ml-auto text-blue-500 flex items-center gap-0.5 font-normal normal-case tracking-normal text-xs">
                  <Edit3 className="w-3 h-3" /> editable
                </span>
              </label>
              <select
                value={reviewPeriod}
                onChange={e => setReviewPeriod(e.target.value as ReviewPeriod)}
                className="w-full p-3 border border-blue-200 bg-blue-50 rounded-lg text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-300 transition-colors"
              >
                {REVIEW_PERIOD_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <p className="text-xs text-slate-400">
                Limits review analysis, unanswered-review and sentiment calculations to this window.
              </p>
            </div>
          </div>

          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 text-xs text-slate-500 text-center">
            Category and city can be adjusted for each audit run. Other fields come from your business profile.
          </div>
        </div>

        {error && (
          <div className="mb-8 p-5 bg-red-50 text-red-700 rounded-xl border border-red-100 flex items-start gap-3 text-left shadow-sm">
            <AlertTriangle className="w-6 h-6 shrink-0 text-red-500" />
            <div>
              <h4 className="font-semibold mb-1">Audit Failed</h4>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        <button
          onClick={triggerAudit}
          disabled={loading || !isReady}
          className={`w-full py-5 px-6 rounded-xl text-white font-bold text-lg transition-all flex items-center justify-center gap-3 ${
            loading || !isReady
              ? 'bg-slate-300 cursor-not-allowed shadow-none'
              : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-xl hover:-translate-y-0.5'
          }`}
        >
          {loading ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Running Audit Engines...
            </>
          ) : (
            <>
              <Zap className="w-6 h-6" />
              Generate Audit
            </>
          )}
        </button>
      </motion.div>
    </div>
  );
}
