'use client';

/**
 * SuperAdmin — Demos.
 *
 * Dedicated view over the existing DemoBooking model. Grouped (today /
 * upcoming / needs scheduling / completed / cancelled+no-show), with the
 * lead + business + post-demo outcome. Works BEFORE Google Calendar is
 * connected — calendar fields show as "not linked" and never block the view.
 *
 * Read: GET /api/admin/conversion/demos (grouped + counts).
 * Write: PATCH /api/admin/demo-bookings — status change, "Return to AI",
 * and attendance confirmation (Attended / No show / Declined / Not ready),
 * the only action that can schedule a post-demo WhatsApp message.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, CalendarClock, ExternalLink, UserCheck } from 'lucide-react';
import { RelTime } from '@/components/admin/conversion/primitives';

interface DemoRow {
  _id: string;
  leadId: string;
  lead: string | null;
  phone: string | null;
  business: string | null;
  email?: string | null;
  date: string;
  timeSlot: string;
  parsedStart: string | null;
  status: string;
  channel: string;
  meetingLink: string | null;
  calendarLinked: boolean;
  outcome: string | null;
  /** Outcome a person recorded for this demo time (null = unknown). */
  attendance: 'attended' | 'no_show' | 'declined' | 'not_ready' | 'team_missed' | null;
  /** Marked No Show by the automatic timeout — nobody has confirmed it. */
  attendanceUnconfirmed: boolean;
  canConfirmAttendance: boolean;
  createdAt: string;
  updatedAt: string;
}

const ATTENDANCE_OPTIONS: { value: NonNullable<DemoRow['attendance']>; label: string }[] = [
  { value: 'attended', label: 'Attended' },
  { value: 'no_show', label: 'No show' },
  { value: 'declined', label: 'Declined' },
  { value: 'not_ready', label: 'Not ready' },
  { value: 'team_missed', label: 'Our team missed it' },
];

interface Data {
  counts: Record<string, number>;
  groups: {
    today: DemoRow[];
    upcoming: DemoRow[];
    overdue: DemoRow[];
    needsScheduling: DemoRow[];
    completed: DemoRow[];
    cancelledOrNoShow: DemoRow[];
  };
  all: DemoRow[];
}

type TabKey = keyof Data['groups'] | 'all';

const STATUS_STYLE: Record<string, string> = {
  Pending: 'bg-primary-fixed text-primary',
  Confirmed: 'bg-secondary-container/50 text-on-secondary-container',
  Completed: 'bg-secondary-container/50 text-on-secondary-container',
  Cancelled: 'bg-error-container text-on-error-container',
  'No Show': 'bg-error-container text-on-error-container',
  Rescheduled: 'bg-warning/20 text-warning-text',
};

const STATUS_OPTIONS = ['Pending', 'Confirmed', 'Rescheduled', 'Completed', 'No Show', 'Cancelled'];

