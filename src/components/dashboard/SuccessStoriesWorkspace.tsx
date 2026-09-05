'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';
import {
  Loader2, Clock, CheckCircle2, AlertCircle, Video, Circle, Square, RotateCcw,
  Star, MessageSquareQuote, Sparkles,
} from 'lucide-react';

/**
 * "Success Stories" — the single dashboard page combining the two
 * superadmin-moderated feeds into growwmatics.com/showcase: a video upload
 * (ShowcaseAsset) and a testimonial about GrowwMatics (Testimonial).
 *
 * One-time-only (owner's explicit call, Sep 2026): each business gets
 * exactly one video and one review, ever — enforced server-side
 * (/api/showcase/upload, /api/testimonials both 409 on a resubmit; a
 * REJECTED submission doesn't count, so an admin rejection isn't a
 * permanent lockout). /api/success-stories/status is the single source of
 * truth for "already done" that this page, and the SuccessStoryPrompt popup
 * that links here, both read.
 *
 * No longer a sidebar link — reached via that popup (shown once per login
 * session until both are done) or a direct URL. Photo upload was removed
 * entirely; video is recorded in-browser (getUserMedia + MediaRecorder), not
 * picked from a file.
 *
 * Sub-tab pattern mirrors ContentWorkspace.tsx: reads ?tab= via
 * useSearchParams so old links/notifications (?tab=photos, ?tab=reviews)
 * still land on the right panel, then plain useState after that.
 */

type TabId = 'video' | 'reviews';

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

/**
 * Shown in place of the form once that item is already submitted (pending
 * or approved). `item` is only the specific record for its own status
 * badge — deliberately optional: /api/success-stories/status (which drives
 * `done`) and the /api/showcase or /api/testimonials list fetch (which
 * drives `item`) are two separate requests, so a done=true / item=null
 * combination (the list fetch failing while status succeeds) must still
 * show this card rather than falling through to the live submission form
 * for something the server will just 409 on anyway.
 */
function AlreadyDoneCard({ label, item }: { label: string; item: { status: 'pending' | 'approved' | 'rejected'; rejectionReason?: string } | null }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6 text-center">
      <CheckCircle2 className="w-8 h-8 text-secondary mx-auto mb-2" />
      <p className="font-semibold text-on-surface">You&apos;ve already submitted a {label} — thank you!</p>
      <p className="text-sm text-on-surface-variant mt-1">Only one {label} is needed per business.</p>
      {item && (
        <div className="mt-3 flex justify-center">
          <StatusBadge status={item.status} rejectionReason={item.rejectionReason} />
        </div>
      )}
    </div>
  );
}

const MAX_RECORD_SECONDS = 60;

function VideoTab({ done, existing, onSubmitted }: {
  done: boolean;
  existing: ShowcaseAsset | null;
  onSubmitted: () => void;
}) {
  const previewRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<'idle' | 'recording' | 'preview' | 'submitting'>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [caption, setCaption] = useState('');
  const [featureBusinessName, setFeatureBusinessName] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop any live camera/timer if the user navigates away mid-recording.
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopStream();
  }, []);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        previewRef.current.muted = true; // avoid feedback while the live preview plays
        await previewRef.current.play().catch(() => {});
      }

      chunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
        setPhase('preview');
        stopStream();
      };
      recorderRef.current = recorder;
      recorder.start();
      setPhase('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          if (s + 1 >= MAX_RECORD_SECONDS) {
            recorderRef.current?.stop();
            if (timerRef.current) clearInterval(timerRef.current);
            return MAX_RECORD_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      setError('Could not access your camera/microphone. Check your browser permissions and try again.');
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    recorderRef.current?.stop();
  };

  const retake = () => {
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setError(null);
    setPhase('idle');
  };

  const submit = async () => {
    if (!recordedBlob) return;
    setPhase('submitting');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', recordedBlob, 'success-story.webm');
      if (caption.trim()) fd.append('caption', caption.trim());
      fd.append('featureBusinessName', String(featureBusinessName));
      const res = await fetch('/api/showcase/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed.');
      toast.success('Video submitted — it’ll appear on the showcase once approved.');
      onSubmitted();
    } catch (err) {
      setError(friendlyClientMessage(err, 'Upload failed.'));
      setPhase('preview');
    }
  };

  if (done) {
    return <AlreadyDoneCard label="video" item={existing} />;
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
      <div className="aspect-video bg-surface-container rounded-xl overflow-hidden relative mb-4">
        {phase === 'preview' && recordedUrl ? (
          <video src={recordedUrl} controls className="w-full h-full object-cover" />
        ) : (
          <video ref={previewRef} className="w-full h-full object-cover" playsInline />
        )}
        {phase === 'idle' && !recordedUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-on-surface-variant text-sm gap-2">
            <Video className="w-5 h-5" /> Camera preview appears here
          </div>
        )}
        {phase === 'recording' && (
          <span className="absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-error text-white text-xs font-bold">
            <Circle className="w-2 h-2 fill-white animate-pulse" /> REC {elapsed}s / {MAX_RECORD_SECONDS}s
          </span>
        )}
      </div>

      {phase === 'idle' && (
        <button
          onClick={startRecording}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl"
        >
          <Video className="w-4 h-4" /> Start recording
        </button>
      )}
      {phase === 'recording' && (
        <button
          onClick={stopRecording}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold text-white bg-error hover:bg-error rounded-xl"
        >
          <Square className="w-4 h-4" /> Stop recording
        </button>
      )}
      {(phase === 'preview' || phase === 'submitting') && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-on-surface mb-1.5">Caption (optional)</label>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="What's happening in this video?"
              disabled={phase === 'submitting'}
              className="w-full px-4 py-2.5 text-sm border border-outline-variant rounded-xl focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={featureBusinessName}
              onChange={(e) => setFeatureBusinessName(e.target.checked)}
              disabled={phase === 'submitting'}
              className="w-4 h-4 rounded border-outline-variant"
            />
            <span className="text-sm text-on-surface-variant">Credit my business name alongside this video</span>
          </label>
          <div className="flex gap-3">
            <button
              onClick={retake}
              disabled={phase === 'submitting'}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-on-surface bg-surface-container hover:bg-surface-container-high rounded-xl disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            <button
              onClick={submit}
              disabled={phase === 'submitting'}
              className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl disabled:opacity-50"
            >
              {phase === 'submitting' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {phase === 'submitting' ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </div>
      )}

      <p className="text-[11px] text-outline mt-3">Recorded in your browser, up to {MAX_RECORD_SECONDS} seconds. Up to 80MB.</p>
      {error && (
        <p className="text-sm mt-3 px-4 py-2.5 rounded-xl text-on-error-container bg-error-container">{error}</p>
      )}
    </div>
  );
}

