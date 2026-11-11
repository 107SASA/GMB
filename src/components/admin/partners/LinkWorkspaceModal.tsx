'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

/**
 * Super admin: link a paying customer's workspace to this partner — for when
 * the automatic match missed it (e.g. the customer paid from a different
 * number than the partner's lead). The manual link wins over automatic
 * matching, and can credit the payments already made.
 */

interface Workspace {
  _id: string;
  name: string;
  city: string | null;
  subscriptionStatus: string | null;
  owner: { name?: string; phone?: string; email?: string | null } | null;
  partner: { id: string; name: string; code: string } | null;
  linkedByTeam: boolean;
}

export function LinkWorkspaceModal({ partner, onClose }: { partner: { _id: string; companyName: string }; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Workspace[]>([]);
  const [searching, setSearching] = useState(false);
  const [pick, setPick] = useState<Workspace | null>(null);
  const [creditPast, setCreditPast] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await fetch(`/api/admin/growth-partners/workspaces?q=${encodeURIComponent(q.trim())}`).then((x) => x.json()).catch(() => null);
      setRows(r?.success ? r.data : []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const link = async () => {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/growth-partners/workspaces/${pick._id}/partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerId: partner._id, creditPast }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not link');
      const c = json.data.credited;
      setDone(`${pick.name} is now linked to ${partner.companyName}. ${c?.created ? `${c.created} past payment(s) credited — ₹${c.amount.toLocaleString('en-IN')}.` : 'Future payments will earn commission.'}`);
    } catch (err: any) {
      setError(friendlyClientMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Link a customer" className="bg-surface-container-lowest rounded-xl border border-outline-variant w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold text-lg text-on-surface mb-1">Link a customer to {partner.companyName}</h2>
        <p className="text-sm text-on-surface-variant mb-4">
          Use this when a customer this partner brought isn’t credited to them — for example they signed up or paid with a different number.
        </p>

        {done ? (
          <p className="text-sm text-secondary">{done}</p>
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-outline" />
              <input
                autoFocus
                value={q}
                onChange={(e) => { setQ(e.target.value); setPick(null); }}
                placeholder="Business name, owner name, phone or email"
                aria-label="Search customers"
                className="w-full pl-9 pr-3 py-2 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {searching && <Loader2 className="w-4 h-4 animate-spin text-primary mx-auto" />}
            <ul className="divide-y divide-outline-variant border border-outline-variant rounded-xl max-h-64 overflow-y-auto">
              {rows.map((w) => (
                <li key={w._id}>
                  <button
                    onClick={() => setPick(w)}
                    className={`w-full text-left px-3 py-2.5 text-sm ${pick?._id === w._id ? 'bg-primary-fixed/50' : 'hover:bg-surface-container'}`}
                  >
                    <span className="font-semibold text-on-surface">{w.name}</span>
                    {w.city && <span className="text-on-surface-variant"> · {w.city}</span>}
                    <span className="block text-xs text-on-surface-variant">
                      {[w.owner?.name, w.owner?.phone, w.owner?.email].filter(Boolean).join(' · ')}
                      {w.subscriptionStatus ? ` · ${w.subscriptionStatus.replace('_', ' ')}` : ''}
                    </span>
                    {w.partner && (
                      <span className="block text-[11px] text-warning-text">
                        Currently credited to {w.partner.name}{w.linkedByTeam ? ' (linked by our team)' : ''}
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {!searching && q.trim().length >= 2 && rows.length === 0 && <li className="px-3 py-4 text-sm text-on-surface-variant text-center">No customers found.</li>}
            </ul>
            <label className="flex items-start gap-2 text-sm mt-4">
              <input type="checkbox" checked={creditPast} onChange={(e) => setCreditPast(e.target.checked)} className="mt-1" />
              <span>Also credit payments this customer already made (ones not yet credited to anyone)</span>
            </label>
            {pick?.partner && pick.partner.id !== partner._id && (
              <p className="text-xs text-warning-text mt-2">This moves future payments from {pick.partner.name} to {partner.companyName}. Commissions already created stay where they are.</p>
            )}
            {error && <p className="text-sm text-error mt-3">{error}</p>}
          </>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium bg-surface-container">{done ? 'Done' : 'Cancel'}</button>
          {!done && (
            <button onClick={link} disabled={busy || !pick} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Link to partner
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
