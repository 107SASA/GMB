'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, Target, Rocket } from 'lucide-react';

interface IntakeData {
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
  description: '', services: '', offers: '', keywords: [], city: '', area: '',
  tone: 'professional', uniqueSellingPoints: '', targetAudience: '',
  competitorNames: [], primaryGoal: '',
};

const isValidKeyword = (v: string) => /[a-zA-Z]/.test(v);

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
      <label className="text-sm font-semibold text-slate-700">{label}</label>
      {hint && <p className="text-xs text-slate-400 -mt-1">{hint}</p>}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-50 text-indigo-700">
              {t}
              <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="ml-2 text-indigo-400 hover:text-indigo-700">&times;</button>
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
      <label className="text-sm font-semibold text-slate-700">{label}</label>
      {hint && <p className="text-xs text-slate-400 -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

const inputCls = 'w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors';

export default function IntakePage() {
  const router = useRouter();
  const [data, setData] = useState<IntakeData>(EMPTY);
  const [loading, setLoading] = useState(true);
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
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = <K extends keyof IntakeData>(k: K, v: IntakeData[K]) => setData((p) => ({ ...p, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-indigo-50 border border-indigo-100 rounded-2xl mx-auto flex items-center justify-center mb-4">
          <Sparkles className="w-8 h-8 text-indigo-600" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Tell us about your business</h1>
        <p className="text-slate-500 mt-2 max-w-xl mx-auto">
          This powers your audits, AI content, and competitor comparison. The more accurate this is, the better every result. Takes ~2 minutes.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={submit} className="space-y-8">
        {/* What you do */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2 text-slate-900 font-bold"><Target className="w-4 h-4 text-indigo-600" /> What you do</div>
          <Field label="Business description *" hint="What does your business do, in a sentence or two?">
            <textarea rows={3} className={inputCls} value={data.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. A multi-specialty hospital in Kolkata offering 24/7 emergency care, cardiology, and orthopedics." />
          </Field>
          <Field label="Services / treatments you offer *" hint="Comma-separated is fine.">
            <textarea rows={2} className={inputCls} value={data.services} onChange={(e) => set('services', e.target.value)} placeholder="e.g. Emergency care, Cardiology, Orthopedics, Diagnostics, Health checkups" />
          </Field>
          <Field label="Current offers / promotions" hint="Optional — used in promotional posts.">
            <input className={inputCls} value={data.offers} onChange={(e) => set('offers', e.target.value)} placeholder="e.g. 20% off full-body checkup this month" />
          </Field>
        </section>

        {/* How you get found */}
        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2 text-slate-900 font-bold"><Sparkles className="w-4 h-4 text-indigo-600" /> How customers find you</div>
          <TagInput
            label="Target keywords *"
            hint="What people search on Google to find a business like yours. Press Enter to add."
            tags={data.keywords}
            onChange={(t) => set('keywords', t)}
            validate={isValidKeyword}
            placeholder="e.g. best hospital in Kolkata"
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
        <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2 text-slate-900 font-bold"><Rocket className="w-4 h-4 text-indigo-600" /> Standing out</div>
          <Field label="What makes you better than competitors?" hint="Your unique selling points.">
            <textarea rows={2} className={inputCls} value={data.uniqueSellingPoints} onChange={(e) => set('uniqueSellingPoints', e.target.value)} placeholder="e.g. Only 24/7 NABH-accredited cardiac unit in the area, 15-min ambulance guarantee" />
          </Field>
          <TagInput
            label="Main competitors"
            hint="Names of businesses you compete with locally. Press Enter to add."
            tags={data.competitorNames}
            onChange={(t) => set('competitorNames', t)}
            placeholder="e.g. Apollo Gleneagles"
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
          className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-lg transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {saving ? <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</> : 'Save & Enter Dashboard'}
        </button>
      </form>
    </div>
  );
}
