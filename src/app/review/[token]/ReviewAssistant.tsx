'use client';

import { useState } from 'react';

export interface ReviewAssistantProps {
  token: string;
  businessName: string;
  firstName: string | null;
  serviceChips: string[];
  qualityChips: string[];
  open: {
    mode: 'redirect' | 'android-chrome' | 'ios-choose';
    reviewUrl: string;
    chromeIntent: string | null;
    iosChrome: string | null;
    iosSafari: string | null;
  };
}

const MAX_PICK = 4;
const LABELS = ['', 'Poor', 'Not great', 'Okay', 'Good', 'Excellent'];

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the old way */ }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-11 w-11" aria-hidden="true">
      <path
        d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"
        fill={filled ? '#FBBC05' : 'none'}
        stroke={filled ? '#F2A900' : '#C4C9D0'}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ReviewAssistant(props: ReviewAssistantProps) {
  const { token, businessName, firstName, serviceChips, qualityChips, open } = props;
  const [rating, setRating] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState('');
  const [variant, setVariant] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showIosChoice, setShowIosChoice] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [sending, setSending] = useState(false);

  const happy = rating >= 4;

  function toggle(chip: string) {
    setPicked((cur) => (cur.includes(chip) ? cur.filter((c) => c !== chip) : cur.length >= MAX_PICK ? cur : [...cur, chip]));
  }

  async function writeDraft() {
    setDrafting(true);
    setError('');
    const next = variant + 1;
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(token)}/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, picked, note, variant: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.draft) throw new Error(json.error || 'Could not write a suggestion.');
      setDraft(json.draft);
      setVariant(next);
      setCopied(false);
    } catch (e: any) {
      setError(e?.message || 'Could not write a suggestion. You can write your own on Google.');
    } finally {
      setDrafting(false);
    }
  }

  function goToGoogle() {
    if (open.mode === 'ios-choose') {
      setShowIosChoice(true);
      return;
    }
    window.location.href = open.mode === 'android-chrome' && open.chromeIntent ? open.chromeIntent : open.reviewUrl;
  }

  async function copyAndGo() {
    const text = draft.trim();
    if (text) setCopied(await copyText(text));
    goToGoogle();
  }

  async function sendFeedback() {
    setSending(true);
    setError('');
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(token)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, feedback }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send your message.');
      setFeedbackSent(true);
    } catch (e: any) {
      setError(e?.message || 'Could not send your message.');
    } finally {
      setSending(false);
    }
  }

  const chip = (label: string) => {
    const on = picked.includes(label);
    return (
      <button
        key={label}
        type="button"
        onClick={() => toggle(label)}
        aria-pressed={on}
        className={`rounded-full border px-3.5 py-2 text-sm font-medium transition ${on ? 'border-[#06b34c] bg-[#e7f8ee] text-[#0a6b30]' : 'border-slate-300 bg-white text-slate-700'}`}
      >
        {on ? '✓ ' : ''}{label}
      </button>
    );
  };

  const googleButton = (label: string, onClick: () => void, primary = true) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl px-4 py-4 text-base font-semibold ${primary ? 'bg-[#1a73e8] text-white' : 'border border-slate-300 bg-white text-slate-800'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <main className="mx-auto max-w-md px-4 pb-16 pt-8">
        <p className="text-center text-sm font-medium text-slate-500">{businessName}</p>
        <h1 className="mt-1 text-center text-2xl font-bold">
          {firstName ? `Hi ${firstName}, how was your experience?` : 'How was your experience?'}
        </h1>

        <div className="mt-6 flex justify-center gap-1" role="radiogroup" aria-label="Your rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              onClick={() => { setRating(n); setError(''); setShowIosChoice(false); }}
              className="rounded-lg p-0.5"
            >
              <Star filled={n <= rating} />
            </button>
          ))}
        </div>
        <p className="mt-2 h-5 text-center text-sm text-slate-500">{rating ? LABELS[rating] : 'Tap a star'}</p>

        {happy && (
          <section className="mt-6 space-y-5">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">What did you like? <span className="font-normal text-slate-500">(pick up to {MAX_PICK})</span></h2>
              {serviceChips.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{serviceChips.map(chip)}</div>}
              <div className="mt-3 flex flex-wrap gap-2">{qualityChips.map(chip)}</div>
              <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="note">Anything else? <span className="font-normal text-slate-500">(optional)</span></label>
              <input
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 200))}
                placeholder="e.g. they fixed it the same day"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"
              />
              <button
                type="button"
                onClick={writeDraft}
                disabled={drafting}
                className="mt-4 w-full rounded-xl bg-[#06b34c] px-4 py-3.5 text-base font-semibold text-white disabled:opacity-60"
              >
                {drafting ? 'Writing…' : draft ? 'Try another' : 'Suggest a review for me'}
              </button>
            </div>

            {draft && (
              <div className="rounded-2xl bg-white p-4 shadow-sm">
                <h2 className="text-base font-semibold">Your review</h2>
                <p className="mt-1 text-sm text-slate-500">Change anything you like — it should be in your words.</p>
                <textarea
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setCopied(false); }}
                  rows={5}
                  className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base leading-relaxed"
                />
                <div className="mt-4">{googleButton('Copy & post on Google', copyAndGo)}</div>
                <p className="mt-3 text-center text-sm text-slate-500">
                  {copied ? 'Copied! ' : ''}On Google, tap {rating} star{rating > 1 ? 's' : ''}, then long-press the box and tap <b>Paste</b>.
                </p>
              </div>
            )}

            {!draft && (
              <div className="text-center">
                <button type="button" onClick={goToGoogle} className="text-sm font-medium text-[#1a73e8] underline">
                  I&apos;ll write my own on Google
                </button>
              </div>
            )}
          </section>
        )}

        {rating > 0 && !happy && (
          <section className="mt-6 space-y-5">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">Sorry it wasn&apos;t better.</h2>
              {feedbackSent ? (
                <p className="mt-2 text-sm text-slate-600">Thank you. {businessName} will see your message.</p>
              ) : (
                <>
                  <p className="mt-1 text-sm text-slate-500">Tell {businessName} what went wrong (only they will see this).</p>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value.slice(0, 1000))}
                    rows={4}
                    placeholder="What could they do better?"
                    className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base"
                  />
                  <button
                    type="button"
                    onClick={sendFeedback}
                    disabled={sending || feedback.trim().length < 3}
                    className="mt-3 w-full rounded-xl bg-slate-800 px-4 py-3.5 text-base font-semibold text-white disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : 'Send to the owner'}
                  </button>
                </>
              )}
            </div>
            <div>
              {googleButton('Post your review on Google', goToGoogle, false)}
              <p className="mt-2 text-center text-xs text-slate-500">You can also share your review publicly on Google.</p>
            </div>
          </section>
        )}

        {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}

        {showIosChoice && open.iosChrome && open.iosSafari && (
          <div className="mt-6 space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-center text-sm text-slate-600">Open Google where you&apos;re signed in:</p>
            <a href={open.iosChrome} className="block w-full rounded-xl bg-[#1a73e8] px-4 py-3.5 text-center text-base font-semibold text-white">Open in Chrome</a>
            <a href={open.iosSafari} className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-3.5 text-center text-base font-semibold text-slate-800">Open in Safari</a>
            <a href={open.reviewUrl} className="block text-center text-sm text-[#1a73e8]">Continue in this browser</a>
          </div>
        )}

        {rating === 0 && (
          <div className="mt-10 text-center">
            <button type="button" onClick={goToGoogle} className="text-sm text-slate-500 underline">
              Skip and go to Google
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
