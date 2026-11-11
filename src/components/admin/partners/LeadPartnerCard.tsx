'use client';

import { useCallback, useEffect, useState } from 'react';
import { Handshake, Loader2 } from 'lucide-react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

/**
 * Super admin, on a platform lead: which Growth Partner it's credited to,
 * and Assign / Change / Remove. "Credit only" keeps our funnel; "Partner
 * handles it" hands the lead over (AI off, it shows in their CRM).
 */

interface PartnerOption { _id: string; companyName: string; partnerCode: string; status: string }
interface Current { partner: { id: string; name: string; code: string } | null; source: string | null; isCustomer: boolean }

const SOURCE_TEXT: Record<string, string> = {
  added: 'Partner handles it — our AI stays off',
  referral: 'Came through their referral link — credit only',
  credit: 'Linked by our team — credit only',
};

export function LeadPartnerCard({ leadId, onChanged }: { leadId: string; onChanged?: () => void }) {
  const [current, setCurrent] = useState<Current | null>(null);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ partnerId: '', mode: 'credit', creditPast: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/crm/leads/${leadId}/partner`).then((x) => x.json()).catch(() => null);
    if (r?.success) setCurrent(r.data);
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const openEditor = async () => {
    setEditing(true);
    setError(null);
    setDone(null);
    setForm({ partnerId: current?.partner?.id ?? '', mode: current?.source === 'added' ? 'managed' : 'credit', creditPast: true });
    if (!partners.length) {
      const r = await fetch('/api/admin/growth-partners').then((x) => x.json()).catch(() => null);
      if (r?.success) setPartners((r.data as PartnerOption[]).filter((p) => p.status !== 'suspended'));
    }
  };

  const save = async (partnerId: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/leads/${leadId}/partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId, mode: form.mode, creditPast: form.creditPast }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save');
      const c = json.data.credited;
      setDone(
        partnerId
          ? `Assigned to ${json.data.partner?.name}.${c?.created ? ` ${c.created} past payment(s) credited — ₹${c.amount.toLocaleString('en-IN')}.` : ''}`
          : 'Partner removed.'
      );
      setEditing(false);
      await load();
      onChanged?.();
    } catch (err: any) {
      setError(friendlyClientMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Handshake className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm text-on-surface">Growth Partner</h3>
        </div>
        {!editing && (
          <button onClick={openEditor} className="text-xs font-medium text-primary">
            {current.partner ? 'Change' : 'Assign to partner'}
          </button>
        )}
      </div>

      {!editing && (
        <p className="text-sm mt-2">
          {current.partner ? (
            <>
              <span className="font-semibold text-on-surface">{current.partner.name}</span>{' '}
              <span className="text-xs text-on-surface-variant">({current.partner.code})</span>
              <span className="block text-xs text-on-surface-variant mt-0.5">{SOURCE_TEXT[current.source ?? 'added'] ?? SOURCE_TEXT.added}</span>
            </>
          ) : (
            <span className="text-on-surface-variant">Not credited to any partner — this is our own lead.</span>
          )}
        </p>
      )}
      {done && !editing && <p className="text-xs text-secondary mt-2">{done}</p>}

      {editing && (
        <div className="mt-3 space-y-3">
          <select
            value={form.partnerId}
            onChange={(e) => setForm({ ...form, partnerId: e.target.value })}
            className="w-full px-3 py-2 border border-outline-variant rounded-xl text-sm bg-surface-container-lowest"
            aria-label="Partner"
          >
            <option value="">Choose a partner…</option>
            {partners.map((p) => <option key={p._id} value={p._id}>{p.companyName} ({p.partnerCode})</option>)}
          </select>
          <div className="space-y-1.5 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={form.mode === 'credit'} onChange={() => setForm({ ...form, mode: 'credit' })} className="mt-1" />
              <span><strong>Credit only</strong> — we keep handling this lead (AI as normal); the partner gets the commission.</span>
            </label>
            <label className={`flex items-start gap-2 ${current.isCustomer ? 'opacity-50' : ''}`}>
              <input type="radio" name="mode" disabled={current.isCustomer} checked={form.mode === 'managed'} onChange={() => setForm({ ...form, mode: 'managed' })} className="mt-1" />
              <span><strong>Partner handles it</strong> — our AI stops messaging; it shows in their CRM as their lead.{current.isCustomer ? ' (not for a customer)' : ''}</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={form.creditPast} onChange={(e) => setForm({ ...form, creditPast: e.target.checked })} className="mt-1" />
              <span>Also credit payments this customer already made (if any were not credited yet)</span>
            </label>
          </div>
          {error && <p className="text-xs text-error">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => save(form.partnerId)} disabled={busy || !form.partnerId} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-on-primary disabled:opacity-50">
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Save
            </button>
            {current.partner && (
              <button onClick={() => { if (confirm('Remove the partner from this lead? Commissions already created stay.')) save(null); }} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-container text-error">
                Remove partner
              </button>
            )}
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-container">Cancel</button>
          </div>
          <p className="text-[11px] text-on-surface-variant">Commissions already created for a payment are never moved to another partner.</p>
        </div>
      )}
    </section>
  );
}
