'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import {
  Loader2,
  ImagePlus,
  Info,
  CheckCircle2,
  AlertCircle,
  Trash2,
  UploadCloud,
  RefreshCw,
  X,
  Clock,
} from 'lucide-react';
import { cropAndResizeImage, COVER_TARGET, LOGO_TARGET } from '@/lib/imageResize';

type MediaCategory = 'LOGO' | 'COVER' | 'ADDITIONAL' | 'PROFILE';
type MediaStatus = 'staged' | 'published' | 'failed';
type MediaType = 'photo' | 'video';

interface MediaAsset {
  _id: string;
  category: MediaCategory;
  mediaType?: MediaType;
  url: string;
  status: MediaStatus;
  googleMediaName?: string;
  publishedAt?: string;
  failureReason?: string;
  scheduledFor?: string;
  createdAt: string;
}

/** datetime-local <input> wants "YYYY-MM-DDTHH:mm" in LOCAL time. */
function toLocalInputValue(iso?: string): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MediaThumb({ asset, className }: { asset: MediaAsset; className?: string }) {
  if (asset.mediaType === 'video') {
    return <video src={asset.url} className={className} muted playsInline preload="metadata" controls />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={mediaSrc(asset.url)} alt={asset.category} className={className} />;
}

/**
 * Only Google-hosted photos (lh*.googleusercontent.com, reconciled straight
 * from the live profile) need routing through /api/gbp/media/proxy — that
 * endpoint's allowlist only accepts those hosts (see proxy/route.ts). Photos
 * this app published itself keep their original, already-public DigitalOcean
 * Spaces URL and must be rendered directly — sending them to the proxy just
 * gets a 400 and a broken image.
 */
const GOOGLE_MEDIA_HOST = /^https:\/\/lh\d\.googleusercontent\.com\//;
function mediaSrc(url: string): string {
  return GOOGLE_MEDIA_HOST.test(url) ? `/api/gbp/media/proxy?url=${encodeURIComponent(url)}` : url;
}

const GALLERY_CATEGORIES: MediaCategory[] = ['ADDITIONAL', 'PROFILE'];
const EDITABLE_CATEGORIES: { value: MediaCategory; label: string }[] = [
  { value: 'ADDITIONAL', label: 'Additional' },
  { value: 'PROFILE', label: 'Profile' },
  { value: 'COVER', label: 'Cover' },
  { value: 'LOGO', label: 'Logo' },
];

function StatusBadge({ status, failureReason }: { status: MediaStatus; failureReason?: string }) {
  if (status === 'published')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container/40 text-on-secondary-container text-[10px] font-semibold">
        <CheckCircle2 className="w-3 h-3" /> Live on Google
      </span>
    );
  if (status === 'failed')
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container text-[10px] font-semibold"
        title={failureReason}
      >
        <AlertCircle className="w-3 h-3" /> Failed to publish
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-semibold">
      <Clock className="w-3 h-3" /> Staged — not live yet
    </span>
  );
}

