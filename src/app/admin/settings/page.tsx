'use client';

import { useEffect, useState, useRef } from 'react';
import { SlidersHorizontal, AlertTriangle, Trash2, FileX, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Settings {
  platformName: string;
  supportEmail: string;
  maxAuditsPerBusiness: number;
  maxPostsPerMonth: number;
  maxWhatsAppMessagesPerDay: number;
  maintenanceMode: boolean;
  defaultTrialDays: number;
  reviewRequestCooldownDays: number;
}

const DEFAULT_SETTINGS: Settings = {
  platformName:              'GMBBoost',
  supportEmail:              '',
  maxAuditsPerBusiness:      10,
  maxPostsPerMonth:          50,
  maxWhatsAppMessagesPerDay: 100,
  maintenanceMode:           false,
  defaultTrialDays:          14,
  reviewRequestCooldownDays: 30,
};

// ── Toggle switch ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
        checked ? 'bg-rose-500' : 'bg-slate-200'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}

// ── Danger action modal ───────────────────────────────────────────────────────
function DangerModal({
  title, description, onCancel, onConfirm, loading, result,
}: {
  title: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading: boolean;
  result: any;
}) {
  const [confirmText, setConfirmText] = useState('');
  const ready = confirmText === 'CONFIRM';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-rose-50 border border-rose-100 rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
          </div>
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
        </div>
        <p className="text-sm text-slate-500 mb-5">{description}</p>

        {result ? (
          <div className="mb-5 p-4 bg-emerald-50 border border-emerald-100 rounded-xl">
            <p className="text-sm font-bold text-emerald-700 mb-2">Completed successfully</p>
            {result.deleted !== undefined && (
              <p className="text-xs text-emerald-600">{result.deleted} records deleted</p>
            )}
            {result.deletedCount !== undefined && (
              <p className="text-xs text-emerald-600">{result.deletedCount} records deleted</p>
            )}
            {result.data?.deleted && (
              <div className="space-y-0.5 mt-1">
                {Object.entries(result.data.deleted as Record<string, number>).map(([k, v]) => (
                  <p key={k} className="text-xs text-emerald-600">
                    {k}: {String(v)} deleted
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mb-5">
            <label className="block text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider">
              Type CONFIRM to proceed
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="CONFIRM"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-100 focus:border-rose-300"
            />
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 font-semibold text-sm rounded-xl hover:bg-slate-200 transition-colors"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={onConfirm}
              disabled={!ready || loading}
              className="flex-1 px-4 py-2.5 bg-rose-600 text-white font-bold text-sm rounded-xl hover:bg-rose-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'Running...' : 'Execute'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1">{label}</label>
      {hint && <p className="text-xs text-slate-400 mb-2">{hint}</p>}
      {children}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState('');

  // Danger zone modal state
  const [activeModal, setActiveModal] = useState<'flush' | 'clear-logs' | null>(null);
  const [dangerLoading, setDangerLoading] = useState(false);
  const [dangerResult, setDangerResult]   = useState<any>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(json => {
        if (json.success) setSettings(json.data);
        else setError(json.error || 'Failed to load settings');
      })
      .catch(() => setError('Network error loading settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const res  = await fetch('/api/admin/settings', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(settings),
      });
      const json = await res.json();
      if (json.success) {
        setSettings(json.data);
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 2000);
      } else {
        setError(json.error || 'Failed to save settings');
      }
    } catch {
      setError('Network error saving settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDangerAction = async () => {
    setDangerLoading(true);
    try {
      const endpoint =
        activeModal === 'flush'
          ? '/api/admin/settings/flush-demo'
          : '/api/admin/settings/clear-logs';
      const res  = await fetch(endpoint, { method: 'POST' });
      const json = await res.json();
      setDangerResult(json.success ? json : { error: json.error });
    } catch {
      setDangerResult({ error: 'Network error' });
    } finally {
      setDangerLoading(false);
    }
  };

  const closeModal = () => {
    setActiveModal(null);
    setDangerResult(null);
  };

  if (loading) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-md shadow-violet-600/20">
          <SlidersHorizontal className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Platform Settings</h1>
          <p className="text-sm text-slate-500 font-medium">Global configuration and operational controls</p>
        </div>
      </div>

      {/* Maintenance banner */}
      {settings.maintenanceMode && (
        <div className="mb-6 flex items-center gap-3 px-5 py-4 bg-rose-50 border border-rose-200 rounded-2xl">
          <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          <p className="text-sm font-bold text-rose-700">
            Maintenance mode is ON — all client dashboards are currently showing a maintenance banner.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-6 px-4 py-3 bg-rose-50 border border-rose-100 rounded-xl text-sm text-rose-600 font-medium">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Platform Config ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-base font-bold text-slate-900 mb-6">Platform Config</h2>

          <div className="space-y-5">
            <Field label="Platform Name">
              <input
                type="text"
                value={settings.platformName}
                onChange={e => setSettings(s => ({ ...s, platformName: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
              />
            </Field>

            <Field label="Support Email" hint="Used on the Support page as a mailto link">
              <input
                type="email"
                value={settings.supportEmail}
                onChange={e => setSettings(s => ({ ...s, supportEmail: e.target.value }))}
                placeholder="support@yourdomain.com"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
              />
            </Field>

            <Field label="Default Trial Days" hint="Days of free trial for new signups">
              <input
                type="number"
                min={1}
                max={90}
                value={settings.defaultTrialDays}
                onChange={e => setSettings(s => ({ ...s, defaultTrialDays: Number(e.target.value) }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
              />
            </Field>

            <div className="border-t border-slate-100 pt-5">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4">Usage Limits</p>
              <div className="space-y-4">
                <Field label="Max Audits per Business">
                  <input
                    type="number"
                    min={1}
                    value={settings.maxAuditsPerBusiness}
                    onChange={e => setSettings(s => ({ ...s, maxAuditsPerBusiness: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                  />
                </Field>
                <Field label="Max Posts per Month">
                  <input
                    type="number"
                    min={1}
                    value={settings.maxPostsPerMonth}
                    onChange={e => setSettings(s => ({ ...s, maxPostsPerMonth: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                  />
                </Field>
                <Field label="Max WhatsApp Messages / Day">
                  <input
                    type="number"
                    min={1}
                    value={settings.maxWhatsAppMessagesPerDay}
                    onChange={e => setSettings(s => ({ ...s, maxWhatsAppMessagesPerDay: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                  />
                </Field>
                <Field label="Review Request Cooldown (days)" hint="Minimum days between requests to the same customer">
                  <input
                    type="number"
                    min={1}
                    value={settings.reviewRequestCooldownDays}
                    onChange={e => setSettings(s => ({ ...s, reviewRequestCooldownDays: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-100 focus:border-violet-300"
                  />
                </Field>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Maintenance Mode</p>
                  <p className="text-xs text-slate-400 mt-0.5">Shows a maintenance banner to all non-admin users</p>
                </div>
                <Toggle
                  checked={settings.maintenanceMode}
                  onChange={v => setSettings(s => ({ ...s, maintenanceMode: v }))}
                />
              </div>
            </div>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3 mt-6 pt-5 border-t border-slate-100">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 bg-violet-600 text-white font-bold text-sm rounded-xl hover:bg-violet-700 transition-colors disabled:opacity-60 shadow-sm"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 animate-in fade-in duration-200">
                <Check className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </div>

        {/* ── Danger Zone ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border-2 border-rose-200 shadow-sm p-6">
          <h2 className="text-base font-bold text-rose-600 mb-1">Danger Zone</h2>
          <p className="text-xs text-slate-400 mb-6">Destructive actions. Each requires typing CONFIRM before executing.</p>

          <div className="space-y-4">
            {/* Flush demo data */}
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-slate-900">Flush Demo Data</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Permanently deletes all records where tenantId = &quot;demo-tenant&quot; from Lead, Review, Post, Conversation, ConversationThread, Customer, and ReviewRequest collections.
                  </p>
                </div>
                <button
                  onClick={() => setActiveModal('flush')}
                  className="shrink-0 flex items-center gap-2 px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-colors shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Flush
                </button>
              </div>
            </div>

            {/* Clear automation logs */}
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-slate-900">Clear Automation Logs</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Deletes all AutomationLog entries older than 90 days. Cannot be undone.
                  </p>
                </div>
                <button
                  onClick={() => setActiveModal('clear-logs')}
                  className="shrink-0 flex items-center gap-2 px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-xl hover:bg-rose-700 transition-colors shadow-sm"
                >
                  <FileX className="w-3.5 h-3.5" />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Danger modal */}
      {activeModal && (
        <DangerModal
          title={activeModal === 'flush' ? 'Flush Demo Data' : 'Clear Automation Logs'}
          description={
            activeModal === 'flush'
              ? 'This will permanently delete all demo-tenant records from 7 collections. This cannot be undone.'
              : 'This will permanently delete all AutomationLog entries older than 90 days. This cannot be undone.'
          }
          onCancel={closeModal}
          onConfirm={handleDangerAction}
          loading={dangerLoading}
          result={dangerResult}
        />
      )}
    </div>
  );
}
