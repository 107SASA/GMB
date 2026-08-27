'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import {
  UploadCloud, Loader2, Clock, CheckCircle2, AlertCircle, Camera, Film,
  Star, MessageSquareQuote, Sparkles,
} from 'lucide-react';

/**
 * "Success Stories" — the single dashboard tab combining the two
 * superadmin-moderated feeds into growwmatics.com/showcase: photo/video
 * uploads (ShowcaseAsset) and testimonials about GrowwMatics
 * (Testimonial). Previously two separate nav items/pages
 * (/dashboard/showcase, /dashboard/testimonials); merged per the client's
 * request so there's one place to contribute to the public showcase.
 *
 * Sub-tab pattern mirrors ContentWorkspace.tsx: reads ?tab= via
 * useSearchParams so old links/notifications (?tab=photos, ?tab=reviews)
 * still land on the right panel, then plain useState after that.
 */

type TabId = 'photos' | 'reviews';

const ACCEPT = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm';

interface ShowcaseAsset {
  _id: string;
  mediaType: 'photo' | 'video';
  url: string;
  caption?: string;
  featureBusinessName: boolean;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdAt: string;
}

interface Testimonial {
  _id: string;
  reviewerName: string;
  rating: number;
  reviewText: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdAt: string;
}

function StatusBadge({ status, rejectionReason }: { status: 'pending' | 'approved' | 'rejected'; rejectionReason?: string }) {
  if (status === 'approved')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container/40 text-on-secondary-container text-[10px] font-semibold">
        <CheckCircle2 className="w-3 h-3" /> Live on showcase
      </span>
    );
  if (status === 'rejected')
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-error-container text-on-error-container text-[10px] font-semibold"
        title={rejectionReason}
      >
        <AlertCircle className="w-3 h-3" /> Not approved
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[10px] font-semibold">
      <Clock className="w-3 h-3" /> Pending review
    </span>
  );
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} type="button" onClick={() => onChange(s)} className="p-0.5">
          <Star className={`w-6 h-6 ${s <= value ? 'text-primary-fixed-dim fill-primary-fixed-dim' : 'text-outline-variant'}`} />
        </button>
      ))}
    </div>
  );
}

