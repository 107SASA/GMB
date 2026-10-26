'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Check, Loader2 } from 'lucide-react';
import { RelTime } from '@/components/admin/conversion/primitives';

export interface FollowUpRow {
  _id: string;
  leadId: string;
  leadName: string;
  type: string;
  note: string | null;
  dueAt: string;
  status: string;
  overdue: boolean;
  assignedTo: string | null;
}

/** The team's open follow-ups, soonest first; mark done from here. */
export function FollowUpsPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<FollowUpRow[]>([]);
  const [mine, setMine] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/crm/follow-ups${mine ? '?mine=1' : ''}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not load follow-ups');
      setRows(json.followUps);
    } catch (e: any) {
      setError(e?.message);
    } finally {
      setLoading(false);
    }
  }, [mine]);
  useEffect(() => { load(); }, [load]);

  const done = async (id: string) => {
    const res = await fetch(`/api/admin/crm/follow-ups/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'completed' }) });
    if (res.ok) setRows((cur) => cur.filter((r) => r._id !== id));
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-surface-container-lowest w-full max-w-md h-full overflow-y-auto border-l border-outline-variant">
        <div className="flex items-center justify-between p-5 border-b border-outline-variant">
          <div>
            <h2 className="font-bold text-on-surface">Follow-ups</h2>
            <p className="text-xs text-on-surface-variant">Open reminders for the team. A push reminder goes out when each is due.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-surface-container"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-2">
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only mine</label>
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : error ? <p role="alert" className="text-sm text-error">{error}</p> : rows.length === 0 ? (
            <p className="text-sm text-outline py-6 text-center">Nothing open.</p>
          ) : rows.map((r) => (
            <div key={r._id} className={`rounded-lg border p-3 ${r.overdue ? 'border-error-container bg-error-container/20' : 'border-outline-variant'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/admin/leads/${r.leadId}`} className="font-medium text-sm text-on-surface hover:text-primary">{r.leadName}</Link>
                  <p className="text-xs text-on-surface-variant">{r.type}{r.note ? ` — ${r.note}` : ''}</p>
                  <p className={`text-[11px] ${r.overdue ? 'text-error font-semibold' : 'text-outline'}`}>
                    {r.overdue ? 'Overdue · ' : 'Due '}{new Date(r.dueAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} (<RelTime date={r.dueAt} />){r.assignedTo ? ` · ${r.assignedTo}` : ''}
                  </p>
                </div>
                <button onClick={() => done(r._id)} title="Mark done" className="p-1.5 rounded-lg border border-outline-variant hover:bg-secondary-container/40"><Check className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
