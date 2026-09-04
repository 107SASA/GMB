'use client';

import { useState } from 'react';
import { Send, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

/**
 * Desktop counterpart to the mobile app's "Add Customer" quick-add card:
 * type a phone number (and optionally a name) and immediately fire a one-off
 * WhatsApp review request via /api/customers/quick-add — the same endpoint
 * and Inngest flow the mobile card and the per-customer "Send Review
 * Request" button already use.
 */
export default function QuickReviewRequest() {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    if (phone.replace(/\D/g, '').length < 8) {
      setResult({ ok: false, text: 'Enter a valid phone number first.' });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/customers/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, name: name.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not send the request.');

      if (json.reviewRequestSent) {
        setResult({ ok: true, text: `Review request sent on WhatsApp${json.existing ? ' (existing customer)' : ''}.` });
        setPhone('');
        setName('');
      } else {
        setResult({ ok: false, text: json.reason || 'Customer saved, but the review request could not be sent.' });
      }
    } catch (err) {
      setResult({ ok: false, text: friendlyClientMessage(err, 'Could not send the request.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Send className="w-4 h-4 text-primary" />
        <h2 className="text-sm font-bold text-on-surface">Quick review request</h2>
      </div>
      <p className="text-xs text-on-surface-variant mb-4">
        Enter a customer&apos;s number — we&apos;ll send them your Google review link on WhatsApp right away.
      </p>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-start">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="sm:w-44 border border-outline-variant rounded-xl px-3 py-2.5 text-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <div className="flex-1 min-w-0">
          <PhoneNumberInput
            value={phone}
            onChange={setPhone}
            className="rounded-xl [&_input]:py-2.5 [&_select]:py-2.5"
          />
        </div>
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-white text-sm font-semibold disabled:opacity-60 shrink-0"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send request
        </button>
      </div>

      {result && (
        <div
          className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
            result.ok
              ? 'bg-secondary-container/40 border border-secondary-fixed text-on-secondary-container'
              : 'bg-error-container border border-error-container text-on-error-container'
          }`}
        >
          {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {result.text}
        </div>
      )}
    </div>
  );
}