export default function DemosPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/conversion/demos');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setLoadError(json?.error || `Could not load demos (${res.status})`);
        return;
      }
      setData(json);
      // First load: land on the first tab that has something, so a fresh
      // booking is never hidden behind an empty default tab.
      setTab((cur) => {
        if (cur) return cur;
        const g = json.groups;
        const order: (keyof Data['groups'])[] = ['today', 'needsScheduling', 'upcoming', 'overdue', 'completed', 'cancelledOrNoShow'];
        return order.find((k) => (g[k] ?? []).length > 0) ?? 'upcoming';
      });
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load demos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const patch = async (body: Record<string, unknown>) => {
    setActionError(null);
    setActionNote(null);
    const res = await fetch('/api/admin/demo-bookings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setActionError(json?.error || 'Update failed');
      return;
    }
    if (body.status === 'Cancelled' || body.status === 'Rescheduled') {
      setActionNote(
        json?.customerNotified
          ? `Done — the customer was told on WhatsApp${body.status === 'Rescheduled' ? ' and asked to reply RESCHEDULE' : ''}.`
          : json?.notifyError
            ? `Done, but the WhatsApp message to the customer failed: ${json.notifyError}`
            : 'Done. No message sent (the demo was not upcoming, or the customer was already told).'
      );
    }
    load();
  };

  if (loading && !data) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (loadError && !data) {
    return (
      <div role="alert" className="rounded-xl border border-error-container bg-error-container/40 p-6 text-sm text-on-error-container">
        Couldn&apos;t load demos: {loadError}. <button onClick={load} className="underline font-semibold">Retry</button>
      </div>
    );
  }

  const c = data?.counts ?? {};
  const TABS: { key: TabKey; label: string; count: number }[] = [
    { key: 'today', label: 'Today', count: c.today ?? 0 },
    { key: 'upcoming', label: 'Upcoming', count: c.upcoming ?? 0 },
    { key: 'needsScheduling', label: 'Needs scheduling', count: (data?.groups.needsScheduling ?? []).length },
    { key: 'overdue', label: 'Needs outcome', count: c.overdue ?? 0 },
    { key: 'completed', label: 'Completed', count: c.completed ?? 0 },
    { key: 'cancelledOrNoShow', label: 'Cancelled / no-show / rescheduled', count: (c.cancelled ?? 0) + (c.noShow ?? 0) + (c.rescheduled ?? 0) },
    { key: 'all', label: 'All', count: c.total ?? 0 },
  ];
  const activeTab: TabKey = tab ?? 'upcoming';
  const rows = activeTab === 'all' ? data?.all ?? [] : data?.groups[activeTab] ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <CalendarClock className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Demos</h1>
          <p className="text-sm text-on-surface-variant">Every demo booking, grouped. Calendar links appear when Google Calendar is connected.</p>
        </div>
      </div>

      {/* Count strip */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          ['Total', c.total],
          ['Scheduled', c.scheduled],
          ['Today', c.today],
          ['Completed', c.completed],
          ['No-show', c.noShow],
          ['Cancelled', c.cancelled],
        ].map(([label, v]) => (
          <div key={label as string} className="bg-surface-container-lowest p-3 rounded-xl border border-outline-variant card-shadow">
            <p className="text-xs text-on-surface-variant">{label}</p>
            <p className="text-xl font-bold text-on-surface">{(v as number) ?? 0}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-outline-variant flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              activeTab === t.key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label} <span className="text-xs opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      {actionError && <p role="alert" className="text-sm text-error">{actionError}</p>}
      {actionNote && <p role="status" className="text-sm text-secondary">{actionNote}</p>}
      {loadError && data && <p role="alert" className="text-sm text-error">Couldn&apos;t refresh: {loadError}</p>}

      {/* Rows */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl card-shadow overflow-hidden">
        {rows.length === 0 ? (
          <p className="py-14 text-center text-sm text-outline">Nothing here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-label-sm text-on-surface-variant bg-surface-container-low">
                  <th className="text-left px-3 py-2.5">Lead</th>
                  <th className="text-left px-3 py-2.5">When</th>
                  <th className="text-left px-3 py-2.5">Channel</th>
                  <th className="text-left px-3 py-2.5">Meeting</th>
                  <th className="text-left px-3 py-2.5">Outcome</th>
                  <th className="text-left px-3 py-2.5">Attendance</th>
                  <th className="text-left px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {rows.map((r) => (
                  <tr key={r._id} className="hover:bg-surface transition-colors">
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/leads/${r.leadId}`} className="font-medium text-on-surface hover:text-primary">
                        {r.lead || r.phone || '—'}
                      </Link>
                      <div className="text-xs text-outline">{[r.business, r.phone, r.email].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs text-on-surface">{r.date} · {r.timeSlot}</div>
                      <div className="text-[11px] text-outline">
                        {r.parsedStart ? <RelTime date={r.parsedStart} /> : <>booked <RelTime date={r.createdAt} /></>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-on-surface-variant">{r.channel}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {r.meetingLink ? (
                        <a href={r.meetingLink} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">
                          link <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-outline">not linked</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-on-surface-variant">{r.outcome || '—'}</td>
                    <td className="px-3 py-2.5">
                      {r.canConfirmAttendance ? (
                        <div className="flex flex-wrap gap-1">
                          {ATTENDANCE_OPTIONS.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              onClick={() => patch({ bookingId: r._id, attendance: o.value })}
                              className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${
                                r.attendance === o.value
                                  ? 'bg-primary text-white border-primary'
                                  : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:border-primary'
                              }`}
                            >
                              {o.label}
                            </button>
                          ))}
                          {!r.attendance && (
                            <span className="text-[11px] text-outline w-full">
                              {r.attendanceUnconfirmed ? 'Auto-marked no-show — not confirmed, nothing sent' : 'Not recorded — nothing sent'}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-outline">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={r.status}
                        onChange={(e) => patch({ bookingId: r._id, status: e.target.value })}
                        className={`text-xs font-bold px-2 py-1 rounded-lg border-0 appearance-none cursor-pointer ${STATUS_STYLE[r.status] ?? 'bg-surface-container text-on-surface-variant'}`}
                      >
                        {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-outline">
        Attendance is recorded by a person after the demo has ended. <strong>Attended</strong> sends one follow-up a few hours later;
        <strong> No show</strong> sends one message offering to reschedule (replies go to the existing reschedule flow);
        <strong> Our team missed it</strong> sends one apology offering to reschedule; <strong>Declined</strong> and <strong>Not ready</strong> send nothing.
        Choosing <strong>Cancelled</strong> or <strong>Rescheduled</strong> in the status menu for an upcoming demo frees the calendar slot and tells the customer once; other status changes never send a message.
      </p>
      <p className="text-xs text-outline flex items-center gap-1.5">
        <UserCheck className="w-3.5 h-3.5" />
        A lead handed to a human mid-booking is released from the lead detail page or the pipeline.
      </p>
    </div>
  );
}
