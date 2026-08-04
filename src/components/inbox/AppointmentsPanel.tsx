'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useBusiness } from '@/context/BusinessContext';
import { CalendarClock, Phone, Mail, X, RefreshCw } from 'lucide-react';

interface HistoryEntry {
  action: string;
  previousDate?: string;
  previousTime?: string;
  newDate?: string;
  newTime?: string;
  note?: string;
  at: string;
}

interface WhatsAppAppointment {
  _id: string;
  customerName: string;
  phone: string;
  email?: string;
  serviceRequested?: string;
  date: string;
  time: string;
  status: 'Pending' | 'Confirmed' | 'Cancelled' | 'Completed';
  source: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  cancelReason?: string;
  history: HistoryEntry[];
}

const STATUS_FILTERS = ['All', 'Pending', 'Confirmed', 'Cancelled', 'Completed'] as const;

const STATUS_STYLES: Record<string, string> = {
  Pending: 'bg-error-container text-on-error-container',
  Confirmed: 'bg-secondary-container text-on-secondary-container',
  Cancelled: 'bg-surface-container-high text-on-surface-variant',
  Completed: 'bg-primary-fixed text-primary',
};

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatTime(timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export default function AppointmentsPanel() {
  const { activeBusiness } = useBusiness();
  const [appointments, setAppointments] = useState<WhatsAppAppointment[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchAppointments = useCallback(async () => {
    if (!activeBusiness?._id) return;
    setLoading(true);
    try {
      const qs = statusFilter !== 'All' ? `?status=${statusFilter}` : '';
      const res = await fetch(`/api/whatsapp/appointments${qs}`);
      const data = await res.json();
      if (data.success) setAppointments(data.appointments);
      else setError(data.error || 'Failed to load appointments');
    } catch (e) {
      setError('Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [activeBusiness?._id, statusFilter]);

  useEffect(() => {
    fetchAppointments();
    const interval = setInterval(fetchAppointments, 20000);
    return () => clearInterval(interval);
  }, [fetchAppointments]);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      const res = await fetch(`/api/whatsapp/appointments/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by business owner from dashboard' }),
      });
      const data = await res.json();
      if (data.success) {
        setAppointments((prev) => prev.map((a) => (a._id === id ? data.appointment : a)));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCancellingId(null);
    }
  };

  if (!activeBusiness) return <div className="p-4 text-sm text-on-surface-variant">Loading workspace...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-on-surface">Appointments</h3>
          <p className="text-xs text-on-surface-variant mt-1">Every booking made through the WhatsApp AI Agent, kept for full history — nothing is ever deleted.</p>
        </div>
        <button
          onClick={fetchAppointments}
          className="p-2 rounded-lg hover:bg-surface-container transition-colors text-on-surface-variant"
          aria-label="Refresh appointments"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex bg-surface-container p-1 rounded-lg w-fit mb-4">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-1 text-sm font-bold rounded-md transition-all ${
              statusFilter === s ? 'bg-surface-container-lowest shadow-sm text-on-surface' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="text-xs text-error mb-4">{error}</p>}

      {appointments.length === 0 && !loading ? (
        <div className="text-center text-sm text-outline py-16 bg-surface/50 rounded-2xl border border-dashed border-outline-variant">
          <CalendarClock className="w-8 h-8 mx-auto mb-3 text-outline" />
          No appointments yet. Once booking is enabled in Booking Settings, customer bookings made via WhatsApp will show up here.
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((appt) => (
            <div key={appt._id} className="bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-sm overflow-hidden">
              <div className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-on-surface truncate">{appt.customerName}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_STYLES[appt.status]}`}>
                      {appt.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-on-surface-variant mt-1 flex-wrap">
                    <span className="flex items-center gap-1">
                      <CalendarClock className="w-3.5 h-3.5" /> {formatDate(appt.date)} · {formatTime(appt.time)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Phone className="w-3.5 h-3.5" /> {appt.phone}
                    </span>
                    {appt.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5" /> {appt.email}
                      </span>
                    )}
                    {appt.serviceRequested && <span>· {appt.serviceRequested}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === appt._id ? null : appt._id)}
                    className="text-xs font-bold text-on-surface-variant hover:text-on-surface px-3 py-1.5 rounded-lg hover:bg-surface-container transition-colors"
                  >
                    {expandedId === appt._id ? 'Hide history' : 'History'}
                  </button>
                  {(appt.status === 'Pending' || appt.status === 'Confirmed') && (
                    <button
                      onClick={() => handleCancel(appt._id)}
                      disabled={cancellingId === appt._id}
                      className="text-xs font-bold text-error hover:text-on-error-container px-3 py-1.5 rounded-lg hover:bg-error-container transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      <X className="w-3.5 h-3.5" /> {cancellingId === appt._id ? 'Cancelling...' : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>

              {expandedId === appt._id && (
                <div className="border-t border-outline-variant bg-surface/60 p-4">
                  <p className="text-[10px] font-bold text-outline uppercase tracking-wider mb-2">Audit History</p>
                  <div className="space-y-2">
                    {appt.history.map((h, idx) => (
                      <div key={idx} className="text-xs text-on-surface-variant flex items-start gap-2">
                        <span className="text-outline shrink-0">{new Date(h.at).toLocaleString()}</span>
                        <span className="font-bold capitalize">{h.action}</span>
                        {h.action === 'rescheduled' && (
                          <span>
                            {h.previousDate} {h.previousTime} → {h.newDate} {h.newTime}
                          </span>
                        )}
                        {h.note && <span className="text-outline">({h.note})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
