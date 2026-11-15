'use client';

import { useEffect } from 'react';
import { Loader2, RotateCw, X } from 'lucide-react';

/**
 * "Already sent on <date>, send again?" — shown when a number already got
 * a review link and the resend rule (lib/reviewResendRule.ts) still allows
 * one more. Bottom sheet on phones, centered card from `sm` up; buttons
 * stack full-width on small screens.
 */
export default function ResendConfirmDialog({
  open,
  message,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  message: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-primary/50 backdrop-blur-sm sm:p-4"
      onClick={() => { if (!busy) onCancel(); }}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="resend-confirm-title"
        aria-describedby="resend-confirm-body"
        onClick={(e) => e.stopPropagation()}
        className="bg-surface-container-lowest card-shadow w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="resend-confirm-title" className="text-base sm:text-lg font-bold text-on-surface">
            Review link already sent
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="-m-1 p-1 rounded-lg text-on-surface-variant hover:bg-surface-container shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <p id="resend-confirm-body" className="mt-2 text-sm leading-relaxed text-on-surface-variant break-words">
          {message}
        </p>
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="w-full sm:w-auto px-5 py-3 sm:py-2.5 text-sm font-bold text-on-surface-variant bg-surface-container hover:bg-surface-container-high rounded-xl disabled:opacity-50"
          >
            Don&apos;t send
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 sm:py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
            Send again
          </button>
        </div>
      </div>
    </div>
  );
}
