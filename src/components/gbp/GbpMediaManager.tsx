'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Loader2, ImagePlus, Info, CheckCircle2, AlertCircle } from 'lucide-react';

interface MediaItem {
  name: string;
  category: string;
  url: string;
  thumbnailUrl: string;
}

type UploadCategory = 'LOGO' | 'COVER' | 'ADDITIONAL';

const UPLOAD_SLOTS: { category: UploadCategory; label: string; hint: string }[] = [
  { category: 'LOGO', label: 'Logo', hint: 'Square, your brand mark' },
  { category: 'COVER', label: 'Cover photo', hint: 'Wide banner at the top of your profile' },
  { category: 'ADDITIONAL', label: 'Business photo', hint: 'Storefront, team, products…' },
];

export default function GbpMediaManager({ businessId }: { businessId?: string }) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveWrites, setLiveWrites] = useState(false);
  const [uploading, setUploading] = useState<UploadCategory | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // Local (not-yet-uploaded) previews — shown the instant a file is picked
  // instead of waiting for the upload to finish and the media grid to
  // refetch from Google. Keyed by object URL so they can be revoked cleanly.
  const [previews, setPreviews] = useState<Partial<Record<UploadCategory, string>>>({});
  // Mirrors `previews` for the unmount-only cleanup below, which must read
  // whatever is current at unmount time without re-running (and revoking
  // still-active preview URLs) on every preview add/remove in between.
  const previewsRef = useRef(previews);
  useEffect(() => { previewsRef.current = previews; }, [previews]);

  // Revoke any still-pending preview URLs on unmount to avoid leaking memory.
  useEffect(() => {
    return () => {
      Object.values(previewsRef.current).forEach((url) => url && URL.revokeObjectURL(url));
    };
  }, []);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/gbp/media');
      const json = await res.json();
      setLiveWrites(Boolean(json.liveWritesEnabled));
      if (json.success) setMedia(json.media || []);
      else setError(json.error || 'Could not load media.');
    } catch {
      setError('Could not load your Google Business Profile media.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMedia(); }, [loadMedia, businessId]);

  const handleFile = async (category: UploadCategory, file: File | undefined) => {
    if (!file) return;

    // Show the picked file immediately — don't make the user wait for the
    // upload + a full media refetch just to see what they selected.
    const localUrl = URL.createObjectURL(file);
    setPreviews((prev) => {
      const old = prev[category];
      if (old) URL.revokeObjectURL(old);
      return { ...prev, [category]: localUrl };
    });

    setUploading(category);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('category', category);
      const res = await fetch('/api/gbp/media/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed.');
      setMsg({
        ok: true,
        text: json.liveWriteApplied
          ? 'Uploaded and published to Google.'
          : (json.note || 'Uploaded. It will publish to Google once live publishing is enabled.'),
      });
      await loadMedia();
      // Real thumbnail now renders in the "On your Google profile" grid
      // below — drop the local stand-in.
      setPreviews((prev) => {
        const url = prev[category];
        if (url) URL.revokeObjectURL(url);
        const next = { ...prev };
        delete next[category];
        return next;
      });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Upload failed.' });
      // Keep the local preview on failure so the user can see what they were
      // trying to upload while they retry.
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-center gap-2">
        <ImagePlus className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold text-on-surface">Photos &amp; Media</h2>
      </div>

      {!liveWrites && (
        <div className="flex items-start gap-2 bg-error-container border border-error-container rounded-xl px-4 py-3 text-sm text-on-error-container">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Preview mode — uploads are saved now and publish to Google automatically once live publishing is enabled.</span>
        </div>
      )}

      {msg && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-secondary-container/40 border border-secondary-fixed text-on-secondary-container' : 'bg-error-container border border-error-container text-on-error-container'}`}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      {/* Upload slots */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {UPLOAD_SLOTS.map((slot) => (
          <div key={slot.category} className="border border-dashed border-outline-variant rounded-xl p-4 text-center">
            <p className="text-sm font-semibold text-on-surface">{slot.label}</p>
            <p className="text-xs text-outline mt-0.5 mb-3">{slot.hint}</p>

            {previews[slot.category] && (
              <div className="relative mb-3 rounded-lg overflow-hidden border border-outline-variant aspect-video bg-surface">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previews[slot.category]} alt={`${slot.label} preview`} className="w-full h-full object-cover" />
                {uploading === slot.category && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 text-white animate-spin" />
                  </div>
                )}
              </div>
            )}

            <input
              ref={(el) => { inputs.current[slot.category] = el; }}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => handleFile(slot.category, e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => inputs.current[slot.category]?.click()}
              disabled={uploading !== null}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary text-white text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {uploading === slot.category ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              {uploading === slot.category ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        ))}
      </div>

      {/* Existing media */}
      <div className="pt-2 border-t border-outline-variant">
        <p className="text-xs font-semibold text-outline uppercase tracking-wide mb-3">On your Google profile</p>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-outline py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading media…</div>
        ) : error ? (
          <p className="text-sm text-error">{error}</p>
        ) : media.length === 0 ? (
          <p className="text-sm text-outline">No photos on your Google profile yet. Upload your logo, cover and a few photos above.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
            {media.map((m, i) => (
              <div key={m.name || i} className="relative aspect-square rounded-lg overflow-hidden border border-outline-variant bg-surface group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/gbp/media/proxy?url=${encodeURIComponent(m.thumbnailUrl || m.url)}`}
                  alt={m.category}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-medium">
                  {m.category}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
