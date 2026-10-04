'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';

interface Policy {
  enabled: boolean;
  initialFollowUpDelayDays: number;
  secondFollowUpDelayDays: number;
  maximumFollowUps: number;
  minimumIntervalDays: number;
  stopOnOptOut: boolean;
}

const inputClass = 'w-full px-3 py-2 rounded-lg border border-outline-variant text-sm bg-surface-container-lowest';

export default function ReviewFollowUpAdminPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/review-follow-up');
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Could not load follow-up settings');
        return;
      }
      setPolicy(json.policy);
      setReviewNote(json.reviewCompletionStop?.reason || null);
    } catch {
      setError('Could not load follow-up settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!policy) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/review-follow-up', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(policy),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'Could not save follow-up settings');
        return;
      }
      setPolicy(json.policy);
      setNotice('Saved. Future review requests use this policy. Requests that already started their follow-up schedule keep that schedule.');
    } catch {
      setError('Could not save follow-up settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !policy) {
    return (
      <div className="py-16 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-outline" />
      </div>
    );
  }

  const setNumber = (
    key: 'initialFollowUpDelayDays' | 'secondFollowUpDelayDays' | 'maximumFollowUps' | 'minimumIntervalDays',
    value: string
  ) => {
    setPolicy(current => current ? { ...current, [key]: Number(value) } : current);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-heading text-2xl font-bold text-on-surface">Review follow-ups</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          One platform policy for every business. Businesses cannot see or change these timings.
        </p>
      </div>

      {error && (
        <p className="text-sm text-on-error-container bg-error-container border border-error rounded-xl px-4 py-3">{error}</p>
      )}
      {notice && (
        <p className="text-sm text-primary bg-primary-fixed border border-primary-fixed-dim rounded-xl px-4 py-3">{notice}</p>
      )}

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 space-y-5">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-bold text-on-surface">Follow-ups enabled</span>
          <input
            type="checkbox"
            checked={policy.enabled}
            onChange={e => setPolicy({ ...policy, enabled: e.target.checked })}
            className="w-4 h-4 accent-primary"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-bold text-on-surface mb-1.5">First follow-up delay (days after the initial request)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={policy.initialFollowUpDelayDays}
            onChange={e => setNumber('initialFollowUpDelayDays', e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="block text-sm font-bold text-on-surface mb-1.5">Second follow-up delay (days after the first follow-up)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={policy.secondFollowUpDelayDays}
            onChange={e => setNumber('secondFollowUpDelayDays', e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="block text-sm font-bold text-on-surface mb-1.5">Maximum follow-ups</span>
          <input
            type="number"
            min={0}
            max={2}
            value={policy.maximumFollowUps}
            onChange={e => setNumber('maximumFollowUps', e.target.value)}
            className={inputClass}
          />
          <p className="text-xs text-outline mt-1">0, 1, or 2. Two means: initial request, follow-up 1, follow-up 2, then stop.</p>
        </label>

        <label className="block">
          <span className="block text-sm font-bold text-on-surface mb-1.5">Minimum interval between follow-ups (days)</span>
          <input
            type="number"
            min={1}
            max={60}
            value={policy.minimumIntervalDays}
            onChange={e => setNumber('minimumIntervalDays', e.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex items-center justify-between gap-4 opacity-80">
          <span className="text-sm font-bold text-on-surface">Stop when the customer opts out</span>
          <input type="checkbox" checked disabled className="w-4 h-4 accent-primary" />
        </label>
        <p className="text-xs text-outline">
          Follow-ups also stop when the maximum is reached, or when the customer no longer has a phone, Place ID, or link to the business.
        </p>
        {reviewNote && <p className="text-xs text-outline">{reviewNote}</p>}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save policy
        </button>
      </div>
    </div>
  );
}
