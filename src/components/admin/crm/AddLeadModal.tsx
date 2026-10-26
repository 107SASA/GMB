'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, Loader2 } from 'lucide-react';
import { PhoneNumberInput } from '@/components/shared/PhoneNumberInput';
import { CRM_SOURCES } from '@/lib/admin/platformCrm';
import { StageSelect } from './StageSelect';

const input = 'w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm';

/** Add one lead by hand. A number already in the CRM opens that lead instead of duplicating it. */
export function AddLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (leadId: string) => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', businessType: '', city: '', source: 'Manual', stage: 'NEW', tags: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError(null);
    setExistingId(null);
    try {
      const res = await fetch('/api/admin/crm/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, tags: form.tags.split(/[;,]/).map((t) => t.trim()).filter(Boolean) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || 'Could not add the lead.');
        if (json?.leadId) setExistingId(json.leadId);
        return;
      }
      onCreated(json.leadId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true">
      <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-outline-variant">
          <h2 className="font-bold text-on-surface">Add lead</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-surface-container"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <label className="sm:col-span-2">Phone (WhatsApp) <span className="text-error">*</span>
            <PhoneNumberInput value={form.phone} onChange={set('phone')} className="mt-1 rounded-lg" />
          </label>
          <label>Name<input className={`${input} mt-1`} value={form.name} onChange={(e) => set('name')(e.target.value)} /></label>
          <label>Business name<input className={`${input} mt-1`} value={form.businessType} onChange={(e) => set('businessType')(e.target.value)} /></label>
          <label>Email<input type="email" className={`${input} mt-1`} value={form.email} onChange={(e) => set('email')(e.target.value)} /></label>
          <label>City<input className={`${input} mt-1`} value={form.city} onChange={(e) => set('city')(e.target.value)} /></label>
          <label>Source
            <select className={`${input} mt-1`} value={form.source} onChange={(e) => set('source')(e.target.value)}>
              {CRM_SOURCES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label>Stage<StageSelect value={form.stage} onChange={set('stage')} className="mt-1 w-full py-2 text-sm" /></label>
          <label className="sm:col-span-2">Tags <span className="text-outline text-xs">(comma-separated)</span>
            <input className={`${input} mt-1`} value={form.tags} onChange={(e) => set('tags')(e.target.value)} />
          </label>
          <label className="sm:col-span-2">Note
            <textarea rows={3} className={`${input} mt-1`} value={form.notes} onChange={(e) => set('notes')(e.target.value)} />
          </label>
          <p className="sm:col-span-2 text-xs text-outline">Adding a lead never messages them. Enter a name or a business name.</p>
          {error && (
            <p role="alert" className="sm:col-span-2 text-sm text-error">
              {error} {existingId && <Link href={`/admin/leads/${existingId}`} className="underline font-semibold">Open that lead</Link>}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-outline-variant">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm border border-outline-variant">Cancel</button>
          <button onClick={save} disabled={saving || !form.phone} className="px-4 py-2 rounded-xl text-sm font-semibold bg-primary text-white disabled:opacity-50 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Add lead
          </button>
        </div>
      </div>
    </div>
  );
}
