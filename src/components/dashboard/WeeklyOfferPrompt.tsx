'use client';

import { useEffect, useState } from 'react';
import { Megaphone, X } from 'lucide-react';
import { toast } from 'sonner';
import { useBusiness } from '@/context/BusinessContext';

/**
 * Weekly "Anything to promote this week?" question (Sep 2026). Asked once per
 * business per week — the answer (yes / nothing this week / dismissed) is
 * stored server-side as a WeeklyOffer, so it doesn't reappear until next week
 * on any device. Only the owner's own words become an offer post.
 */
interface OfferState {
  eligible: boolean;
  answered: string | null;
  festivals: Array<{ name: string; date: string; approximate: boolean }>;
  photos: Array<{ id: string; url: string }>;
}

export default function WeeklyOfferPrompt() {
  const { activeBusiness } = useBusiness();
  const [state, setState] = useState<OfferState | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [festivalName, setFestivalName] = useState('');
  const [imageId, setImageId] = useState('');
  const [saving, setSaving] = useState(false);

  const businessId = activeBusiness?._id;
  useEffect(() => {
    setState(null);
    setWriting(false);
    if (!businessId) return;
    let cancelled = false;
    fetch('/api/content/weekly-offer')
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j.success) setState(j); })
      .catch(() => { /* best-effort — no popup this load */ });
    return () => { cancelled = true; };
  }, [businessId]);

  if (!state || !state.eligible || state.answered) return null;

  const send = async (answer: 'yes' | 'no' | 'dismiss') => {
    setSaving(true);
    try {
      const res = await fetch('/api/content/weekly-offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(answer === 'yes' ? { answer, text, festivalName: festivalName || undefined, imageId: imageId || undefined } : { answer }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Could not save');
      if (answer === 'yes') toast.success("Got it — we'll turn your offer into this week's post.");
      setState({ ...state, answered: j.answered });
    } catch (err: any) {
      toast.error(err.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const upcoming = state.festivals[0];

  return (
    <div className="fixed bottom-24 lg:bottom-4 right-4 left-4 sm:left-auto sm:right-4 lg:right-auto lg:left-68 z-60 sm:w-96 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-4 relative">
        <button
          onClick={() => send('dismiss')}
          disabled={saving}
          className="absolute top-2.5 right-2.5 p-1 hover:bg-surface-container rounded-full transition-colors"
          aria-label="Dismiss for this week"
        >
          <X className="w-3.5 h-3.5 text-on-surface-variant" />
        </button>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 shrink-0 bg-primary rounded-lg flex items-center justify-center shadow-sm">
            <Megaphone className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 pr-4 flex-1">
            <h2 className="font-heading text-sm font-bold text-on-surface">Anything to promote this week?</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              An offer, a new service or an announcement — we&apos;ll make it one of this week&apos;s Google posts, using only your words.
              {upcoming && <> {upcoming.name} is on {upcoming.date}{upcoming.approximate ? ' (approx.)' : ''}.</>}
            </p>

            {!writing ? (
              <div className="flex items-center gap-3 mt-3">
                <button
                  onClick={() => setWriting(true)}
                  className="px-3 py-1.5 text-xs font-bold text-white bg-primary hover:bg-primary-container rounded-lg transition-colors"
                >
                  Yes, add it
                </button>
                <button
                  onClick={() => send('no')}
                  disabled={saving}
                  className="text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
                >
                  Nothing this week
                </button>
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={600}
                  rows={3}
                  placeholder="e.g. 10% off tile installation booked before 15 October"
                  className="w-full text-xs text-on-surface border border-outline-variant rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {state.festivals.length > 0 && (
                  <select
                    value={festivalName}
                    onChange={(e) => setFestivalName(e.target.value)}
                    className="w-full text-xs border border-outline-variant rounded-lg px-2 py-1.5 bg-surface-container-lowest"
                  >
                    <option value="">Not for a festival</option>
                    {state.festivals.map((f) => <option key={f.name} value={f.name}>For {f.name}</option>)}
                  </select>
                )}
                {state.photos.length > 0 && (
                  <div>
                    <p className="text-[11px] text-on-surface-variant mb-1">Photo (optional, from your Photos)</p>
                    <div className="flex gap-1.5 overflow-x-auto">
                      {state.photos.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setImageId(imageId === p.id ? '' : p.id)}
                          className={`shrink-0 rounded-md overflow-hidden border-2 ${imageId === p.id ? 'border-primary' : 'border-transparent'}`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.url} alt="" className="w-12 h-12 object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => send('yes')}
                    disabled={saving || text.trim().length < 5}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-primary hover:bg-primary-container rounded-lg transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Use this offer'}
                  </button>
                  <button
                    onClick={() => setWriting(false)}
                    className="text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
