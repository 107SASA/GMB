'use client';

import { useCallback, useEffect, useState } from 'react';
import { PhoneIncoming, PhoneMissed } from 'lucide-react';

/**
 * Calls reported by the business's telephony provider whose caller is not a
 * lead yet. The owner decides: Save as Lead / Existing Lead / Dismiss.
 * Nothing is ever sent to the caller.
 */
export default function PendingCallsBanner({ leads, onChanged }: { leads: any[]; onChanged: () => void }) {
  const [calls, setCalls] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const [linkLeadId, setLinkLeadId] = useState('');
  const [callback, setCallback] = useState<Record<string, boolean>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/crm/calls?state=pending&limit=20');
      const data = await res.json();
      if (data.success) setCalls(data.calls);
    } catch { /* banner just stays hidden */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (id: string, body: Record<string, unknown>) => {
    setBusy(id);
    setError('');
    try {
      const res = await fetch(`/api/crm/calls/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return; }
      setLinking(null);
      setLinkLeadId('');
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  if (calls.length === 0) return null;

  return (
    <div className="mb-6 bg-surface-container-lowest border border-primary-fixed-dim rounded-2xl p-4 card-shadow">
      <p className="text-sm font-bold text-on-surface mb-1">
        {calls.length} call{calls.length === 1 ? '' : 's'} not saved as a lead
      </p>
      <p className="text-xs text-on-surface-variant mb-3">Save genuine prospects so you can follow up. Nothing is sent to the caller.</p>
      {error && <p className="text-xs text-error mb-2">{error}</p>}
      <div className="space-y-2">
        {calls.map((c) => (
          <div key={c._id} className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-surface border border-outline-variant">
            {c.outcome === 'missed'
              ? <PhoneMissed className="w-4 h-4 text-error shrink-0" />
              : <PhoneIncoming className="w-4 h-4 text-primary shrink-0" />}
            <div className="flex-1 min-w-[10rem]">
              <p className="text-sm font-semibold text-on-surface">{c.callerName || c.phone}</p>
              <p className="text-xs text-outline">
                {c.callerName ? `${c.phone} · ` : ''}{c.outcome === 'missed' ? 'Missed · ' : ''}
                {new Date(c.startedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            </div>
            {linking === c._id ? (
              <>
                <select value={linkLeadId} onChange={(e) => setLinkLeadId(e.target.value)} className="border border-outline-variant rounded-lg px-2 py-1.5 text-xs max-w-[12rem]">
                  <option value="">Choose lead…</option>
                  {leads.map((l) => <option key={l._id} value={l._id}>{l.name}{l.phone ? ` (${l.phone})` : ''}</option>)}
                </select>
                <button disabled={!linkLeadId || busy === c._id} onClick={() => act(c._id, { action: 'link', leadId: linkLeadId })} className="px-2.5 py-1.5 text-xs font-bold bg-primary text-white rounded-lg disabled:opacity-50">Link</button>
                <button onClick={() => setLinking(null)} className="px-2.5 py-1.5 text-xs font-semibold border border-outline-variant rounded-lg">Back</button>
              </>
            ) : (
              <>
                {c.outcome === 'missed' && (
                  <label className="flex items-center gap-1 text-[11px] text-on-surface-variant">
                    <input type="checkbox" checked={!!callback[c._id]} onChange={(e) => setCallback((p) => ({ ...p, [c._id]: e.target.checked }))} />
                    Callback task
                  </label>
                )}
                <button disabled={busy === c._id} onClick={() => act(c._id, { action: 'save', createCallbackTask: !!callback[c._id] })} className="px-2.5 py-1.5 text-xs font-bold bg-primary text-white rounded-lg disabled:opacity-50">Save as Lead</button>
                <button disabled={busy === c._id} onClick={() => setLinking(c._id)} className="px-2.5 py-1.5 text-xs font-semibold border border-outline-variant rounded-lg">Existing Lead</button>
                <button disabled={busy === c._id} onClick={() => act(c._id, { action: 'dismiss' })} className="px-2.5 py-1.5 text-xs font-semibold text-outline hover:text-on-surface">Dismiss</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
