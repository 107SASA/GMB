'use client';

import React, { useState, useEffect } from 'react';
import { useBusiness } from '@/context/BusinessContext';
import { CheckCircle2, Loader2 } from 'lucide-react';

interface WorkingDays {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
}

interface BookingSettings {
  bookingEnabled: boolean;
  timezone: string;
  workingDays: WorkingDays;
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
}

const DAY_ORDER: Array<{ key: keyof WorkingDays; label: string }> = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
];

const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

export default function BookingSettingsPanel() {
  const { activeBusiness } = useBusiness();
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeBusiness?._id) return;
    fetch('/api/whatsapp/business-hours')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setSettings(d.settings);
        else setError(d.error || 'Failed to load booking settings');
      })
      .catch(() => setError('Failed to load booking settings'));
  }, [activeBusiness?._id]);

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/business-hours', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        setSettings(data.settings);
        setSavedAt(Date.now());
        setTimeout(() => setSavedAt(null), 2500);
      } else {
        setError(data.error || 'Failed to save booking settings');
      }
    } catch (e) {
      setError('Failed to save booking settings');
    } finally {
      setSaving(false);
    }
  };

  if (!activeBusiness) return <div className="p-4 text-sm text-slate-500">Loading workspace...</div>;
  if (!settings) return <div className="p-4 text-sm text-slate-500">Loading booking settings...</div>;

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm max-w-2xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-lg font-bold text-slate-900">Appointment Booking</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md">
            Let the WhatsApp AI Agent book, cancel, and reschedule customer appointments automatically, inside the
            hours you set below. Turned off by default — nothing changes for customers until you enable it.
          </p>
        </div>
        <button
          onClick={() => setSettings({ ...settings, bookingEnabled: !settings.bookingEnabled })}
          className={`w-12 h-6 rounded-full relative transition-colors shrink-0 ${
            settings.bookingEnabled ? 'bg-emerald-500' : 'bg-slate-300'
          }`}
          aria-label="Toggle appointment booking"
        >
          <div
            className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${
              settings.bookingEnabled ? 'left-7' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className={`space-y-6 transition-opacity ${settings.bookingEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-2">Working Days</label>
          <div className="flex gap-2 flex-wrap">
            {DAY_ORDER.map(({ key, label }) => {
              const active = settings.workingDays[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    setSettings({
                      ...settings,
                      workingDays: { ...settings.workingDays, [key]: !active },
                    })
                  }
                  className={`w-12 h-10 rounded-xl text-xs font-bold border transition-colors ${
                    active
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Opening Time</label>
            <input
              type="time"
              value={settings.openingTime}
              onChange={(e) => setSettings({ ...settings, openingTime: e.target.value })}
              className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Closing Time</label>
            <input
              type="time"
              value={settings.closingTime}
              onChange={(e) => setSettings({ ...settings, closingTime: e.target.value })}
              className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Timezone</label>
            <select
              value={settings.timezone}
              onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
              className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
            >
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Slot Length (minutes)</label>
            <input
              type="number"
              min={5}
              max={240}
              step={5}
              value={settings.slotDurationMinutes}
              onChange={(e) => setSettings({ ...settings, slotDurationMinutes: Number(e.target.value) })}
              className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-600 mt-4">{error}</p>}

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm hover:bg-slate-800 transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        {savedAt && (
          <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
