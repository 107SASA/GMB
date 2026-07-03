'use client';

import React, { useEffect, useState } from 'react';
import { CalendarClock, Sparkles, Wallet, MessageSquareText } from 'lucide-react';

interface CustomerContext {
  customerName?: string;
  totalSpend: number;
  isReturningCustomer: boolean;
  lastAppointment?: { date: string; time: string; status: string; service?: string };
  upcomingAppointment?: { date: string; time: string; service?: string };
  serviceInterests: string[];
  preferredTimes: string[];
  importantNotes: string[];
  lastInteractionAt?: string;
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

export default function CustomerInsightsPanel({ leadId }: { leadId: string }) {
  const [context, setContext] = useState<CustomerContext | null>(null);
  const [bookingEnabled, setBookingEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leadId) return;
    setLoading(true);
    fetch(`/api/whatsapp/customer-context/${leadId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setContext(d.context);
          setBookingEnabled(d.bookingEnabled);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [leadId]);

  if (loading) {
    return <div className="w-72 shrink-0 border-l border-slate-100 p-4 text-xs text-slate-400">Loading insights...</div>;
  }
  if (!context) return null;

  const hasAnything =
    context.isReturningCustomer ||
    context.totalSpend > 0 ||
    context.lastAppointment ||
    context.upcomingAppointment ||
    context.serviceInterests.length > 0 ||
    context.importantNotes.length > 0;

  return (
    <div className="w-72 shrink-0 border-l border-slate-100 bg-slate-50/40 p-4 overflow-y-auto hidden lg:block">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" /> Customer Insights
      </p>

      {!hasAnything ? (
        <p className="text-xs text-slate-400">
          This looks like a new customer — no prior appointments or notes yet. Insights build up automatically as the AI Agent talks with them.
        </p>
      ) : (
        <div className="space-y-4">
          <span
            className={`inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              context.isReturningCustomer ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'
            }`}
          >
            {context.isReturningCustomer ? 'Returning customer' : 'New customer'}
          </span>

          {context.totalSpend > 0 && (
            <div className="flex items-start gap-2">
              <Wallet className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Lifetime Spend</p>
                <p className="text-sm font-bold text-slate-800">{context.totalSpend.toLocaleString()}</p>
              </div>
            </div>
          )}

          {context.upcomingAppointment && (
            <div className="flex items-start gap-2">
              <CalendarClock className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Upcoming Appointment</p>
                <p className="text-sm text-slate-800">
                  {formatDate(context.upcomingAppointment.date)} at {context.upcomingAppointment.time}
                  {context.upcomingAppointment.service ? ` · ${context.upcomingAppointment.service}` : ''}
                </p>
              </div>
            </div>
          )}

          {context.lastAppointment && (
            <div className="flex items-start gap-2">
              <CalendarClock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Last Appointment</p>
                <p className="text-sm text-slate-800">
                  {formatDate(context.lastAppointment.date)} at {context.lastAppointment.time}
                  <span className="text-slate-400"> · {context.lastAppointment.status}</span>
                </p>
              </div>
            </div>
          )}

          {context.serviceInterests.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Interested In</p>
              <div className="flex flex-wrap gap-1.5">
                {context.serviceInterests.map((s, i) => (
                  <span key={i} className="text-xs bg-white border border-slate-200 rounded-full px-2.5 py-0.5 text-slate-600">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {context.preferredTimes.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Preferred Times</p>
              <p className="text-xs text-slate-600">{context.preferredTimes.join(', ')}</p>
            </div>
          )}

          {context.importantNotes.length > 0 && (
            <div className="flex items-start gap-2">
              <MessageSquareText className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">AI Summary Notes</p>
                <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
                  {context.importantNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {!bookingEnabled && (
        <p className="text-[11px] text-slate-400 mt-6 pt-4 border-t border-slate-200">
          Appointment booking is off for this business. Turn it on in the Booking Settings tab to let the AI Agent
          book, cancel, and reschedule automatically.
        </p>
      )}
    </div>
  );
}
