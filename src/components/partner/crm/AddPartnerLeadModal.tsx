'use client';

import { useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import { PartnerStageSelect } from './PartnerStageSelect';

const INPUT = 'w-full px-3 py-2 border border-outline-variant rounded-lg text-sm bg-surface-container-lowest focus:outline-none focus:ring-2 focus:ring-primary';

export function AddPartnerLeadModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [form, setForm] = useState({ name: '', business: '', phone: '+91', email: '', city: '', stage: 'NEW', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/partner/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not add the lead');
      onAdded();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not add the lead');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Add lead" className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-lg text-on-surface mb-4">Add a lead</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold mb-1">Contact name</span>
            <input value={form.name} onChange={(e) => set('name')(e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold mb-1">Business name</span>
            <input value={form.business} onChange={(e) => set('business')(e.target.value)} className={INPUT} />
          </label>
          <div className="sm:col-span-2">
            <span className="block text-xs font-semibold mb-1">Mobile number *</span>
            <PhoneNumberInput value={form.phone} onChange={set('phone')} className="rounded-lg [&_input]:py-2 [&_select]:py-2" />
          </div>
          <label className="block">
            <span className="block text-xs font-semibold mb-1">Email</span>
            <input type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} className={INPUT} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold mb-1">City</span>
            <input value={form.city} onChange={(e) => set('city')(e.target.value)} className={INPUT} />
          </label>
          <label className="block sm:col-span-2">
            <span className="block text-xs font-semibold mb-1">Stage</span>
            <PartnerStageSelect value={form.stage} onChange={set('stage')} className="w-full py-2 text-sm" />
          </label>
          <label className="block sm:col-span-2">
            <span className="block text-xs font-semibold mb-1">Note</span>
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes')(e.target.value)} className={INPUT} />
          </label>
        </div>
        <p className="text-[11px] text-on-surface-variant mt-3">
          A number that is already in our system can’t be added. We never send automated messages to your leads.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-error flex items-start gap-1.5">
            <MaterialIcon name="error" size={16} className="shrink-0 mt-0.5" />
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-surface-container">Cancel</button>
          <button onClick={save} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary disabled:opacity-50">
            {busy && <MaterialIcon name="progress_activity" size={16} className="animate-spin" />}
            Add lead
          </button>
        </div>
      </div>
    </div>
  );
}
