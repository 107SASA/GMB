'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, X, Clock } from 'lucide-react';

const TYPES = ['Call', 'WhatsApp', 'Email', 'Meeting', 'Other'] as const;

/** Local "YYYY-MM-DDTHH:mm" for <input type="datetime-local">. */
function localInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Follow-up TASKS for one lead — reminders for the owner/team ("Call Rahul
 * tomorrow 11:00"). Nothing is sent to the lead; the owner gets a reminder
 * when it's due and contacts the lead themselves.
 */
export default function FollowUpTasks({ leadId, onChanged }: { leadId: string; onChanged?: () => void }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<(typeof TYPES)[number]>('Call');
  const [dueAt, setDueAt] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    d.setHours(11, 0, 0, 0);
    return localInputValue(d);
  });
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/followups?leadId=${leadId}`);
      const data = await res.json();
      if (data.success) setTasks(data.followUps);
    } catch { /* list stays as is */ }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, type, dueAt: new Date(dueAt).toISOString(), note }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save the follow-up.'); return; }
      setAdding(false);
      setNote('');
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const act = async (id: string, action: 'complete' | 'cancel') => {
    setBusy(true);
    try {
      await fetch(`/api/followups/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await load();
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const pending = tasks.filter((t) => t.status === 'pending');
  const done = tasks.filter((t) => t.status !== 'pending').slice(0, 5);
  const now = Date.now();

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-on-surface">Follow-ups</h3>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs font-bold text-primary hover:underline">+ Add follow-up</button>
        )}
      </div>

      {adding && (
        <div className="bg-surface border border-outline-variant rounded-2xl p-4 mb-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${type === t ? 'bg-primary text-white border-primary' : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Discuss quotation"
            className="w-full border border-outline-variant rounded-xl px-3 py-2 text-sm"
          />
          {error && <p className="text-xs text-error">{error}</p>}
          <p className="text-[11px] text-on-surface-variant">You&apos;ll get a reminder when it&apos;s due. Nothing is sent to the lead.</p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setError(''); }} className="px-3 py-1.5 text-xs font-semibold border border-outline-variant rounded-lg">Cancel</button>
            <button onClick={create} disabled={busy} className="px-3 py-1.5 text-xs font-bold bg-primary text-white rounded-lg disabled:opacity-50">Save</button>
          </div>
        </div>
      )}

      {pending.length === 0 && !adding && (
        <p className="text-xs text-outline">No follow-up scheduled.</p>
      )}

      <div className="space-y-2">
        {pending.map((t) => {
          const overdue = new Date(t.scheduledFor).getTime() < now;
          return (
            <div key={t._id} className={`flex items-start gap-3 p-3 rounded-xl border ${overdue ? 'border-error bg-error-container/30' : 'border-outline-variant bg-surface-container-lowest'}`}>
              <Clock className={`w-4 h-4 mt-0.5 shrink-0 ${overdue ? 'text-error' : 'text-primary'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-on-surface">
                  {t.type || 'Task'} · {new Date(t.scheduledFor).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  {overdue && <span className="ml-2 text-[10px] font-bold uppercase text-error">Overdue</span>}
                </p>
                {t.note && <p className="text-xs text-on-surface-variant mt-0.5 break-words">{t.note}</p>}
              </div>
              <button title="Mark done" disabled={busy} onClick={() => act(t._id, 'complete')} className="p-1.5 rounded-lg hover:bg-secondary-container text-secondary disabled:opacity-50">
                <Check className="w-4 h-4" />
              </button>
              <button title="Cancel" disabled={busy} onClick={() => act(t._id, 'cancel')} className="p-1.5 rounded-lg hover:bg-surface-container text-outline disabled:opacity-50">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
        {done.map((t) => (
          <div key={t._id} className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs text-outline">
            <span className={t.status === 'completed' ? 'line-through' : ''}>{t.type || 'Task'} · {new Date(t.scheduledFor).toLocaleDateString('en-IN')}</span>
            <span className="uppercase font-bold">{t.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