function PhotosVideosTab() {
  const [assets, setAssets] = useState<ShowcaseAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [caption, setCaption] = useState('');
  const [featureBusinessName, setFeatureBusinessName] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/showcase');
      const json = await res.json();
      if (json.success) setAssets(json.assets);
    } catch {
      // best-effort — list just stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleFile = async (file: File) => {
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (caption.trim()) fd.append('caption', caption.trim());
      fd.append('featureBusinessName', String(featureBusinessName));
      const res = await fetch('/api/showcase/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed.');
      setMsg({ ok: true, text: 'Uploaded — it’ll appear on the showcase once approved.' });
      setCaption('');
      await load();
    } catch (err) {
      setMsg({ ok: false, text: friendlyClientMessage(err, 'Upload failed.') });
      toast.error(friendlyClientMessage(err, 'Upload failed.'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6 mb-6">
        <div>
          <label className="block text-sm font-bold text-on-surface mb-1.5">Caption (optional)</label>
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="What's happening in this photo/video?"
            className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary mb-4"
          />
          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={featureBusinessName}
              onChange={(e) => setFeatureBusinessName(e.target.checked)}
              className="w-4 h-4 rounded border-outline-variant"
            />
            <span className="text-sm text-on-surface-variant">Credit my business name alongside this upload</span>
          </label>

          <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            {uploading ? 'Uploading…' : 'Choose photo or video'}
          </button>
          <p className="text-[11px] text-outline mt-2">JPG/PNG/WebP up to 10MB, or MP4/MOV/WebM up to 80MB.</p>

          {msg && (
            <p className={`text-sm mt-3 px-4 py-2.5 rounded-xl ${msg.ok ? 'text-on-secondary-container bg-secondary-container/40' : 'text-on-error-container bg-error-container'}`}>
              {msg.text}
            </p>
          )}
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant">
          <h2 className="font-semibold text-on-surface">Your uploads</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-on-surface-variant text-sm">Loading…</div>
        ) : assets.length === 0 ? (
          <div className="p-8 text-center text-on-surface-variant text-sm">Nothing uploaded yet.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-6">
            {assets.map((a) => (
              <div key={a._id} className="rounded-xl overflow-hidden border border-outline-variant">
                <div className="aspect-square bg-surface-container relative">
                  {a.mediaType === 'video' ? (
                    <video src={a.url} className="w-full h-full object-cover" />
                  ) : (
                    <img src={a.url} alt={a.caption || 'Showcase upload'} className="w-full h-full object-cover" />
                  )}
                  <span className="absolute top-1.5 left-1.5 p-1 rounded-full bg-on-surface/60 text-white">
                    {a.mediaType === 'video' ? <Film className="w-3 h-3" /> : <Camera className="w-3 h-3" />}
                  </span>
                </div>
                <div className="p-2">
                  <StatusBadge status={a.status} rejectionReason={a.rejectionReason} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function LeaveReviewTab() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ reviewerName: '', rating: 5, reviewText: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/testimonials');
      const json = await res.json();
      if (json.success) setItems(json.testimonials);
    } catch {
      // best-effort — list just stays empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!form.reviewerName.trim() || !form.reviewText.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/testimonials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save this review.');
      toast.success('Submitted — it’ll show on our showcase page once approved.');
      setForm({ reviewerName: '', rating: 5, reviewText: '' });
      await load();
    } catch (err) {
      toast.error(friendlyClientMessage(err, 'Could not save this review.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6 mb-6">
        <h2 className="font-semibold text-on-surface mb-4">Leave a review</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-on-surface mb-1.5">Your name *</label>
            <input
              type="text"
              value={form.reviewerName}
              onChange={(e) => setForm((p) => ({ ...p, reviewerName: e.target.value }))}
              placeholder="e.g. Priya Sharma, Owner"
              className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <p className="text-[11px] text-outline mt-1.5">Your business name (from this workspace) is added automatically — no need to type it.</p>
          </div>
          <div>
            <label className="block text-sm font-bold text-on-surface mb-1.5">Rating *</label>
            <StarPicker value={form.rating} onChange={(v) => setForm((p) => ({ ...p, rating: v }))} />
          </div>
          <div>
            <label className="block text-sm font-bold text-on-surface mb-1.5">Review *</label>
            <textarea
              value={form.reviewText}
              onChange={(e) => setForm((p) => ({ ...p, reviewText: e.target.value }))}
              placeholder="How has GrowwMatics helped your business?"
              rows={3}
              className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary resize-none"
            />
          </div>
          <button
            onClick={submit}
            disabled={saving || !form.reviewerName.trim() || !form.reviewText.trim()}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquareQuote className="w-4 h-4" />}
            Submit for approval
          </button>
        </div>
      </div>

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant">
          <h2 className="font-semibold text-on-surface">Your submissions</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-on-surface-variant text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-on-surface-variant text-sm">No reviews added yet.</div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {items.map((t) => (
              <div key={t._id} className="px-6 py-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-sm text-on-surface">{t.reviewerName || 'A GrowwMatics client'}</p>
                  <span className="inline-flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} className={`w-3 h-3 ${s <= t.rating ? 'text-primary-fixed-dim fill-primary-fixed-dim' : 'text-outline-variant'}`} />
                    ))}
                  </span>
                  <StatusBadge status={t.status} rejectionReason={t.rejectionReason} />
                </div>
                <p className="text-sm text-on-surface-variant mt-1">{t.reviewText}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'photos', label: 'Photos & Videos' },
  { id: 'reviews', label: 'Leave a Review' },
];

export default function SuccessStoriesWorkspace() {
  const searchParams = useSearchParams();
  // Old /dashboard/showcase and /dashboard/testimonials links (notifications,
  // bookmarks) now land here with ?tab=photos|reviews so they still open the
  // right panel instead of just bouncing to the default.
  const requested = searchParams.get('tab');
  const initialTab: TabId = requested === 'reviews' ? 'reviews' : 'photos';
  const [tab, setTab] = useState<TabId>(initialTab);

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Success Stories</h1>
          <p className="text-sm text-on-surface-variant">Share photos, video, or a review — approved submissions go live on growwmatics.com/showcase.</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-outline-variant">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-bold border-b-2 transition-colors ${
              tab === t.id
                ? 'border-on-surface text-on-surface'
                : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'photos' ? <PhotosVideosTab /> : <LeaveReviewTab />}
    </div>
  );
}
