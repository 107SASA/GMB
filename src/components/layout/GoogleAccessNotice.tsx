'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, X, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useBusiness } from '@/context/BusinessContext';
import { useGoogleAccess, isAccessProblem } from '@/context/GoogleAccessContext';

/**
 * Shown on every dashboard page when Google refuses GrowwMatics access to the
 * connected profile (or the first check is still running):
 *   - a popup once per session per problem, with the steps to fix it
 *   - a banner that stays until Google confirms access
 * Reconnect → /api/auth/google (lets the owner pick another Google account).
 * Check again → re-runs the Google sync, which re-checks access.
 */
export default function GoogleAccessNotice() {
  const { activeBusiness } = useBusiness();
  const { access, checkAgain, checking } = useGoogleAccess();
  const [popupOpen, setPopupOpen] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const problem = isAccessProblem(access?.status);
  const popupKey = `gm-google-access-popup:${activeBusiness?._id}:${access?.reason ?? ''}`;

  useEffect(() => {
    if (!problem) { setPopupOpen(false); return; }
    let seen = false;
    try { seen = sessionStorage.getItem(popupKey) === '1'; } catch { /* storage blocked — show it */ }
    if (!seen) setPopupOpen(true);
  }, [problem, popupKey]);

  const closePopup = () => {
    try { sessionStorage.setItem(popupKey, '1'); } catch { /* ignore */ }
    setPopupOpen(false);
  };

  const onCheckAgain = async () => {
    const r = await checkAgain();
    if (!r.ok) toast.error(r.error || 'Could not check right now.');
  };

  // Toast once when a check on this page turns the problem into success.
  const [wasProblem, setWasProblem] = useState(false);
  useEffect(() => {
    if (problem) setWasProblem(true);
    else if (wasProblem && access?.status === 'verified') {
      toast.success('Google access confirmed — your report and posts are starting.');
      setWasProblem(false);
    }
  }, [problem, access?.status, wasProblem]);

  if (!access || !access.copy) return null;
  const copy = access.copy;

  if (access.status === 'checking') {
    return (
      <div className="mb-4 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3 flex items-start gap-3">
        <Loader2 className="w-4 h-4 mt-0.5 text-primary animate-spin shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-on-surface">{copy.title}</p>
          <p className="text-xs text-on-surface-variant mt-0.5">{copy.body}</p>
        </div>
      </div>
    );
  }
  if (!problem) return null;

  const actions = (compact: boolean) => (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? 'mt-2' : 'mt-5'}`}>
      {copy.reconnect && (
        <a
          href="/api/auth/google"
          className="px-3 py-1.5 text-xs font-bold text-white bg-primary hover:bg-primary-container rounded-lg transition-colors"
        >
          Reconnect Google
        </a>
      )}
      <button
        onClick={onCheckAgain}
        disabled={checking}
        className="px-3 py-1.5 text-xs font-bold text-primary border border-outline-variant hover:bg-surface-container rounded-lg transition-colors inline-flex items-center gap-1.5 disabled:opacity-60"
      >
        {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {checking ? 'Checking…' : 'Check again'}
      </button>
      {compact && copy.steps.length > 0 && (
        <button onClick={() => setPopupOpen(true)} className="text-xs font-medium text-on-surface-variant hover:text-on-surface underline">
          Show me how
        </button>
      )}
    </div>
  );

  return (
    <>
      <div role="alert" className="mb-4 rounded-xl border border-error bg-error-container px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 mt-0.5 text-error shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-on-error-container">{copy.title}</p>
          <p className="text-xs text-on-error-container mt-0.5">{copy.body}</p>
          {actions(true)}
        </div>
      </div>

      {popupOpen && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="gm-access-title">
          <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-md max-h-[90vh] overflow-y-auto p-6 relative">
            <button onClick={closePopup} className="absolute top-3 right-3 p-1 hover:bg-surface-container rounded-full" aria-label="Close">
              <X className="w-4 h-4 text-on-surface-variant" />
            </button>
            <div className="w-11 h-11 bg-error-container rounded-xl flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6 text-error" />
            </div>
            <h2 id="gm-access-title" className="text-lg font-heading font-bold text-on-surface pr-6">{copy.title}</h2>
            <p className="text-sm text-on-surface-variant mt-2 leading-relaxed">{copy.body}</p>
            {access.googleEmail && (
              <p className="text-xs text-on-surface-variant mt-2">Connected Google account: <span className="font-semibold text-on-surface">{access.googleEmail}</span></p>
            )}
            {copy.steps.length > 0 && (
              <div className="mt-4 rounded-xl bg-surface-container-low p-4">
                <p className="text-xs font-bold text-on-surface mb-2">How to fix it</p>
                <ol className="list-decimal pl-4 space-y-1.5 text-xs text-on-surface-variant">
                  {copy.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                <a
                  href="https://business.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  Open Google Business Profile <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
            {access.detail && (
              <div className="mt-3">
                <button onClick={() => setShowSteps((v) => !v)} className="text-[11px] text-on-surface-variant underline">
                  {showSteps ? 'Hide' : 'Show'} Google’s message
                </button>
                {showSteps && <p className="mt-1 text-[11px] text-on-surface-variant break-words">{access.detail}</p>}
              </div>
            )}
            {actions(false)}
          </div>
        </div>
      )}
    </>
  );
}
