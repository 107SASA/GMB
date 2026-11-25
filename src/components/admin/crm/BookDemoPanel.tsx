'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';

const input = 'w-full px-3 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest text-sm';
const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

interface Slot { time: string; label: string }
interface Upcoming { date: string; timeSlot: string; status: string }

/**
 * Book a demo on the lead's behalf, e.g. after a call ("today 11 am works").
 * Same result as the customer booking it themselves: calendar event + Meet
 * link, WhatsApp confirmation and reminders sent by the Demo agent.
 */
export function BookDemoPanel({ leadId, leadEmail, upcoming, onBooked }: {
  leadId: string;
  leadEmail?: string | null;
  upcoming: Upcoming | null;
  onBooked: () => void;
}) {
  const [date, setDate] = useState(todayLocal());
  const [range, setRange] = useState<{ min?: string; max?: string; tz?: string }>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [time, setTime] = useState('');
  const [email, setEmail] = useState(leadEmail || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; link?: string } | null>(null);

  const loadSlots = useCallback(async (d: string) => {
    setLoadingSlots(true);
    setTime('');
    try {
      const res = await fetch(`/api/admin/crm/leads/${leadId}/book-demo?date=${d}`);
      const json = await res.json().catch(() => null);
      if (json?.success) {
        setSlots(json.slots || []);
        setRange({ min: json.minDate, max: json.maxDate, tz: json.timezone });
      } else {
        setSlots([]);
        setMsg({ ok: false, text: json?.error || 'Could not load open times.' });
      }
    } finally {
      setLoadingSlots(false);
    }
  }, [leadId]);

  useEffect(() => { if (!upcoming) loadSlots(date); }, [date, loadSlots, upcoming]);

  const book = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/crm/leads/${leadId}/book-demo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time, email: email || undefined, note: note || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setMsg({ ok: false, text: json?.error || 'Could not book the demo.' });
        if (json?.code === 'slot_unavailable') loadSlots(date);
        return;
      }
      const head = json.status === 'confirmed' ? `Demo booked for ${json.whenLabel}.` : `Slot saved for ${json.whenLabel} (Pending).`;
      const tail = json.whatsappSent ? ' WhatsApp confirmation sent — reminders go out automatically.' : json.whatsappNote ? ` ${json.whatsappNote}` : '';
      setMsg({ ok: json.whatsappSent || json.status === 'confirmed', text: head + tail, link: json.meetingLink });
      setNote('');
      onBooked();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow p-4">
      <h2 className="font-semibold text-sm text-on-surface mb-1 inline-flex items-center gap-1.5"><CalendarPlus className="w-4 h-4" /> Book a demo for them</h2>
      <p className="text-[11px] text-outline mb-3">
        Pick the time they told you. They get the Google Meet link on WhatsApp, then the 24h / 1h / 15 min reminders — the Demo agent takes it from here.
      </p>

      {upcoming ? (
        <p className="text-xs text-on-surface-variant">
          Already booked: <span className="font-semibold text-on-surface">{upcoming.date} · {upcoming.timeSlot}</span> ({upcoming.status}). To change it, use Reschedule on the Demos page.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <label>Date{range.tz ? ` (${range.tz})` : ''}
              <input type="date" className={`${input} mt-1`} value={date} min={range.min} max={range.max} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </label>
            <label>Email for the calendar invite (optional)
              <input type="email" className={`${input} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
            </label>
          </div>

          <div className="mt-3">
            <p className="text-xs text-on-surface-variant mb-1.5">Open times</p>
            {loadingSlots ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            ) : slots.length === 0 ? (
              <p className="text-xs text-outline">No open times on this day — try another date.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {slots.map((s) => (
                  <button
                    key={s.time}
                    type="button"
                    onClick={() => setTime(s.time)}
                    className={`text-xs px-2.5 py-1 rounded-md border ${time === s.time ? 'bg-primary text-white border-primary' : 'border-outline-variant text-on-surface hover:border-primary'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="block text-xs mt-3">Note for the calendar event (optional)
            <input className={`${input} mt-1`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Called them — wants to see review replies" />
          </label>

          <button onClick={book} disabled={busy || !time} className="mt-3 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-50">
            {busy ? 'Booking…' : 'Book demo & send WhatsApp'}
          </button>
        </>
      )}

      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-xs ${msg.ok ? 'text-secondary' : 'text-error'}`}>
          {msg.text}
          {msg.link && <> <a href={msg.link} target="_blank" rel="noreferrer" className="underline text-primary">Meet link</a></>}
        </p>
      )}
    </section>
  );
}
