'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useBusiness } from '@/context/BusinessContext';

/**
 * Brand colours for generated post images. Colours saved here always win and
 * are never overwritten by automation; with none saved, the colours come from
 * your logo, then your website, then a neutral palette.
 */
const SOURCE_LABEL: Record<string, string> = {
  manual: 'set by you',
  logo: 'from your logo',
  website: 'from your website',
  theme: "from your website's theme colour",
  default: 'neutral default',
};

export default function BrandColorsCard() {
  const { activeBusiness } = useBusiness();
  const [data, setData] = useState<{ manualColors: string[]; colors: string[]; colorSource: string | null; logoUrl: string | null; logoSource: string | null } | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!activeBusiness?._id) return;
    fetch('/api/business/brand').then((r) => r.json()).then((j) => {
      if (j.success) { setData(j); setDraft(j.manualColors.length ? j.manualColors : j.colors.slice(0, 2)); }
    }).catch(() => {});
  }, [activeBusiness?._id]);

  const save = async (colors: string[]) => {
    setSaving(true);
    try {
      const res = await fetch('/api/business/brand', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manualColors: colors }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not save');
      setData((d) => (d ? { ...d, manualColors: j.manualColors } : d));
      toast.success(colors.length ? 'Brand colours saved' : 'Brand colours reset to automatic');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!data) return null;
  const effective = data.manualColors.length ? data.manualColors : data.colors;
  const source = data.manualColors.length ? 'manual' : data.colorSource;

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 space-y-4">
      <div>
        <h2 className="text-base font-bold text-on-surface">Brand for post images</h2>
        <p className="text-xs text-on-surface-variant mt-1">
          Used on generated images for your Google posts. Your own photos are never changed.
        </p>
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        {data.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.logoUrl} alt="Your logo" className="h-10 w-auto max-w-32 object-contain border border-outline-variant rounded-md bg-white p-1" />
        ) : (
          <span className="text-xs text-on-surface-variant">No logo yet — upload one in Photos (Logo) to add it to generated images.</span>
        )}
        {data.logoUrl && <span className="text-xs text-on-surface-variant">Logo {data.logoSource === 'customer_upload' ? 'from your Photos' : 'from your website'}</span>}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {effective.map((c) => <span key={c} className="w-6 h-6 rounded-md border border-outline-variant" style={{ background: c }} title={c} />)}
        {source && <span className="text-xs text-on-surface-variant">Current colours: {SOURCE_LABEL[source] ?? source}</span>}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        {[0, 1].map((i) => (
          <label key={i} className="flex items-center gap-2 text-xs text-on-surface-variant">
            {i === 0 ? 'Primary' : 'Secondary'}
            <input
              type="color"
              value={draft[i] || (i === 0 ? '#1f2937' : '#f3f4f6')}
              onChange={(e) => { const next = [...draft]; next[i] = e.target.value; setDraft(next.filter(Boolean)); }}
              className="w-9 h-7 border border-outline-variant rounded cursor-pointer"
            />
          </label>
        ))}
        <button
          onClick={() => save(draft.slice(0, 2))}
          disabled={saving || !draft.length}
          className="px-3 py-1.5 text-xs font-bold text-white bg-primary hover:bg-primary-container rounded-lg disabled:opacity-50"
        >
          Save colours
        </button>
        {data.manualColors.length > 0 && (
          <button onClick={() => save([])} disabled={saving} className="text-xs font-medium text-on-surface-variant hover:text-on-surface">
            Use automatic colours
          </button>
        )}
      </div>
    </div>
  );
}