function LeaveReviewTab({ done, existing, onSubmitted }: {
  done: boolean;
  existing: Testimonial | null;
  onSubmitted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ reviewerName: '', rating: 5, reviewText: '' });

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
      onSubmitted();
    } catch (err) {
      toast.error(friendlyClientMessage(err, 'Could not save this review.'));
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return <AlreadyDoneCard label="review" item={existing} />;
  }

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-6">
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
          Submit
        </button>
      </div>
    </div>
  );
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'video', label: 'Video' },
  { id: 'reviews', label: 'Leave a Review' },
];

export default function SuccessStoriesWorkspace() {
  const searchParams = useSearchParams();
  // Old ?tab=photos still lands on the video tab (photo upload no longer
  // exists as a separate concept) — old /dashboard/testimonials links with
  // ?tab=reviews keep working unchanged.
  const requested = searchParams.get('tab');
  const initialTab: TabId = requested === 'reviews' ? 'reviews' : 'video';
  const [tab, setTab] = useState<TabId>(initialTab);

  const [loading, setLoading] = useState(true);
  const [videoDone, setVideoDone] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [existingVideo, setExistingVideo] = useState<ShowcaseAsset | null>(null);
  const [existingReview, setExistingReview] = useState<Testimonial | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, assetsRes, testimonialsRes] = await Promise.all([
        fetch('/api/success-stories/status').then((r) => r.json()),
        fetch('/api/showcase').then((r) => r.json()),
        fetch('/api/testimonials').then((r) => r.json()),
      ]);
      if (statusRes.success) {
        setVideoDone(statusRes.videoDone);
        setReviewDone(statusRes.reviewDone);
      }
      if (assetsRes.success) {
        setExistingVideo(assetsRes.assets.find((a: ShowcaseAsset) => a.mediaType === 'video') ?? null);
      }
      if (testimonialsRes.success) {
        setExistingReview(testimonialsRes.testimonials[0] ?? null);
      }
    } catch {
      // best-effort — forms just default to "not done yet"
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const bothDone = videoDone && reviewDone;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 bg-primary rounded-xl flex items-center justify-center shadow-sm">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-heading text-2xl font-bold text-on-surface">Success Stories</h1>
          <p className="text-sm text-on-surface-variant">Share a video and a review — approved submissions go live on growwmatics.com/showcase. One of each, ever.</p>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-on-surface-variant text-sm">Loading…</div>
      ) : bothDone ? (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant card-shadow p-8 text-center">
          <CheckCircle2 className="w-10 h-10 text-secondary mx-auto mb-3" />
          <p className="font-semibold text-on-surface text-lg">You&apos;re all set — thank you!</p>
          <p className="text-sm text-on-surface-variant mt-1">
            You&apos;ve submitted both a video and a review. We&apos;ll be in touch once they&apos;re live on the showcase.
          </p>
        </div>
      ) : (
        <>
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

          {tab === 'video' ? (
            <VideoTab done={videoDone} existing={existingVideo} onSubmitted={load} />
          ) : (
            <LeaveReviewTab done={reviewDone} existing={existingReview} onSubmitted={load} />
          )}
        </>
      )}
    </div>
  );
}
