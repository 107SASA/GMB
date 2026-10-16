'use client';

import { AlertTriangle, X } from 'lucide-react';

/** In-app confirmation for billing changes (no browser confirm()). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="billing-confirm-title">
      <div className="w-full max-w-md rounded-2xl border border-outline-variant bg-surface-container-lowest p-5 card-shadow">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className={danger ? 'h-5 w-5 text-error' : 'h-5 w-5 text-primary'} />
            <h3 id="billing-confirm-title" className="font-bold text-on-surface">{title}</h3>
          </div>
          <button type="button" onClick={onCancel} aria-label="Close" className="text-outline hover:text-on-surface">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 text-sm text-on-surface-variant">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-semibold text-on-surface-variant hover:bg-surface disabled:opacity-60">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-60 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-container'}`}
          >
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
