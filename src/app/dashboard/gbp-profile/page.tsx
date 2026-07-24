'use client';

import { useEffect, useState } from 'react';
import { Loader2, MapPin, ShieldCheck, ExternalLink, Info } from 'lucide-react';
import { useBusiness } from '@/context/BusinessContext';

interface Profile {
  locationName: string;
  title: string;
  description: string;
  primaryPhone: string;
  website: string;
  primaryCategory: string;
  address: string;
}

const inputCls = 'w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors';

export default function GbpProfilePage() {
  const { activeBusiness } = useBusiness();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [liveWrites, setLiveWrites] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ title: '', description: '', primaryPhone: '', website: '' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/gbp/profile');
      const json = await res.json();
      setConnected(Boolean(json.connected));
      setLiveWrites(Boolean(json.liveWritesEnabled));
      if (json.success && json.profile) {
        setProfile(json.profile);
        setForm({
          title: json.profile.title ?? '',
          description: json.profile.description ?? '',
          primaryPhone: json.profile.primaryPhone ?? '',
          website: json.profile.website ?? '',
        });
      } else if (!json.connected) {
        setProfile(null);
      } else if (json.error) {
        setError(json.error);
      }
    } catch {
      setError('Could not load your Google Business Profile.');
    } finally {
      setLoading(false);
    }
  };

  // Reload when the active workspace changes.
  useEffect(() => { load(); }, [activeBusiness?._id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/gbp/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save.');
      setSaved(
        json.liveWriteApplied
          ? 'Saved and published to Google.'
          : 'Saved. Changes publish to Google automatically once profile verification is enabled.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-32"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;
  }

  return (
    <div className="max-w-3xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
          <MapPin className="w-6 h-6 text-indigo-600" /> Google Business Profile
        </h1>
        <p className="text-slate-500 mt-1">View and edit the live details on your Google profile.</p>
      </div>

      {/* Not connected */}
      {!connected && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center">
          <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 rounded-2xl mx-auto flex items-center justify-center mb-4">
            <ShieldCheck className="w-8 h-8 text-indigo-600" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Connect your Google Business Profile</h2>
          <p className="text-slate-500 mt-2 max-w-md mx-auto text-sm">
            Verify and connect your Google account, then choose the business location. We&apos;ll pull your live profile so you can manage it here.
          </p>
          {error && <p className="text-sm text-amber-600 mt-3">{error}</p>}
          <a
            href="/api/auth/google"
            className="inline-flex items-center gap-2 mt-6 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold transition-colors"
          >
            <ExternalLink className="w-4 h-4" /> Connect Google Business Profile
          </a>
        </div>
      )}

      {/* Connected — editor */}
      {connected && profile && (
        <div className="space-y-6">
          {!liveWrites && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Editing is in <strong>preview mode</strong>. Your changes are saved in GrowwMatics now and will
                publish to Google automatically once profile verification is enabled for your account.
              </span>
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>}
          {saved && <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700">{saved}</div>}

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Business name</label>
              <input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Description</label>
              <textarea rows={4} maxLength={750} className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              <p className="text-xs text-slate-400 text-right">{form.description.length}/750</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Primary phone</label>
                <input className={inputCls} value={form.primaryPhone} onChange={(e) => setForm({ ...form, primaryPhone: e.target.value })} placeholder="+91 …" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Website</label>
                <input className={inputCls} value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" />
              </div>
            </div>

            {/* Read-only context */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2 border-t border-slate-100">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Primary category</p>
                <p className="text-sm text-slate-700 mt-1">{profile.primaryCategory || '—'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Address</p>
                <p className="text-sm text-slate-700 mt-1">{profile.address || '—'}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : 'Save changes'}
            </button>
            <button onClick={load} disabled={saving} className="px-4 py-3 rounded-xl text-slate-500 hover:text-slate-800 font-medium transition-colors">
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Connected but profile failed to load */}
      {connected && !profile && error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
      )}
    </div>
  );
}
