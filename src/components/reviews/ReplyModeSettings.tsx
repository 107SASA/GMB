'use client';

import { useEffect, useState } from 'react';
import { Sparkles, UserCheck, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

type ReplyMode = 'manual' | 'auto';
const TONES = ['Professional', 'Friendly', 'Apology', 'Empathetic'];

/**
 * Review Management's reply-mode toggle. 'manual' is the existing flow
 * (AI drafts a reply, owner reviews/edits/approves, then posts — unchanged).
 * 'auto' hands the whole thing to the AI agent: draft AND post, no human
 * step, for every review — including the existing backlog the moment it's
 * switched on (see reply-settings/route.ts).
 */
export default function ReplyModeSettings({ onModeChanged }: { onModeChanged?: () => void }) {
  const [mode, setMode] = useState<ReplyMode>('manual');
  const [tone, setTone] = useState('Professional');
  const [savedMode, setSavedMode] = useState<ReplyMode>('manual');
  const [savedTone, setSavedTone] = useState('Professional');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/reviews/reply-settings');
        const json = await res.json();
        if (json.success) {
          setMode(json.mode);
          setSavedMode(json.mode);
          setTone(json.tone);
          setSavedTone(json.tone);
        }
      } catch {
        /* keep defaults — not worth blocking the page over */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch('/api/reviews/reply-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, tone }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save.');
      setSavedMode(mode);
      setSavedTone(tone);
      setMsg({
        ok: true,
        text:
          mode === 'auto' && json.queued > 0
            ? `Saved — ${json.queued} existing review${json.queued === 1 ? '' : 's'} queued for auto-reply now.`
            : mode === 'auto'
              ? 'Saved — new reviews will now get an AI reply automatically.'
              : 'Saved — you\'ll review and approve every AI reply from now on.',
      });
      onModeChanged?.();
    } catch (err) {
      setMsg({ ok: false, text: friendlyClientMessage(err, 'Could not save.') });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 shadow-sm space-y-4">
      <div>
        <p className="text-sm font-bold text-on-surface">How should review replies work?</p>
        <p className="text-xs text-on-surface-variant mt-0.5">Choose per workspace — you can switch this anytime.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setMode('manual')}
          className={`text-left p-4 rounded-xl border-2 transition-colors ${
            mode === 'manual' ? 'border-primary bg-primary-fixed' : 'border-outline-variant hover:bg-surface-container'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <UserCheck className={`w-4 h-4 ${mode === 'manual' ? 'text-primary' : 'text-on-surface-variant'}`} />
            <span className="text-sm font-bold text-on-surface">AI drafts, I approve</span>
          </div>
          <p className="text-xs text-on-surface-variant leading-snug">
            The AI writes a suggested reply for each review. Nothing posts to Google until you review it and hit Post.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setMode('auto')}
          className={`text-left p-4 rounded-xl border-2 transition-colors ${
            mode === 'auto' ? 'border-primary bg-primary-fixed' : 'border-outline-variant hover:bg-surface-container'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className={`w-4 h-4 ${mode === 'auto' ? 'text-primary' : 'text-on-surface-variant'}`} />
            <span className="text-sm font-bold text-on-surface">Auto-reply to all reviews</span>
          </div>
          <p className="text-xs text-on-surface-variant leading-snug">
            The AI writes AND posts a reply on its own, for every review — no approval step. Turning this on also
            replies to your existing unanswered reviews.
          </p>
        </button>
      </div>

      {mode === 'auto' && (
        <div>
          <p className="text-xs font-semibold text-on-surface-variant mb-1.5">Reply tone</p>
          <div className="flex flex-wrap gap-2">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTone(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  tone === t
                    ? 'bg-primary-fixed text-primary border-primary-fixed-dim'
                    : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant hover:bg-surface-container'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {msg && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${msg.ok ? 'bg-secondary-container/40 text-on-secondary-container' : 'bg-error-container text-on-error-container'}`}>
          {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
          {msg.text}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || (mode === savedMode && tone === savedTone)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
