'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

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
  // Renders the empty form immediately instead of blocking behind a full-page
  // spinner — for a brand-new customer (the common case) there's nothing to
  // prefill anyway, so making everyone wait on this round-trip before they
  // can even start typing was unnecessary. Any previously-saved answers
  // (resuming a partial fill) backfill a moment later once the GET resolves.
  const [data, setData] = useState<IntakeData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/onboarding/intake');
        const json = await res.json();
        if (json.success) setData({ ...EMPTY, ...json.data });
      } catch {
        /* keep defaults */
      }
    })();
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
    try {
      const res = await fetch('/api/onboarding/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not save. Please try again.');
      // No router.refresh() here — it forces a second, blocking server
      // round-trip (re-running middleware + this layout) right on top of the
      // navigation below, which already fetches the destination fresh. That
      // redundant round-trip was what made "Save" feel slow.
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
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
