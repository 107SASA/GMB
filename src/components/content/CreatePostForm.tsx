'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

/**
 * Manual Google Business Profile post. Same endpoints as the mobile "+" flow:
 * POST /api/posts creates the draft, then /api/scheduler/publish or
 * /api/scheduler/schedule. The server geotags an uploaded image from the
 * verified business location. This form never sends the browser's GPS.
 */
export default function CreatePostForm({ onCreated, onClose }: { onCreated: () => void; onClose: () => void }) {
  const [content, setContent] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [image, setImage] = useState<{ dataUrl: string; base64: string; mime: string } | null>(null);
  const [busy, setBusy] = useState<'publish' | 'schedule' | null>(null);
  const [error, setError] = useState('');
  const draftId = useRef<string | null>(null);

  const onFile = (file: File | null) => {
    setError('');
    if (!file) {
      setImage(null);
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Use a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Image must be 8 MB or smaller.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      if (!base64) {
        setError('Could not read that image.');
        return;
      }
      draftId.current = null;
      setImage({ dataUrl, base64, mime: file.type });
    };
    reader.readAsDataURL(file);
  };

  const submit = async (mode: 'publish' | 'schedule') => {
    const text = content.trim();
    if (!text) {
      setError('Write the post text.');
      return;
    }
    let scheduledDate: string | null = null;
    if (mode === 'schedule') {
      if (!date || !time) {
        setError('Pick a date and time to schedule.');
        return;
      }
      scheduledDate = new Date(`${date}T${time}:00`).toISOString();
      if (Number.isNaN(new Date(scheduledDate).getTime()) || new Date(scheduledDate).getTime() <= Date.now()) {
        setError('Pick a future date and time.');
        return;
      }
    }

    setBusy(mode);
    setError('');
    try {
      let postId = draftId.current;
      if (!postId) {
        const created = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: text.slice(0, 80),
            content: text,
            imageBase64: image?.base64,
            imageMime: image?.mime,
          }),
        });
        const createdJson = await created.json().catch(() => ({}));
        if (!created.ok) throw new Error(createdJson.message || createdJson.error || 'Could not create the post');
        postId = createdJson.post?._id;
        if (!postId) throw new Error('Could not create the post');
        draftId.current = postId;
      }

      if (mode === 'publish') {
        const res = await fetch('/api/scheduler/publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || json.message || 'Could not publish');
        if (json.blocked) toast.message(json.message || 'Scheduled in GrowwMatics — Google publishing has not been executed.');
        else toast.success('Published to your Google Business Profile.');
      } else {
        const res = await fetch('/api/scheduler/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId, scheduledDate }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || json.message || 'Could not schedule');
        toast.success('Post scheduled.');
      }
      onCreated();
      onClose();
    } catch (err) {
      setError(friendlyClientMessage(err, 'Could not save the post'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-on-surface">Create Post</h2>
        <button type="button" onClick={onClose} className="text-sm font-medium text-on-surface-variant">
          Close
        </button>
      </div>

      <label className="block text-sm font-semibold text-on-surface">
        Post
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            draftId.current = null;
          }}
          rows={5}
          maxLength={1500}
          placeholder="Write your Google Business Profile post…"
          className="mt-1.5 w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface"
        />
      </label>

      <label className="block text-sm font-semibold text-on-surface">
        Image
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="mt-1.5 block w-full text-sm text-on-surface-variant"
          onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        />
      </label>

      <div className="rounded-xl border border-outline-variant overflow-hidden">
        <p className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">Preview</p>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image.dataUrl} alt="" className="mt-2 h-40 w-full object-cover" />
        )}
        <p className="px-3 py-3 text-sm text-on-surface whitespace-pre-wrap">
          {content.trim() || 'Your post text will appear here.'}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="text-sm font-semibold text-on-surface">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 block rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm" />
        </label>
        <label className="text-sm font-semibold text-on-surface">
          Time
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 block rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm" />
        </label>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void submit('publish')}
          className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-50"
        >
          {busy === 'publish' ? 'Publishing…' : 'Publish now'}
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => void submit('schedule')}
          className="rounded-full border border-outline-variant px-4 py-2 text-sm font-bold text-on-surface disabled:opacity-50"
        >
          {busy === 'schedule' ? 'Scheduling…' : 'Schedule post'}
        </button>
      </div>
    </div>
  );
}
