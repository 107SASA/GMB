'use client';

import { useEffect, useState, useRef } from 'react';
import { SlidersHorizontal, AlertTriangle, Trash2, FileX, Check } from 'lucide-react';

interface Settings {
  supportEmail: string;
}

const DEFAULT_SETTINGS: Settings = {
  supportEmail: '',
};

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
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-error-container border border-error-container rounded-xl flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-error" />
          </div>
          <h3 className="text-base font-bold text-on-surface">{title}</h3>
        </div>
        <p className="text-sm text-on-surface-variant mb-5">{description}</p>

        {result ? (
          <div className="mb-5 p-4 bg-secondary-container/40 border border-secondary-fixed rounded-xl">
            <p className="text-sm font-bold text-on-secondary-container mb-2">Completed successfully</p>
            {result.deleted !== undefined && (
              <p className="text-xs text-secondary">{result.deleted} records deleted</p>
            )}
            {result.deletedCount !== undefined && (
              <p className="text-xs text-secondary">{result.deletedCount} records deleted</p>
            )}
            {result.data?.deleted && (
              <div className="space-y-0.5 mt-1">
                {Object.entries(result.data.deleted as Record<string, number>).map(([k, v]) => (
                  <p key={k} className="text-xs text-secondary">
                    {k}: {String(v)} deleted
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mb-5">
            <label className="block text-xs font-bold text-on-surface-variant mb-2 uppercase tracking-wider">
              Type CONFIRM to proceed
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="CONFIRM"
              className="w-full px-4 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-error-container focus:border-error"
            />
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 bg-surface-container text-on-surface font-semibold text-sm rounded-xl hover:bg-surface-container-high transition-colors"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={onConfirm}
              disabled={!ready || loading}
              className="flex-1 px-4 py-2.5 bg-error text-white font-bold text-sm rounded-xl hover:bg-error transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
      <label className="block text-sm font-semibold text-on-surface mb-1">{label}</label>
      {hint && <p className="text-xs text-outline mb-2">{hint}</p>}
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
      <div className="w-10 h-10 border-4 border-primary-fixed-dim border-t-primary rounded-full animate-spin" />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center card-shadow">
          <SlidersHorizontal className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Platform Settings</h1>
          <p className="text-sm text-on-surface-variant font-medium">Global configuration and operational controls</p>
        </div>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 bg-error-container border border-error-container rounded-xl text-sm text-on-error-container font-medium">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── Platform Config ──────────────────────────────────────────────── */}
        {/* Trimmed to just Support Email (Sep 2026 dead-code sweep) — this
            card used to also cover Platform Name, Default Trial Days, and a
            whole Usage Limits section (audits/posts/WhatsApp/cooldown) plus
            a Maintenance Mode toggle. None of those were ever read anywhere
            else in the app — editing them here did nothing. Real usage
            limits live in Admin → Customers' plan-limits editor (PlanConfig),
            not here. */}
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
          <h2 className="text-base font-bold text-on-surface mb-6">Platform Config</h2>

          <div className="space-y-5">
            <Field label="Support Email" hint="Used on the Support page as a mailto link">
              <input
                type="email"
                value={settings.supportEmail}
                onChange={e => setSettings(s => ({ ...s, supportEmail: e.target.value }))}
                placeholder="support@yourdomain.com"
                className="w-full px-4 py-2.5 border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
              />
            </Field>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-3 mt-6 pt-5 border-t border-outline-variant">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 bg-primary text-on-primary font-bold text-sm rounded-xl hover:bg-primary-container transition-colors disabled:opacity-60 shadow-sm"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saved && (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-secondary animate-in fade-in duration-200">
                <Check className="w-4 h-4" /> Saved
              </span>
            )}
          </div>
        </div>

        {/* ── Danger Zone ──────────────────────────────────────────────────── */}
        <div className="bg-surface-container-lowest rounded-xl border-2 border-error-container card-shadow p-6">
          <h2 className="text-base font-bold text-on-error-container mb-1">Danger Zone</h2>
          <p className="text-xs text-outline mb-6">Destructive actions. Each requires typing CONFIRM before executing.</p>

          <div className="space-y-4">
            {/* Flush demo data */}
            <div className="p-4 bg-error-container border border-error-container rounded-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-on-surface">Flush Demo Data</p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Permanently deletes all records where tenantId = &quot;demo-tenant&quot; from Lead, Review, Post, Conversation, ConversationThread, Customer, and ReviewRequest collections.
                  </p>
                </div>
                <button
                  onClick={() => setActiveModal('flush')}
                  className="shrink-0 flex items-center gap-2 px-4 py-2 bg-error text-white text-xs font-bold rounded-xl hover:bg-error transition-colors shadow-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Flush
                </button>
              </div>
            </div>

            {/* Clear automation logs */}
            <div className="p-4 bg-error-container border border-error-container rounded-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-on-surface">Clear Automation Logs</p>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Deletes all AutomationLog entries older than 90 days. Cannot be undone.
                  </p>
                </div>
                <button
                  onClick={() => setActiveModal('clear-logs')}
                  className="shrink-0 flex items-center gap-2 px-4 py-2 bg-error text-white text-xs font-bold rounded-xl hover:bg-error transition-colors shadow-sm"
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
