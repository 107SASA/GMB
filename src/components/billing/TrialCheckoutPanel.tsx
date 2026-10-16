'use client';

import { useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export interface TrialOfferPreview {
  months: number;
  cycle: string;
  eligible: boolean;
  reason: string | null;
  needsPhoneVerification: boolean;
  preview: { trialEndsAt: string; firstChargeAt: string; firstChargeInr: number } | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** The free-trial terms shown before the customer authorizes the mandate. All dates come from the server. */
export function TrialTerms({ offer }: { offer: TrialOfferPreview }) {
  if (!offer.preview) return null;
  return (
    <div className="mt-4 rounded-xl border border-primary bg-primary-fixed p-4 text-sm text-on-surface">
      <div className="mb-2 flex items-center gap-2 font-bold">
        <MaterialIcon name="redeem" size={18} className="text-primary" />
        {offer.months}-month free trial
      </div>
      <ul className="space-y-1.5 text-on-surface-variant">
        <li>Free until <strong className="text-on-surface">{formatDate(offer.preview.trialEndsAt)}</strong>.</li>
        <li>
          Then <strong className="text-on-surface">₹{offer.preview.firstChargeInr.toLocaleString('en-IN')} / year</strong>, charged automatically on{' '}
          {formatDate(offer.preview.firstChargeAt)} and every year after, until you cancel.
        </li>
        <li>You set up autopay now. Your bank may show a small verification charge, which is refunded automatically.</li>
        <li>Cancel any time before the trial ends from Billing and you won&apos;t be charged; you keep access until the trial end date.</li>
      </ul>
    </div>
  );
}

/**
 * Verifies the signed-in account's own phone (code sent by WhatsApp to the
 * number on the account — it can't be changed here), then retries checkout.
 */
export function TrialPhoneVerification({
  onVerified,
  onSkipTrial,
  disabled,
}: {
  onVerified: () => void;
  onSkipTrial: () => void;
  disabled?: boolean;
}) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/billing/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        setError(json.error || 'Something went wrong. Please try again.');
        return null;
      }
      return json;
    } catch {
      setError('Network error — please try again.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-outline-variant bg-surface p-4 text-sm">
      <div className="mb-1 font-bold text-on-surface">Verify your phone to start the free trial</div>
      <p className="mb-3 text-on-surface-variant">
        We&apos;ll send a code by WhatsApp to the phone number on your account. One free trial per phone number.
      </p>
      {!codeSent ? (
        <button
          type="button"
          disabled={busy || disabled}
          onClick={async () => { if (await call({ action: 'send' })) setCodeSent(true); }}
          className="w-full rounded-lg bg-primary py-2.5 font-bold text-on-primary disabled:opacity-60"
        >
          {busy ? 'Sending…' : 'Send code on WhatsApp'}
        </button>
      ) : (
        <div className="flex gap-2">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder="Enter code"
            className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface px-3 py-2.5 text-on-surface outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={busy || disabled || code.length < 4}
            onClick={async () => { if (await call({ action: 'confirm', code })) onVerified(); }}
            className="shrink-0 rounded-lg bg-primary px-4 font-bold text-on-primary disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'Verify'}
          </button>
        </div>
      )}
      {error && <div role="alert" className="mt-2 text-xs font-medium text-error">{error}</div>}
      <button
        type="button"
        disabled={busy || disabled}
        onClick={onSkipTrial}
        className="mt-3 w-full text-center text-xs font-semibold text-on-surface-variant underline disabled:opacity-60"
      >
        Pay now without the free trial
      </button>
    </div>
  );
}
