'use client';

import { useState } from 'react';
import { GeneratedPost } from '@/services/ai/contentEngine';

interface PostCardProps {
  post: GeneratedPost;
}

function getTomorrowAt9AM(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

function formatScheduledDate(isoLocal: string): string {
  const d = new Date(isoLocal);
  const day = d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${day} · ${time}`;
}

export default function PostCard({ post: initialPost }: PostCardProps) {
  const [post, setPost] = useState(initialPost);
  const [isEditing, setIsEditing] = useState(false);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [scheduledDate, setScheduledDate] = useState(getTomorrowAt9AM);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);

  const handleScheduleClick = () => {
    setScheduledDate(getTomorrowAt9AM());
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
        // Draft already exists in MongoDB — update it via the scheduler route.
        const res = await fetch('/api/scheduler/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: post._id, scheduledDate: isoDate }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to schedule post');
      } else {
        // Fallback: draft wasn't pre-saved (shouldn't happen with the new generate
        // flow), so create a new scheduled post the old way.
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
      setScheduleError(err.message);
    } finally {
      setIsScheduling(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `${post.title}\n\n${post.body}\n\n${post.cta}\n\n${post.hashtags.join(' ')}`
    );
  };

  if (isEditing) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col h-full">
        <input
          value={post.title}
          onChange={(e) => setPost({ ...post, title: e.target.value })}
          className="font-bold text-slate-900 w-full mb-3 px-2 py-1 border rounded"
        />
        <textarea
          value={post.body}
          onChange={(e) => setPost({ ...post, body: e.target.value })}
          className="text-sm text-slate-600 grow w-full mb-3 px-2 py-1 border rounded h-32 resize-none"
        />
        <input
          value={post.cta}
          onChange={(e) => setPost({ ...post, cta: e.target.value })}
          className="font-semibold text-sm w-full mb-3 px-2 py-1 border rounded"
        />
        <input
          value={post.hashtags.join(' ')}
          onChange={(e) => setPost({ ...post, hashtags: e.target.value.split(' ') })}
          className="text-xs text-blue-600 w-full mb-4 px-2 py-1 border rounded"
        />
        <button
          onClick={() => setIsEditing(false)}
          className="w-full py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800"
        >
          Save Edits
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col h-full relative group">
      <div className="flex justify-between items-start mb-4">
        <span className="inline-block px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-md">
          {post.dayLabel}
        </span>
        <span className="inline-block px-2.5 py-1 bg-slate-100 text-slate-600 text-xs font-semibold rounded-md border border-slate-200">
          {post.postType}
        </span>
      </div>

      <h4 className="font-bold text-slate-900 mb-2 leading-snug">{post.title}</h4>
      <p className="text-sm text-slate-600 mb-4 whitespace-pre-wrap grow">{post.body}</p>

      <div className="mb-3">
        <p className="font-semibold text-sm text-slate-800">
          CTA: <span className="font-normal text-slate-600">{post.cta}</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-1 mb-5">
        {post.hashtags.map((tag, i) => (
          <span key={i} className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-sm">
            {tag}
          </span>
        ))}
      </div>

      {/* Inline date picker */}
      {showDatePicker && !confirmedDate && (
        <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
          <p className="text-xs font-semibold text-slate-600">Pick a date &amp; time:</p>
          <input
            type="datetime-local"
            value={scheduledDate}
            min={new Date().toISOString().slice(0, 16)}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
          {scheduleError && (
            <p className="text-xs text-red-500 leading-tight">{scheduleError}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setShowDatePicker(false); setScheduleError(''); }}
              className="flex-1 py-1.5 text-sm border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleScheduleConfirm}
              disabled={isScheduling}
              className="flex-1 py-1.5 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-60"
            >
              {isScheduling ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mt-auto">
        {confirmedDate ? (
          <div className="col-span-2 py-2 px-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs font-medium text-green-700">
              Scheduled for {formatScheduledDate(confirmedDate)}
            </span>
          </div>
        ) : (
          <>
            <button
              onClick={() => setIsEditing(true)}
              className="py-2 border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Edit
            </button>
            <button
              onClick={showDatePicker ? undefined : handleScheduleClick}
              disabled={isScheduling}
              className="py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-70"
            >
              {isScheduling ? '…' : 'Schedule'}
            </button>
          </>
        )}
      </div>

      <button
        onClick={handleCopy}
        title="Copy to clipboard"
        className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2-2v8a2 2 0 002 2z" />
        </svg>
      </button>
    </div>
  );
}
