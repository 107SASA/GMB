'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';

type Unit = 'minutes' | 'hours' | 'days';

interface FollowUp {
  id: string;
  enabled: boolean;
  delayMinutes: number;
  onlyIfNoReply: boolean;
  description: string;
}

interface QuietHours {
  enabled: boolean;
  start: string;
  end: string;
}

interface NurtureConfig {
  enabled: boolean;
  rolloutPercentage: number;
  timezone: string;
  quietHours: QuietHours;
  minimumMessageGapMinutes: number;
  maxNurtureMessages: number;
  firstMessage: { enabled: boolean; delayMinutes: number };
  followUps: FollowUp[];
  leadIdAllowlist: string[];
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface Preview {
  name: string | null;
  leadScore: number;
  intent: string | null;
  nextBestAction: string | null;
  nurtureEligible: boolean;
  reason: string;
  nextPossibleAction: string;
}

const cls = 'w-full px-3 py-2 rounded-lg border border-outline-variant text-sm bg-surface-container-lowest';

function displayDelay(minutes: number): { value: number; unit: Unit } {
  if (minutes >= 7 * 24 * 60 && minutes % (24 * 60) === 0) return { value: minutes / (24 * 60), unit: 'days' };
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

function toMinutes(value: number, unit: Unit): number {
  if (unit === 'days') return value * 24 * 60;
  if (unit === 'hours') return value * 60;
  return value;
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative w-12 h-6 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-outline'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-surface-container-lowest rounded-full transition-transform ${on ? 'translate-x-6' : ''}`} />
    </button>
  );
}

export default function NurtureConfigPage() {
  const [config, setConfig] = useState<NurtureConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [allowId, setAllowId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/nurture-config');
      const json = await res.json();
      if (!json.success) setError(json.error || 'Could not load configuration');
      else setConfig(json.config);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/nurture-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!json.success) setError(json.error || 'Save failed');
      else {
        setNotice(`Saved as version ${json.version}. Running sequences keep the version they started with.`);
        await load();
      }
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setPreview(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/nurture-config/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: previewId.trim() }),
      });
      const json = await res.json();
      if (!json.success) setError(json.error || 'Preview failed');
      else setPreview(json.preview);
    } finally {
      setPreviewing(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }
  if (!config) return <div className="p-8 text-error">{error || 'Configuration unavailable'}</div>;

  const first = displayDelay(config.firstMessage.delayMinutes);

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <h1 className="font-heading text-2xl font-bold text-on-surface">Nurturing Configuration</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Timing and rollout for the existing sales nurture sequence. Version {config.version}.
          Intelligence, consent, opt-out, and human handoff still decide whether a message may send.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {notice && <p className="text-sm text-secondary">{notice}</p>}

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 space-y-4">
        <h2 className="font-semibold text-sm">Global controls</h2>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Nurturing enabled</span>
          <Toggle on={config.enabled} onChange={(enabled) => setConfig({ ...config, enabled })} />
        </label>
        <label className="block text-sm">
          Rollout percentage
          <input
            type="number"
            min={0}
            max={100}
            className={`${cls} mt-1`}
            value={config.rolloutPercentage}
            onChange={(e) => setConfig({ ...config, rolloutPercentage: Number(e.target.value) })}
          />
          <span className="block text-xs text-outline mt-1">0% selects no proactive cohort unless a lead is allowlisted. It does not bypass safety checks.</span>
        </label>
        <label className="block text-sm">
          Timezone
          <input className={`${cls} mt-1`} value={config.timezone} onChange={(e) => setConfig({ ...config, timezone: e.target.value })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Quiet hours</span>
          <Toggle
            on={config.quietHours.enabled}
            onChange={(enabled) => setConfig({ ...config, quietHours: { ...config.quietHours, enabled } })}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Start
            <input className={`${cls} mt-1`} value={config.quietHours.start} onChange={(e) => setConfig({ ...config, quietHours: { ...config.quietHours, start: e.target.value } })} />
          </label>
          <label className="text-sm">End
            <input className={`${cls} mt-1`} value={config.quietHours.end} onChange={(e) => setConfig({ ...config, quietHours: { ...config.quietHours, end: e.target.value } })} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Minimum message gap (minutes)
            <input type="number" min={0} className={`${cls} mt-1`} value={config.minimumMessageGapMinutes} onChange={(e) => setConfig({ ...config, minimumMessageGapMinutes: Number(e.target.value) })} />
          </label>
          <label className="text-sm">Maximum nurture messages
            <input type="number" min={0} max={20} className={`${cls} mt-1`} value={config.maxNurtureMessages} onChange={(e) => setConfig({ ...config, maxNurtureMessages: Number(e.target.value) })} />
          </label>
        </div>
      </section>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-sm">First message</h2>
        <label className="flex items-center justify-between text-sm">
          <span>Enabled</span>
          <Toggle on={config.firstMessage.enabled} onChange={(enabled) => setConfig({ ...config, firstMessage: { ...config.firstMessage, enabled } })} />
        </label>
        <DelayEditor
          minutes={config.firstMessage.delayMinutes}
          units={['minutes', 'hours']}
          onChange={(delayMinutes) => setConfig({ ...config, firstMessage: { ...config.firstMessage, delayMinutes } })}
        />
        <p className="text-xs text-outline">Currently {first.value} {first.unit}. Stored production default is 2 minutes until this is saved.</p>
      </section>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Follow-up sequence</h2>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
            onClick={() => setConfig({
              ...config,
              followUps: [...config.followUps, {
                id: `follow-up-${Date.now()}`,
                enabled: true,
                delayMinutes: 24 * 60,
                onlyIfNoReply: true,
                description: '',
              }],
            })}
          >
            <Plus className="w-3.5 h-3.5" /> Add step
          </button>
        </div>
        {config.followUps.map((step, index) => (
          <div key={step.id} className="border border-outline-variant rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Step {index + 1}</span>
              <button
                type="button"
                className="text-error"
                onClick={() => setConfig({ ...config, followUps: config.followUps.filter((row) => row.id !== step.id) })}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            <DelayEditor
              minutes={step.delayMinutes}
              units={['minutes', 'hours', 'days']}
              onChange={(delayMinutes) => {
                const followUps = config.followUps.slice();
                followUps[index] = { ...step, delayMinutes };
                setConfig({ ...config, followUps });
              }}
            />
            <label className="flex items-center justify-between text-sm">
              <span>Enabled</span>
              <Toggle on={step.enabled} onChange={(enabled) => {
                const followUps = config.followUps.slice();
                followUps[index] = { ...step, enabled };
                setConfig({ ...config, followUps });
              }} />
            </label>
            <label className="flex items-center justify-between text-sm">
              <span>Only if no reply</span>
              <Toggle on={step.onlyIfNoReply} onChange={(onlyIfNoReply) => {
                const followUps = config.followUps.slice();
                followUps[index] = { ...step, onlyIfNoReply };
                setConfig({ ...config, followUps });
              }} />
            </label>
            <input
              className={cls}
              placeholder="Optional description"
              value={step.description}
              onChange={(e) => {
                const followUps = config.followUps.slice();
                followUps[index] = { ...step, description: e.target.value };
                setConfig({ ...config, followUps });
              }}
            />
            <div className="flex gap-2 text-xs">
              <button type="button" disabled={index === 0} className="disabled:opacity-40" onClick={() => move(config, index, -1, setConfig)}>Move up</button>
              <button type="button" disabled={index === config.followUps.length - 1} className="disabled:opacity-40" onClick={() => move(config, index, 1, setConfig)}>Move down</button>
            </div>
          </div>
        ))}
      </section>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-sm">Allowlist</h2>
        <p className="text-xs text-outline">Controlled cohort testing. An allowlisted lead still cannot bypass opt-out, human handoff, customer state, or consent.</p>
        <div className="flex gap-2">
          <input className={cls} placeholder="Lead id" value={allowId} onChange={(e) => setAllowId(e.target.value)} />
          <button
            type="button"
            className="px-3 rounded-lg bg-primary text-white text-sm"
            onClick={() => {
              const id = allowId.trim();
              if (!id || config.leadIdAllowlist.includes(id)) return;
              setConfig({ ...config, leadIdAllowlist: [...config.leadIdAllowlist, id] });
              setAllowId('');
            }}
          >Add</button>
        </div>
        <ul className="text-xs space-y-1">
          {config.leadIdAllowlist.length === 0 && <li className="text-outline">Allowlist is empty.</li>}
          {config.leadIdAllowlist.map((id) => (
            <li key={id} className="flex items-center justify-between">
              <span className="font-mono">{id}</span>
              <button type="button" className="text-error" onClick={() => setConfig({ ...config, leadIdAllowlist: config.leadIdAllowlist.filter((row) => row !== id) })}>Remove</button>
            </li>
          ))}
        </ul>
        {config.leadIdAllowlist.length > 0 && (
          <button type="button" className="text-xs text-error" onClick={() => setConfig({ ...config, leadIdAllowlist: [] })}>Clear allowlist</button>
        )}
      </section>

      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-sm">Preview nurture decision</h2>
        <p className="text-xs text-outline">Read only. This does not send a message, create a schedule, or change the lead.</p>
        <div className="flex gap-2">
          <input className={cls} placeholder="Lead id" value={previewId} onChange={(e) => setPreviewId(e.target.value)} />
          <button type="button" disabled={previewing} className="px-3 rounded-lg border border-outline-variant text-sm" onClick={runPreview}>
            {previewing ? 'Checking…' : 'Preview'}
          </button>
        </div>
        {preview && (
          <div className="text-sm space-y-1">
            <p>Lead: {preview.name || '—'}</p>
            <p>Score: {preview.leadScore}</p>
            <p>Intent: {preview.intent || '—'}</p>
            <p>NBA: {preview.nextBestAction || '—'}</p>
            <p>Nurture eligible: {preview.nurtureEligible ? 'YES' : 'NO'}</p>
            <p>Reason: {preview.reason}</p>
            <p>Next possible action: {preview.nextPossibleAction}</p>
          </div>
        )}
      </section>

      <button type="button" disabled={saving} onClick={save} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-60">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save configuration
      </button>
    </div>
  );
}

function DelayEditor({
  minutes,
  units,
  onChange,
}: {
  minutes: number;
  units: Unit[];
  onChange: (minutes: number) => void;
}) {
  const shown = displayDelay(minutes);
  const unit = units.includes(shown.unit) ? shown.unit : 'minutes';
  const value = unit === shown.unit ? shown.value : minutes;
  return (
    <div className="flex gap-2">
      <input
        type="number"
        min={1}
        className={cls}
        value={value}
        onChange={(e) => onChange(toMinutes(Number(e.target.value), unit))}
      />
      <select
        className={cls}
        value={unit}
        onChange={(e) => onChange(toMinutes(value, e.target.value as Unit))}
      >
        {units.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </div>
  );
}

function move(config: NurtureConfig, index: number, delta: number, setConfig: (c: NurtureConfig) => void) {
  const next = config.followUps.slice();
  const target = index + delta;
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  setConfig({ ...config, followUps: next });
}
