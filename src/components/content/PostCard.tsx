'use client';

import { useState, useEffect } from 'react';
import { GeneratedPost } from '@/services/ai/contentEngine';
import { defaultScheduleDateTimeLocal, nowDateTimeLocal } from '@/lib/scheduleTime';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

interface PostCardProps {
  post: GeneratedPost;
  // Set by the parent when this post was just scheduled as part of a batch
  // action (Auto Schedule / Manual Schedule all) rather than through this
  // card's own inline date picker — without it, a card scheduled in bulk
  // would keep showing an active "Schedule" button (and let you schedule it
  // again) since its own local confirmedDate state never gets set.
  scheduledAt?: string;
}

function formatScheduledDate(isoLocal: string): string {
  const d = new Date(isoLocal);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${day} · ${time}`;
}

export default function PostCard({ post: initialPost, scheduledAt }: PostCardProps) {
  const [post, setPost] = useState(initialPost);
  const [isEditing, setIsEditing] = useState(false);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(defaultScheduleDateTimeLocal);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);

  // Either this card was scheduled through its own inline picker, or the
  // parent just batch-scheduled it (Auto Schedule / Manual Schedule all) —
  // either way the Schedule button must not stay active.
  const effectiveScheduledDate = confirmedDate ?? scheduledAt ?? null;

  const [imgError, setImgError] = useState(false);

  // Thumbnails are generated in the background after the post is created, so the
  // parent list polls and feeds a fresh `imageUrl` in via props — sync it in
  // (without clobbering any in-progress edits to the rest of the post).
  useEffect(() => {
    if (initialPost.imageUrl && initialPost.imageUrl !== post.imageUrl) {
      setPost(p => ({ ...p, imageUrl: initialPost.imageUrl }));
      setImgError(false);
    }
  }, [initialPost.imageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScheduleClick = () => {
    setScheduledDate(defaultScheduleDateTimeLocal());
    setScheduleError('');
    setShowDatePicker(true);
  };

  const handleScheduleConfirm = async () => {
    if (!scheduledDate) return;
    setIsScheduling(true);
    setScheduleError('');
    try {
      const isoDate = new Date(scheduledDate).toISOString();

      if (post._id) {
        const res = await fetch('/api/scheduler/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: post._id, scheduledDate: isoDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to schedule post');
      } else {
        const res = await fetch('/api/content/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: post.title,
            content: post.body,
            postType: post.postType,
            hashtags: post.hashtags,
            cta: post.cta,
            scheduledDate: isoDate,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to schedule post');
      }

      setConfirmedDate(scheduledDate);
      setShowDatePicker(false);
    } catch (err: any) {
      setScheduleError(friendlyClientMessage(err));
    } finally {
      setIsScheduling(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `${post.title}\n\n${post.body}\n\n${post.cta}\n\n${post.hashtags.join(' ')}`
    );
  };

  const showThumbnail = !!post.imageUrl && !imgError;
  // A thumbnail is on the way (prompt exists, image not saved yet) → show a
  // loading state instead of an empty box until the background job finishes.
  const imagePending = !post.imageUrl && !imgError && !!post.thumbnailPrompt;

  if (isEditing) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm flex flex-col h-full">
        <input
          value={post.title}
          onChange={(e) => setPost({ ...post, title: e.target.value })}
          className="font-bold text-on-surface w-full mb-3 px-2 py-1 border rounded"
        />
        <textarea
          value={post.body}
          onChange={(e) => setPost({ ...post, body: e.target.value })}
          className="text-sm text-on-surface-variant grow w-full mb-3 px-2 py-1 border rounded h-32 resize-none"
        />
        <input
          value={post.cta}
          onChange={(e) => setPost({ ...post, cta: e.target.value })}
          className="font-semibold text-sm w-full mb-3 px-2 py-1 border rounded"
        />
        <input
          value={post.hashtags.join(' ')}
          onChange={(e) => setPost({ ...post, hashtags: e.target.value.split(' ') })}
          className="text-xs text-primary w-full mb-4 px-2 py-1 border rounded"
        />
        <button
          onClick={() => setIsEditing(false)}
          className="w-full py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary"
        >
          Save Edits
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm hover:card-shadow transition-shadow flex flex-col h-full relative group overflow-hidden">

      {/* Thumbnail */}
      {showThumbnail ? (
        <div className="relative w-full h-40 bg-surface-container shrink-0">
          <img
            src={post.imageUrl!}
            alt={post.title}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        </div>
      ) : imagePending ? (
        // Thumbnail still generating in the background — animated skeleton.
        <div className="relative w-full h-40 shrink-0 overflow-hidden bg-linear-to-br from-primary to-surface-container flex items-center justify-center animate-pulse">
          <div className="relative text-center px-4">
            <svg className="w-6 h-6 text-primary-fixed-dim mx-auto mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <p className="text-xs font-medium text-primary">Your thumbnail is being generated…</p>
          </div>
        </div>
      ) : (
        <div className="w-full h-40 bg-linear-to-br from-primary to-surface-container flex items-center justify-center shrink-0">
          <div className="text-center px-4">
            <div className="w-10 h-10 bg-primary-fixed rounded-xl mx-auto mb-2 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary-fixed-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <p className="text-xs text-outline">
              {post.imageUrl ? 'Image unavailable' : 'No thumbnail generated'}
            </p>
          </div>
        </div>
      )}

      <div className="p-5 flex flex-col flex-1">
        <div className="flex justify-between items-start mb-4">
          <span className="inline-block px-2.5 py-1 bg-primary-fixed text-primary text-xs font-bold rounded-md">
            {post.dayLabel}
          </span>
          <span className="inline-block px-2.5 py-1 bg-surface-container text-on-surface-variant text-xs font-semibold rounded-md border border-outline-variant">
            {post.postType}
          </span>
        </div>

        <h4 className="font-bold text-on-surface mb-2 leading-snug">{post.title}</h4>
        <p className="text-sm text-on-surface-variant mb-4 whitespace-pre-wrap grow">{post.body}</p>

        <div className="mb-3">
          <p className="font-semibold text-sm text-on-surface">
            CTA: <span className="font-normal text-on-surface-variant">{post.cta}</span>
          </p>
        </div>

        <div className="flex flex-wrap gap-1 mb-5">
          {post.hashtags.map((tag, i) => (
            <span key={i} className="text-xs text-primary bg-primary-fixed px-2 py-0.5 rounded-sm">
              {tag}
            </span>
          ))}
        </div>

        {/* Inline date picker */}
        {showDatePicker && !effectiveScheduledDate && (
          <div className="mb-4 p-3 bg-surface border border-outline-variant rounded-lg space-y-2">
            <p className="text-xs font-semibold text-on-surface-variant">Pick a date &amp; time:</p>
            <input
              type="datetime-local"
              value={scheduledDate}
              min={nowDateTimeLocal()}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
            />
            {scheduleError && (
              <p className="text-xs text-error leading-tight">{scheduleError}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowDatePicker(false); setScheduleError(''); }}
                className="flex-1 py-1.5 text-sm border border-outline-variant rounded-lg hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleScheduleConfirm}
                disabled={isScheduling}
                className="flex-1 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary transition-colors disabled:opacity-60"
              >
                {isScheduling ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 mt-auto">
          {effectiveScheduledDate ? (
            <div className="col-span-2 py-2 px-3 bg-secondary-container/40 border border-secondary-fixed rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 text-secondary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-xs font-medium text-on-secondary-container">
                Scheduled for {formatScheduledDate(effectiveScheduledDate)}
              </span>
            </div>
          ) : (
            <>
              <button
                onClick={() => setIsEditing(true)}
                className="py-2 border border-outline-variant text-on-surface rounded-lg text-sm font-medium hover:bg-surface transition-colors"
              >
                Edit
              </button>
              <button
                onClick={showDatePicker ? undefined : handleScheduleClick}
                disabled={isScheduling}
                className="py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary transition-colors disabled:opacity-70"
              >
                {isScheduling ? '…' : 'Schedule'}
              </button>
            </>
          )}
        </div>
      </div>

      <button
        onClick={handleCopy}
        title="Copy to clipboard"
        className="absolute top-44 right-4 text-outline hover:text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2-2v8a2 2 0 002 2z" />
        </svg>
      </button>
    </div>
  );
}