export default function GbpMediaManager({ businessId }: { businessId?: string }) {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveWrites, setLiveWrites] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState<MediaCategory | 'ADD_PHOTO' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaAsset | null>(null);

  const logoInput = useRef<HTMLInputElement | null>(null);
  const coverInput = useRef<HTMLInputElement | null>(null);
  const addPhotoInput = useRef<HTMLInputElement | null>(null);

  const loadMedia = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/gbp/media');
      const json = await res.json();
      setLiveWrites(Boolean(json.liveWritesEnabled));
      if (json.success) setAssets(json.media || []);
      else setError(json.error || 'Could not load media.');
    } catch {
      setError('Could not load your Google Business Profile media.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMedia();
  }, [loadMedia, businessId]);

  const find = (category: MediaCategory, status: MediaStatus | MediaStatus[]) => {
    const statuses = Array.isArray(status) ? status : [status];
    return assets.find((a) => a.category === category && statuses.includes(a.status));
  };

  const logoLive = find('LOGO', 'published');
  const logoPending = find('LOGO', ['staged', 'failed']);
  const coverLive = find('COVER', 'published');
  const coverPending = find('COVER', ['staged', 'failed']);
  const galleryItems = assets.filter((a) => GALLERY_CATEGORIES.includes(a.category));

  const upload = async (category: MediaCategory, file: File, slotKey: MediaCategory | 'ADD_PHOTO') => {
    setUploadingSlot(slotKey);
    setMsg(null);
    try {
      // Google enforces a strict aspect ratio/dimension window for the cover
      // banner and logo — a mismatched photo would otherwise upload fine here
      // and only fail with a raw API error at publish time. Auto-crop/resize
      // to Google's recommended dimensions so every upload is compliant.
      // Best-effort: if the browser can't process it, fall back to the
      // original file rather than blocking the upload.
      let toUpload = file;
      if (category === 'COVER') {
        toUpload = await cropAndResizeImage(file, COVER_TARGET.width, COVER_TARGET.height).catch(() => file);
      } else if (category === 'LOGO') {
        toUpload = await cropAndResizeImage(file, LOGO_TARGET.width, LOGO_TARGET.height).catch(() => file);
      }

      const fd = new FormData();
      fd.append('file', toUpload);
      fd.append('category', category);
      const res = await fetch('/api/gbp/media/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed.');
      setMsg({ ok: true, text: 'Uploaded — review it below, then publish when ready.' });
      await loadMedia();
    } catch (err) {
      setMsg({ ok: false, text: friendlyClientMessage(err, 'Upload failed.') });
    } finally {
      setUploadingSlot(null);
    }
  };

  const publish = async (asset: MediaAsset) => {
    setBusyId(asset._id);
    setMsg(null);
    try {
      const res = await fetch(`/api/gbp/media/${asset._id}/publish`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Publish failed.');
      setMsg({
        ok: json.liveWriteApplied,
        text: json.liveWriteApplied ? 'Published to Google.' : (json.note || 'Live publishing is currently disabled.'),
      });
      await loadMedia();
    } catch (err) {
      setMsg({ ok: false, text: friendlyClientMessage(err, 'Publish failed.') });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (asset: MediaAsset) => {
    if (asset.status === 'published' && !confirm('This photo is live on Google. Remove it from your profile?')) return;
    setBusyId(asset._id);
    setMsg(null);
    try {
      const res = await fetch(`/api/gbp/media/${asset._id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Delete failed.');
      setMsg({ ok: true, text: 'Photo removed.' });
      if (previewAsset?._id === asset._id) setPreviewAsset(null);
      await loadMedia();
    } catch (err) {
      setMsg({ ok: false, text: friendlyClientMessage(err, 'Delete failed.') });
    } finally {
      setBusyId(null);
    }
  };

  const scheduleMedia = async (asset: MediaAsset, isoOrNull: string | null) => {
    setBusyId(asset._id);
    setMsg(null);
    try {
      const res = await fetch(`/api/gbp/media/${asset._id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledFor: isoOrNull }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not schedule.');
      setMsg({
        ok: true,
        text: isoOrNull
          ? `Scheduled — it will auto-publish on ${new Date(isoOrNull).toLocaleString()}.`
          : 'Schedule removed.',
      });
      await loadMedia();
    } catch (err) {
      setMsg({ ok: false, text: friendlyClientMessage(err, 'Could not schedule.') });
    } finally {
      setBusyId(null);
    }
  };

  const changeCategory = async (asset: MediaAsset, category: MediaCategory) => {
    setBusyId(asset._id);
    setMsg(null);
    try {
      const res = await fetch(`/api/gbp/media/${asset._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not change category.');
      await loadMedia();
    } catch (err) {
      setMsg({ ok: false, text: friendlyClientMessage(err, 'Could not change category.') });
    } finally {
      setBusyId(null);
    }
  };

  const renderSingletonSlot = (
    label: string,
    hint: string,
    category: MediaCategory,
    live: MediaAsset | undefined,
    pending: MediaAsset | undefined,
    inputRef: React.RefObject<HTMLInputElement | null>,
  ) => (
    <div className="border border-outline-variant rounded-xl p-4">
      <p className="text-sm font-semibold text-on-surface">{label}</p>
      <p className="text-xs text-outline mt-0.5 mb-3">{hint}</p>

      {live && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wide mb-1.5">Current {label.toLowerCase()}</p>
          <div className="relative rounded-lg overflow-hidden border border-outline-variant aspect-video bg-surface">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mediaSrc(live.url)}
              alt={`Current ${label.toLowerCase()}`}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {pending && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wide">Pending replacement</p>
            <StatusBadge status={pending.status} failureReason={pending.failureReason} />
          </div>
          <div className="relative rounded-lg overflow-hidden border border-outline-variant aspect-video bg-surface mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pending.url} alt="Pending replacement" className="w-full h-full object-cover" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => publish(pending)}
              disabled={busyId === pending._id}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-60"
            >
              {busyId === pending._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
              Publish
            </button>
            <button
              type="button"
              onClick={() => remove(pending)}
              disabled={busyId === pending._id}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant text-xs font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60"
            >
              <Trash2 className="w-3.5 h-3.5" /> Discard
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(category, file, category);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploadingSlot === category}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary text-white text-sm font-semibold transition-colors disabled:opacity-60"
      >
        {uploadingSlot === category ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        {uploadingSlot === category ? 'Uploading…' : live || pending ? `Replace this ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
      </button>
    </div>
  );

  return (
    <div data-tour="upload-photo" className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-sm space-y-5">
      <div className="flex items-center gap-2">
        <ImagePlus className="w-5 h-5 text-primary" />
        <h2 className="text-base font-bold text-on-surface">Photos &amp; Media</h2>
      </div>

      {!liveWrites && (
        <div className="flex items-start gap-2 bg-error-container border border-error-container rounded-xl px-4 py-3 text-sm text-on-error-container">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Preview mode — uploads are staged here. Publishing to Google will start working automatically once live publishing is enabled.</span>
        </div>
      )}

      {msg && (
        <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-secondary-container/40 border border-secondary-fixed text-on-secondary-container' : 'bg-error-container border border-error-container text-on-error-container'}`}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-outline py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading media…
        </div>
      ) : error ? (
        <p className="text-sm text-error">{error}</p>
      ) : (
        <>
          {/* Logo / Cover — singleton slots */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {renderSingletonSlot('Logo', 'Square, your brand mark', 'LOGO', logoLive, logoPending, logoInput)}
            {renderSingletonSlot(
              'Cover photo',
              'Wide, landscape banner — ideally 1024×576px (16:9 ratio). JPG, PNG or WebP, up to 10MB. A different shape will be auto-cropped to fit, so a landscape photo works best.',
              'COVER',
              coverLive,
              coverPending,
              coverInput
            )}
          </div>

          {/* Additional photos — gallery with CRUD + category */}
          <div className="pt-2 border-t border-outline-variant">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-outline uppercase tracking-wide">Additional photos &amp; videos</p>
              <div>
                <input
                  ref={addPhotoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload('ADDITIONAL', file, 'ADD_PHOTO');
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => addPhotoInput.current?.click()}
                  disabled={uploadingSlot === 'ADD_PHOTO'}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold disabled:opacity-60"
                >
                  {uploadingSlot === 'ADD_PHOTO' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                  Add photo / video
                </button>
              </div>
            </div>

            {galleryItems.length === 0 ? (
              <p className="text-sm text-outline">No additional photos yet.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {galleryItems.map((item) => (
                  <div key={item._id} className="border border-outline-variant rounded-xl overflow-hidden bg-surface-container-lowest">
                    <button
                      type="button"
                      onClick={() => setPreviewAsset(item)}
                      className="block w-full aspect-square bg-surface relative group"
                    >
                      <MediaThumb asset={item} className="w-full h-full object-cover" />
                      {item.mediaType === 'video' && (
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[9px] font-bold uppercase tracking-wide">Video</span>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    </button>
                    <div className="p-2.5 space-y-2">
                      <StatusBadge status={item.status} failureReason={item.failureReason} />
                      {item.status !== 'published' && (
                        <div className="rounded-lg bg-surface-container-low border border-outline-variant p-1.5">
                          {item.scheduledFor ? (
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] text-on-surface-variant flex items-center gap-1">
                                <Clock className="w-3 h-3 shrink-0" />
                                {new Date(item.scheduledFor).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                              </span>
                              <button
                                type="button"
                                onClick={() => scheduleMedia(item, null)}
                                disabled={busyId === item._id}
                                className="text-[10px] font-semibold text-on-surface-variant hover:text-error disabled:opacity-60"
                              >
                                Clear
                              </button>
                            </div>
                          ) : (
                            <label className="flex items-center gap-1">
                              <input
                                type="datetime-local"
                                defaultValue={toLocalInputValue()}
                                min={toLocalInputValue()}
                                onChange={(e) => {
                                  if (e.target.value) scheduleMedia(item, new Date(e.target.value).toISOString());
                                }}
                                disabled={busyId === item._id}
                                className="w-full text-[10px] px-1 py-0.5 rounded border border-outline-variant bg-surface disabled:opacity-60"
                                title="Auto-publish at this date/time"
                              />
                            </label>
                          )}
                        </div>
                      )}
                      <select
                        value={item.category}
                        disabled={item.status === 'published' || busyId === item._id}
                        onChange={(e) => changeCategory(item, e.target.value as MediaCategory)}
                        className="w-full text-xs px-2 py-1.5 rounded-lg border border-outline-variant bg-surface disabled:opacity-60 disabled:cursor-not-allowed"
                        title={item.status === 'published' ? "Live on Google — category can't be changed" : 'Change category'}
                      >
                        {EDITABLE_CATEGORIES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-1.5">
                        {item.status !== 'published' && (
                          <button
                            type="button"
                            onClick={() => publish(item)}
                            disabled={busyId === item._id}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-primary text-white text-[11px] font-semibold disabled:opacity-60"
                          >
                            {busyId === item._id ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
                            Publish
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(item)}
                          disabled={busyId === item._id}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg border border-outline-variant text-[11px] font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Full-size preview modal */}
      {previewAsset && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6"
          onClick={() => setPreviewAsset(null)}
        >
          <div
            className="max-w-2xl w-full bg-surface-container-lowest rounded-2xl overflow-hidden card-shadow"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
              <div className="flex items-center gap-2">
                <StatusBadge status={previewAsset.status} failureReason={previewAsset.failureReason} />
                <span className="text-xs text-on-surface-variant">{previewAsset.category}</span>
              </div>
              <button type="button" onClick={() => setPreviewAsset(null)} className="p-1 rounded-lg hover:bg-surface-container-low">
                <X className="w-4 h-4 text-on-surface-variant" />
              </button>
            </div>
            <div className="bg-surface aspect-video">
              <MediaThumb asset={previewAsset} className="w-full h-full object-contain" />
            </div>
            {previewAsset.failureReason && (
              <p className="px-4 pt-3 text-xs text-error">{previewAsset.failureReason}</p>
            )}
            <div className="flex gap-2 p-4">
              {previewAsset.status !== 'published' && (
                <button
                  type="button"
                  onClick={() => publish(previewAsset)}
                  disabled={busyId === previewAsset._id}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-60"
                  title={previewAsset.status === 'failed' ? 'Retry publishing' : undefined}
                >
                  {busyId === previewAsset._id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : previewAsset.status === 'failed' ? (
                    <RefreshCw className="w-4 h-4" />
                  ) : (
                    <UploadCloud className="w-4 h-4" />
                  )}
                  {previewAsset.status === 'failed' ? 'Retry publish' : 'Publish'}
                </button>
              )}
              <button
                type="button"
                onClick={() => remove(previewAsset)}
                disabled={busyId === previewAsset._id}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg border border-outline-variant text-sm font-semibold text-on-surface-variant hover:bg-surface-container-low disabled:opacity-60"
              >
                {busyId === previewAsset._id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
