'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface DealValue {
  value: number;
  currency: string;
  closedAt: string;
  notes?: string;
}

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];

/**
 * Asked when a lead is moved to Won / Sales Closed. Revenue and ROI are built
 * only from what the owner enters here — nothing is estimated. Cancel keeps
 * the lead where it was.
 */
export default function DealValueModal({
  leadName,
  initial,
  onCancel,
  onConfirm,
}: {
  leadName: string;
  initial?: Partial<DealValue> | null;
  onCancel: () => void;
  onConfirm: (deal: DealValue) => Promise<string | null> | string | null | void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [value, setValue] = useState(initial?.value != null ? String(initial.value) : '');
  const [currency, setCurrency] = useState(initial?.currency || 'INR');
  const [closedAt, setClosedAt] = useState((initial?.closedAt || today).slice(0, 10));
  const [notes, setNotes] = useState(initial?.notes || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) { setError('Enter the deal amount (0 or more).'); return; }
    setSaving(true);
    setError('');
    try {
      const err = await onConfirm({ value: n, currency, closedAt, notes: notes.trim() || undefined });
      if (err) setError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-sm border border-outline-variant">
        <div className="flex items-center justify-between p-5 border-b border-outline-variant">
          <div>
            <h2 className="text-base font-bold text-on-surface">Deal won 🎉</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">What was the deal value for {leadName}?</p>
          </div>
          <button onClick={onCancel} className="p-2 hover:bg-surface-container rounded-full transition-colors" aria-label="Cancel">
            <X className="w-4 h-4 text-on-surface-variant" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <p className="text-sm text-error bg-error-container rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="border border-outline-variant rounded-xl px-2 py-2.5 text-sm bg-surface-container-lowest"
              aria-label="Currency"
            >
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              ref={inputRef}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Amount, e.g. 25000"
              className="flex-1 border border-outline-variant rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Closed on</label>
            <input
              type="date"
              value={closedAt}
              max={today}
              onChange={(e) => setClosedAt(e.target.value)}
              className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1">Notes (optional)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 6-month package"
              className="w-full border border-outline-variant rounded-xl px-4 py-2.5 text-sm resize-none"
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onCancel} className="flex-1 px-4 py-2.5 border border-outline-variant text-on-surface font-semibold text-sm rounded-xl hover:bg-surface transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary-container disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-colors">
              {saving ? 'Saving…' : 'Mark as won'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
