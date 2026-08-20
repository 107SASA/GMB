'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useBusiness } from '@/context/BusinessContext';
import { Zap, AlertTriangle, CheckCircle2, Building2, MapPin, Tag, Globe, Phone, Map as MapIcon, Edit3 } from 'lucide-react';
import UpgradeLimitModal from '@/components/ui/UpgradeLimitModal';
import ConnectGoogleModal from '@/components/audit/ConnectGoogleModal';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

export default function AuditForm() {
  const router = useRouter();
  const { activeBusiness } = useBusiness();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [upgradeMsg, setUpgradeMsg] = useState<string | null>(null);
  const [connectGoogleMsg, setConnectGoogleMsg] = useState<string | null>(null);

  // Editable overrides — pre-filled from profile, user can adjust before each audit run.
  // Business.category is what the owner typed at profile creation (required
  // field, see api/onboarding/route.ts) — the trustworthy source. userDefinedCategory
  // is a later explicit correction, so it wins when present.
  const [categoryOverride, setCategoryOverride] = useState(
    (activeBusiness as any)?.userDefinedCategory || (activeBusiness as any)?.category || ''
  );
  const [cityOverride, setCityOverride] = useState(
    (activeBusiness as any)?.city || ''
  );

  // Last-resort fallback only: if the business profile genuinely has no
  // category at all (neither of the two above), try the connected Google
  // Business Profile's primaryCategory. NOT preferred over the owner's own
  // input — Google's category can be flat-out wrong (e.g. a supermarket
  // showing as "Agricultural service"), whereas what the owner typed at
  // signup is ground truth about their own business.
  useEffect(() => {
    if (categoryOverride.trim() || !activeBusiness?._id) return;
    fetch('/api/gbp/profile')
      .then((r) => r.json())
      .then((d) => {
        if (d?.connected && d?.profile?.primaryCategory) {
          setCategoryOverride(d.profile.primaryCategory);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBusiness?._id]);

  // Feature 2A — Review Analysis Range Selector
  const [reviewPeriodDays, setReviewPeriodDays] = useState<7 | 14 | 21>(14);
  // Feature 2B — Improvement Plan Duration
  const [actionPlanDurationDays, setActionPlanDurationDays] = useState<30 | 45 | 90>(30);

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
          reviewPeriodDays,
          actionPlanDurationDays,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === 'UPGRADE_REQUIRED') {
          setUpgradeMsg(data.error);
          return;
        }
        if (data.code === 'GOOGLE_CONNECTION_REQUIRED') {
          setConnectGoogleMsg(data.error);
          return;
        }
        throw new Error(data.error || 'Failed to generate audit');
      }

      router.push(`/dashboard/audit/${data.auditId}`);
    } catch (err: any) {
      setError(friendlyClientMessage(err));
    } finally {
      // Always clear the loading state, regardless of which path above was
      // taken — previously the UPGRADE_REQUIRED branch returned early without
      // resetting it, leaving "Running Audit Engines…" spinning forever.
      setLoading(false);
    }
  };

  if (!activeBusiness) {
    return (
      <div className="p-8 text-center text-on-surface-variant bg-surface-container-lowest rounded-2xl border border-outline-variant">
        Please select or create a business to run an audit.
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {upgradeMsg && (
        <UpgradeLimitModal message={upgradeMsg} onClose={() => setUpgradeMsg(null)} />
      )}
      {connectGoogleMsg && (
        <ConnectGoogleModal message={connectGoogleMsg} onClose={() => setConnectGoogleMsg(null)} />
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-8 md:p-10"
      >
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-gradient-to-br from-primary-fixed to-primary-container text-primary rounded-xl flex items-center justify-center mx-auto mb-6 card-shadow border border-primary-fixed-dim">
            <Zap size={32} className={isReady ? 'text-primary' : 'text-outline'} />
          </div>
          <h2 className="font-heading text-headline-md text-on-surface mb-3 tracking-tight">Generate AI Audit</h2>
          <p className="text-on-surface-variant text-lg max-w-xl mx-auto">
            Review your business details below, set the category and city, then run the audit.
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-xl mb-10 text-left border border-outline-variant overflow-hidden shadow-sm">
          <div className="bg-surface border-b border-outline-variant p-5 flex items-center justify-between">
            <h3 className="font-semibold text-on-surface flex items-center gap-2">
              <Building2 className="w-5 h-5 text-on-surface-variant" />
              Audit Configuration
            </h3>
            {isReady ? (
              <span className="inline-flex items-center gap-1.5 py-1 px-3 bg-secondary-container/40 text-on-secondary-container text-xs font-semibold rounded-full border border-secondary-fixed">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Ready for Audit
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 py-1 px-3 bg-error-container text-on-error-container text-xs font-semibold rounded-full border border-error-container">
                <AlertTriangle className="w-3.5 h-3.5" />
                Category Required
              </span>
            )}
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Business Name — read-only */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> Business Name
              </label>
              <div className="p-3 bg-surface border border-outline-variant rounded-lg text-on-surface font-medium truncate">
                {activeBusiness.name}
              </div>
            </div>

            {/* Category — EDITABLE */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5" /> Category
                <span className="ml-auto text-primary flex items-center gap-0.5 font-normal normal-case tracking-normal text-xs">
                  <Edit3 className="w-3 h-3" /> editable
                </span>
              </label>
              <input
                type="text"
                value={categoryOverride}
                onChange={e => setCategoryOverride(e.target.value)}
                placeholder="e.g. IT Company, Restaurant, Retail Store"
                className={`w-full p-3 border rounded-lg text-on-surface font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors ${
                  missingCategory
                    ? 'border-error bg-error-container focus:ring-error placeholder:text-error'
                    : 'border-primary-fixed-dim bg-primary-fixed placeholder:text-outline'
                }`}
              />
              {missingCategory && (
                <p className="text-xs text-error flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Required for competitor discovery
                </p>
              )}
            </div>

            {/* City — EDITABLE */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" /> City
                <span className="ml-auto text-primary flex items-center gap-0.5 font-normal normal-case tracking-normal text-xs">
                  <Edit3 className="w-3 h-3" /> editable
                </span>
              </label>
              <input
                type="text"
                value={cityOverride}
                onChange={e => setCityOverride(e.target.value)}
                placeholder="e.g. Kolkata, Mumbai, Pune"
                className="w-full p-3 border border-primary-fixed-dim bg-primary-fixed rounded-lg text-on-surface font-medium focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary placeholder:text-outline transition-colors"
              />
            </div>

            {/* Full Address — read-only */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <MapIcon className="w-3.5 h-3.5" /> Full Address
              </label>
              <div className="p-3 bg-surface border border-outline-variant rounded-lg text-on-surface font-medium truncate">
                {activeBusiness.address || 'N/A'}
              </div>
            </div>

            {/* Website — read-only */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> Website
              </label>
              <div className="p-3 bg-surface border border-outline-variant rounded-lg text-on-surface font-medium truncate">
                {activeBusiness.website || 'N/A'}
              </div>
            </div>

            {/* Phone — read-only */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" /> Phone
              </label>
              <div className="p-3 bg-surface border border-outline-variant rounded-lg text-on-surface font-medium truncate">
                {activeBusiness.phone || 'N/A'}
              </div>
            </div>
          </div>

          <div className="px-6 py-4 bg-surface border-t border-outline-variant text-xs text-on-surface-variant text-center">
            Category and city can be adjusted for each audit run. Other fields come from your business profile.
          </div>
        </div>

        {/* Feature 2 — Review Analysis Range + Improvement Plan Duration selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Review Analysis Period
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([7, 14, 21] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setReviewPeriodDays(days)}
                  className={`py-2.5 px-3 rounded-lg text-sm font-semibold border transition-colors ${
                    reviewPeriodDays === days
                      ? 'bg-primary border-primary text-white'
                      : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant hover:border-primary-fixed-dim'
                  }`}
                >
                  Last {days} Days
                </button>
              ))}
            </div>
            <p className="text-xs text-outline">Determines which reviews are fetched and analyzed for sentiment, trends and recommendations.</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Improvement Plan Duration
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([30, 45, 90] as const).map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setActionPlanDurationDays(days)}
                  className={`py-2.5 px-3 rounded-lg text-sm font-semibold border transition-colors ${
                    actionPlanDurationDays === days
                      ? 'bg-primary border-primary text-white'
                      : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant hover:border-primary-fixed-dim'
                  }`}
                >
                  {days} Days
                </button>
              ))}
            </div>
            <p className="text-xs text-outline">Shapes the generated action plan/roadmap in your report.</p>
          </div>
        </div>

        {error && (
          <div className="mb-8 p-5 bg-error-container text-on-error-container rounded-xl border border-error-container flex items-start gap-3 text-left shadow-sm">
            <AlertTriangle className="w-6 h-6 shrink-0 text-error" />
            <div>
              <h4 className="font-semibold mb-1">Audit Failed</h4>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        <button
          onClick={triggerAudit}
          disabled={loading || !isReady}
          className={`w-full py-5 px-6 rounded-lg text-white font-bold text-lg transition-all flex items-center justify-center gap-3 ${
            loading || !isReady
              ? 'bg-surface-container-highest cursor-not-allowed shadow-none'
              : 'bg-primary hover:bg-primary-container card-shadow hover:-translate-y-0.5'
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
