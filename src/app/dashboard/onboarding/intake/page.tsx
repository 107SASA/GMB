'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

interface IntakeData {
  category: string;
  description: string;
  services: string;
  offers: string;
  keywords: string[];
  city: string;
  area: string;
  tone: string;
  uniqueSellingPoints: string;
  targetAudience: string;
  competitorNames: string[];
  primaryGoal: string;
}

const EMPTY: IntakeData = {
  category: '', description: '', services: '', offers: '', keywords: [], city: '', area: '',
  tone: 'professional', uniqueSellingPoints: '', targetAudience: '',
  competitorNames: [], primaryGoal: '',
};

const isValidKeyword = (v: string) => /[a-zA-Z]/.test(v);

const inputCls =
  'w-full px-4 py-3 bg-surface-container-lowest border border-outline-variant rounded-lg text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all';

/** Simple tag input — Enter to add, × to remove. */
function TagInput({
  label, hint, tags, onChange, placeholder, validate,
}: {
  label: string; hint?: string; tags: string[];
  onChange: (t: string[]) => void; placeholder: string;
  validate?: (v: string) => boolean;
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (!v || (validate && !validate(v)) || tags.includes(v)) { setInput(''); return; }
    onChange([...tags, v]);
    setInput('');
  };
  return (
    <div className="space-y-2">
      <label className="text-label-md text-on-surface">{label}</label>
      {hint && <p className="text-xs text-outline -mt-1">{hint}</p>}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={placeholder}
        className={inputCls}
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium bg-primary-fixed text-primary">
              {t}
              <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="ml-2 text-primary-fixed-dim hover:text-primary">&times;</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="text-label-md text-on-surface">{label}</label>
      {hint && <p className="text-xs text-outline -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

export default function IntakePage() {
  const router = useRouter();

  // Warm the dashboard route the instant this page opens, well before the
  // user actually hits Save. Without this, clicking Save felt like it hung
  // ("buffering") — router.push('/dashboard') doesn't swap the screen until
  // Next.js has fetched and rendered the target route, and that whole
  // round trip was previously only ever kicked off AFTER the save request
  // completed. Prefetching here means it's already warm by submit time, so
  // the post-save redirect is close to instant instead of adding its own
  // wait on top of the save itself.
  useEffect(() => {
    router.prefetch('/dashboard');
  }, [router]);

  // Renders the empty form immediately instead of blocking behind a full-page
  // spinner — for a brand-new customer (the common case) there's nothing to
  // prefill anyway, so making everyone wait on this round-trip before they
  // can even start typing was unnecessary. Any previously-saved answers
  // (resuming a partial fill) backfill a moment later once the GET resolves.
  const [data, setData] = useState<IntakeData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── AI keyword suggestions ──────────────────────────────────────────────
  const [suggestedKeywords, setSuggestedKeywords] = useState<string[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState(false);
  // Every keyword ever shown (picked or not) across every batch, so "more
  // like this" never repeats a suggestion the user already saw and skipped.
  const shownKeywordsRef = useRef<string[]>([]);
  const hasFetchedInitialRef = useRef(false);

  const fetchKeywordSuggestions = async (selected: string[]) => {
    setSuggestLoading(true);
    setSuggestError(false);
    try {
      const res = await fetch('/api/onboarding/suggest-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: data.category,
          description: data.description,
          selectedKeywords: selected,
          excludeKeywords: shownKeywordsRef.current,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load suggestions');
      shownKeywordsRef.current = [...shownKeywordsRef.current, ...json.keywords];
      setSuggestedKeywords(json.keywords);
    } catch {
      setSuggestError(true);
    } finally {
      setSuggestLoading(false);
    }
  };

  // Fires the initial suggestion batch once the category is filled in —
  // debounced so it doesn't fire on every keystroke. Fires fast once a real
  // description is there too (better suggestions); otherwise still fires
  // after a longer pause on category alone rather than waiting forever for
  // a description that may never come — suggestTargetKeywords works fine
  // without one. (A manual "Suggest keywords" button below covers anyone
  // who types out of order or just wants a fresh batch on demand.)
  useEffect(() => {
    if (hasFetchedInitialRef.current) return;
    if (!data.category.trim()) return;
    const hasDescription = data.description.trim().length >= 10;
    const t = setTimeout(() => {
      hasFetchedInitialRef.current = true;
      fetchKeywordSuggestions(data.keywords);
    }, hasDescription ? 800 : 2500);
    return () => clearTimeout(t);
  }, [data.category, data.description]);

  const pickSuggestedKeyword = (kw: string) => {
    if (!data.keywords.includes(kw)) {
      const nextKeywords = [...data.keywords, kw];
      set('keywords', nextKeywords);
      // "show more like that" — refine the next batch around what they just
      // picked instead of just repeating the same generic starting mix.
      fetchKeywordSuggestions(nextKeywords);
    }
    setSuggestedKeywords((prev) => prev.filter((k) => k !== kw));
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/onboarding/intake');
        const json = await res.json();
        // GET already tells us whether this workspace finished intake — the
        // proxy.ts gate only forces new-enough workspaces here on an
        // incomplete profile, so anyone reaching this URL after already
        // completing it (stale link, back button) was previously shown the
        // same form again with a "Save" button that looked unactioned, even
        // though the dashboard was already unlocked. Bounce them onward
        // instead of re-prompting for info already saved.
        if (json.success && json.intakeCompleted) {
          router.replace('/dashboard');
          return;
        }
        if (json.success) setData({ ...EMPTY, ...json.data });
      } catch {
        /* keep defaults */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof IntakeData>(k: K, v: IntakeData[K]) => setData((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!data.category.trim()) return setError('Please enter your business category.');
    if (data.description.trim().length < 10) return setError('Please describe your business (at least 10 characters).');
    if (data.services.trim().length < 3) return setError('List the services you offer.');
    if (data.keywords.length === 0) return setError('Add at least one target keyword — these drive your audits and content.');

    setSaving(true);
    // Without a timeout, a stalled request (dead connection, backend hang)
    // left `saving` true forever — the button just spun with no way out and
    // no way for the user to retry. 20s is generous for this endpoint (a
    // single Business.updateOne, no AI/external calls) while still bounding
    // the wait.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch('/api/onboarding/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not save. Please try again.');
      // No router.refresh() here — it forces a second, blocking server
      // round-trip (re-running middleware + this layout) right on top of the
      // navigation below, which already fetches the destination fresh. That
      // redundant round-trip was what made "Save" feel slow.
      router.push('/dashboard');
    } catch (err) {
      setError(friendlyClientMessage(err, 'Could not save.'));
      setSaving(false);
    } finally {
      clearTimeout(timeout);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-primary-fixed border border-primary-fixed-dim rounded-xl mx-auto flex items-center justify-center mb-4">
          <MaterialIcon name="auto_awesome" size={32} className="text-primary" />
        </div>
        <h1 className="text-headline-lg font-heading text-on-surface tracking-tight">Tell us about your business</h1>
        <p className="text-on-surface-variant mt-2 max-w-xl mx-auto">
          This powers your audits, AI content, and competitor comparison. The more accurate this is, the better every result. Takes ~2 minutes.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container border border-outline-variant rounded-lg text-sm text-on-error-container">{error}</div>
      )}

      <form onSubmit={submit} className="space-y-8">
        {/* What you do */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 card-shadow space-y-5">
          <div className="flex items-center gap-2 text-on-surface font-bold">
            <MaterialIcon name="track_changes" size={16} className="text-primary" /> What you do
          </div>
          <Field label="Business category *" hint="Your exact category — this drives your audit and content.">
            <input className={inputCls} value={data.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Restaurant" />
          </Field>
          <Field label="Business description *" hint="What does your business do, in a sentence or two?">
            <textarea rows={3} className={inputCls} value={data.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. A family-run bakery in Kolkata offering fresh breads, custom cakes, and daily pastries." />
          </Field>
          <Field label="Services you offer *" hint="Comma-separated is fine.">
            <textarea rows={2} className={inputCls} value={data.services} onChange={(e) => set('services', e.target.value)} placeholder="e.g. Custom cakes, Wedding orders, Daily bread, Catering, Gift hampers" />
          </Field>
          <Field label="Current offers / promotions" hint="Optional — used in promotional posts.">
            <input className={inputCls} value={data.offers} onChange={(e) => set('offers', e.target.value)} placeholder="e.g. 20% off your first order this month" />
          </Field>
        </section>

        {/* How you get found */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 card-shadow space-y-5">
          <div className="flex items-center gap-2 text-on-surface font-bold">
            <MaterialIcon name="auto_awesome" size={16} className="text-primary" /> How customers find you
          </div>
          <TagInput
            label="Target keywords *"
            hint="What people search on Google to find a business like yours. Press Enter to add."
            tags={data.keywords}
            onChange={(t) => set('keywords', t)}
            validate={isValidKeyword}
            placeholder="e.g. best bakery in Kolkata"
          />

          {/* Manual fallback — the effect above fires this automatically a
              little after category (+ ideally description) is filled in,
              but that's timing-dependent (a slow typer, filling fields out
              of order, or just wanting a fresh batch later). This gives an
              always-available, explicit way to get suggestions instead of
              relying purely on the auto-trigger, gated only on there being
              a category to suggest from. */}
          {data.category.trim() && !suggestLoading && suggestedKeywords.length === 0 && !suggestError && (
            <button
              type="button"
              onClick={() => { hasFetchedInitialRef.current = true; fetchKeywordSuggestions(data.keywords); }}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <MaterialIcon name="auto_awesome" size={14} /> Suggest keywords for me
            </button>
          )}

          {/* AI suggestions — appear once category + description are filled
              in above. Clicking one adds it and immediately refreshes with
              more suggestions in that same theme, so building out the full
              list is a few clicks instead of typing every keyword by hand. */}
          {(suggestLoading || suggestedKeywords.length > 0 || suggestError) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-on-surface-variant flex items-center gap-1.5">
                  <MaterialIcon name="auto_awesome" size={14} className="text-primary" />
                  Suggested for you
                </p>
                {suggestedKeywords.length > 0 && !suggestLoading && (
                  <button
                    type="button"
                    onClick={() => fetchKeywordSuggestions(data.keywords)}
                    className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
                  >
                    <MaterialIcon name="refresh" size={14} /> More like this
                  </button>
                )}
              </div>

              {suggestLoading ? (
                <div className="flex items-center gap-2 text-xs text-outline py-1">
                  <MaterialIcon name="progress_activity" size={14} className="animate-spin" />
                  Finding keywords that fit your business…
                </div>
              ) : suggestError ? (
                <p className="text-xs text-outline">
                  Couldn&apos;t load suggestions right now.{' '}
                  <button type="button" onClick={() => fetchKeywordSuggestions(data.keywords)} className="text-primary hover:underline font-medium">
                    Try again
                  </button>
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {suggestedKeywords.map((kw) => (
                    <button
                      key={kw}
                      type="button"
                      onClick={() => pickSuggestedKeyword(kw)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-surface-container border border-outline-variant text-on-surface hover:border-primary hover:text-primary hover:bg-primary-fixed transition-colors"
                    >
                      <MaterialIcon name="add" size={14} />
                      {kw}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="City"><input className={inputCls} value={data.city} onChange={(e) => set('city', e.target.value)} placeholder="e.g. Kolkata" /></Field>
            <Field label="Area / locality"><input className={inputCls} value={data.area} onChange={(e) => set('area', e.target.value)} placeholder="e.g. Kasba" /></Field>
          </div>
          <Field label="Who are your customers?" hint="Your target audience.">
            <input className={inputCls} value={data.targetAudience} onChange={(e) => set('targetAudience', e.target.value)} placeholder="e.g. Families and working professionals in South Kolkata" />
          </Field>
        </section>

        {/* Positioning */}
        <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 card-shadow space-y-5">
          <div className="flex items-center gap-2 text-on-surface font-bold">
            <MaterialIcon name="rocket_launch" size={16} className="text-primary" /> Standing out
          </div>
          <Field label="What makes you better than competitors?" hint="Your unique selling points.">
            <textarea rows={2} className={inputCls} value={data.uniqueSellingPoints} onChange={(e) => set('uniqueSellingPoints', e.target.value)} placeholder="e.g. Only bakery in the area using organic flour, same-day delivery guarantee" />
          </Field>
          <TagInput
            label="Main competitors"
            hint="Names of businesses you compete with locally. Press Enter to add."
            tags={data.competitorNames}
            onChange={(t) => set('competitorNames', t)}
            placeholder="e.g. Corner Bakery Co."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Primary goal">
              <select className={inputCls} value={data.primaryGoal} onChange={(e) => set('primaryGoal', e.target.value)}>
                <option value="">Select…</option>
                <option value="more_calls">More calls / enquiries</option>
                <option value="more_visits">More walk-ins / footfall</option>
                <option value="more_reviews">More & better reviews</option>
                <option value="higher_ranking">Higher Google Maps ranking</option>
                <option value="brand_awareness">Brand awareness</option>
              </select>
            </Field>
            <Field label="Content tone">
              <select className={inputCls} value={data.tone} onChange={(e) => set('tone', e.target.value)}>
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="motivational">Motivational</option>
                <option value="luxury">Luxury</option>
                <option value="conversational">Conversational</option>
              </select>
            </Field>
          </div>
        </section>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3.5 rounded-lg bg-secondary hover:opacity-95 text-on-secondary font-bold text-lg transition-all flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {saving ? <><MaterialIcon name="progress_activity" size={20} className="animate-spin" /> Saving…</> : 'Save & Enter Dashboard'}
        </button>
      </form>
    </div>
  );
}
