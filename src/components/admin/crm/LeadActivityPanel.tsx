'use client';

import { useCallback, useEffect, useState } from 'react';
import { Phone, CalendarClock, Check, X } from 'lucide-react';
import { CALL_OUTCOMES, FOLLOW_UP_TYPES } from '@/lib/admin/platformCrm';
import { RelTime } from '@/components/admin/conversion/primitives';

const input = 'w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm';

/** ISO-ish local value for <input type="datetime-local"> */
const localValue = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

interface Call { at: string; payload: any; actorName?: string | null }
interface FollowUp { _id: string; type: string; note: string | null; dueAt: string; status: string; overdue: boolean; assignedTo: string | null }

/** Log a call and schedule / complete follow-ups for one lead. */
export function LeadActivityPanel({ leadId, calls, team, onChanged }: { leadId: string; calls: Call[]; team: { id: string; name: string }[]; onChanged: () => void }) {
  const [call, setCall] = useState({ direction: 'outbound', outcome: 'connected', durationMin: '', notes: '' });
  const [fu, setFu] = useState({ dueAt: localValue(new Date(Date.now() + 24 * 3600_000)), type: 'Call', note: '', assignedUserId: '' });
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'call' | 'fu' | null>(null);

  const loadFollowUps = useCallback(async () => {
    const res = await fetch(`/api/admin/crm/leads/${leadId}/follow-ups`);
    const json = await res.json().catch(() => null);
    if (json?.success) setFollowUps(json.followUps);
  }, [leadId]);
  useEffect(() => { loadFollowUps(); }, [loadFollowUps]);

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    return res.ok && json?.success ? null : json?.error || 'Something went wrong.';
  };

  const logCall = async () => {
    setBusy('call');
    setMsg(null);
    const err = await post(`/api/admin/crm/leads/${leadId}/calls`, call);
    setBusy(null);
    if (err) setMsg({ ok: false, text: err });
    else { setMsg({ ok: true, text: 'Call logged.' }); setCall({ ...call, durationMin: '', notes: '' }); onChanged(); }
  };
  const addFollowUp = async () => {
    setBusy('fu');
    setMsg(null);
    const err = await post(`/api/admin/crm/leads/${leadId}/follow-ups`, { ...fu, dueAt: new Date(fu.dueAt).toISOString(), assignedUserId: fu.assignedUserId || null });
    setBusy(null);
    if (err) setMsg({ ok: false, text: err });
    else { setMsg({ ok: true, text: 'Follow-up scheduled.' }); setFu({ ...fu, note: '' }); loadFollowUps(); onChanged(); }
  };
  const setStatus = async (id: string, status: string) => {
    await fetch(`/api/admin/crm/follow-ups/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    loadFollowUps();
    onChanged();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-4">
        <h2 className="font-semibold text-sm text-on-surface mb-3 inline-flex items-center gap-1.5"><Phone className="w-4 h-4" /> Log a call</h2>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>Direction
            <select className={`${input} mt-1`} value={call.direction} onChange={(e) => setCall({ ...call, direction: e.target.value })}>
              <option value="outbound">We called</option>
              <option value="inbound">They called</option>
            </select>
          </label>
          <label>Outcome
            <select className={`${input} mt-1`} value={call.outcome} onChange={(e) => setCall({ ...call, outcome: e.target.value })}>
              {CALL_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>Minutes<input inputMode="numeric" className={`${input} mt-1`} value={call.durationMin} onChange={(e) => setCall({ ...call, durationMin: e.target.value.replace(/\D/g, '') })} /></label>
          <label className="col-span-2">Notes<textarea rows={2} className={`${input} mt-1`} value={call.notes} onChange={(e) => setCall({ ...call, notes: e.target.value })} /></label>
        </div>
        <button onClick={logCall} disabled={busy === 'call'} className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50">Log call</button>
        <ul className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
          {calls.length === 0 && <li className="text-xs text-outline">No calls logged.</li>}
          {calls.map((c, i) => (
            <li key={i} className="text-xs border-l-2 border-outline-variant pl-2">
              <span className="font-semibold">{c.payload?.direction === 'inbound' ? 'They called' : 'We called'} · {c.payload?.outcomeLabel}</span>
              {c.payload?.durationMin != null && <span> · {c.payload.durationMin} min</span>}
              {c.payload?.notes && <p className="text-on-surface-variant whitespace-pre-wrap">{c.payload.notes}</p>}
              <p className="text-outline">{c.actorName || 'Team'} · <RelTime date={c.payload?.at || c.at} /></p>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-4">
        <h2 className="font-semibold text-sm text-on-surface mb-3 inline-flex items-center gap-1.5"><CalendarClock className="w-4 h-4" /> Follow-ups</h2>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>When<input type="datetime-local" className={`${input} mt-1`} value={fu.dueAt} onChange={(e) => setFu({ ...fu, dueAt: e.target.value })} /></label>
          <label>Type
            <select className={`${input} mt-1`} value={fu.type} onChange={(e) => setFu({ ...fu, type: e.target.value })}>
              {FOLLOW_UP_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Remind
            <select className={`${input} mt-1`} value={fu.assignedUserId} onChange={(e) => setFu({ ...fu, assignedUserId: e.target.value })}>
              <option value="">Lead owner (or me)</option>
              {team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label>Note<input className={`${input} mt-1`} value={fu.note} onChange={(e) => setFu({ ...fu, note: e.target.value })} /></label>
        </div>
        <button onClick={addFollowUp} disabled={busy === 'fu' || !fu.dueAt} className="mt-2 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50">Schedule</button>
        <p className="text-[11px] text-outline mt-1">A reminder for your team — the lead is never messaged.</p>
        <ul className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
          {followUps.length === 0 && <li className="text-xs text-outline">No follow-ups.</li>}
          {followUps.map((f) => (
            <li key={f._id} className="text-xs flex items-start justify-between gap-2 border-l-2 pl-2 border-outline-variant">
              <div>
                <span className={`font-semibold ${f.status !== 'pending' ? 'line-through text-outline' : f.overdue ? 'text-error' : ''}`}>{f.type}{f.note ? ` — ${f.note}` : ''}</span>
                <p className="text-outline">{new Date(f.dueAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}{f.assignedTo ? ` · ${f.assignedTo}` : ''} · {f.status === 'pending' ? (f.overdue ? 'overdue' : 'open') : f.status}</p>
              </div>
              {f.status === 'pending' && (
                <span className="flex gap-1 shrink-0">
                  <button onClick={() => setStatus(f._id, 'completed')} title="Done" className="p-1 rounded border border-outline-variant"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setStatus(f._id, 'cancelled')} title="Cancel" className="p-1 rounded border border-outline-variant"><X className="w-3.5 h-3.5" /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${msg.ok ? 'text-secondary' : 'text-error'}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
