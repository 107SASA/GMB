'use client';

import { useState } from 'react';
import { GeneratedPost } from '@/services/ai/contentEngine';
import PostCard from './PostCard';

interface WeeklyPostsTabProps {
  posts: GeneratedPost[];
}

function getTomorrowAt9AM(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

function formatShortDate(isoLocal: string): string {
  return new Date(isoLocal).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export default function WeeklyPostsTab({ posts }: WeeklyPostsTabProps) {
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [startDate, setStartDate] = useState(getTomorrowAt9AM);
  const [isScheduling, setIsScheduling] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchResult, setBatchResult] = useState<{ count: number; startLabel: string } | null>(null);

  const handleScheduleAll = async () => {
    if (!startDate) return;
    setIsScheduling(true);
    setBatchError('');

    const baseDate = new Date(startDate);

    try {
      if (posts.length > 0 && posts[0]._id) {
        // Posts were pre-saved as drafts — update each one via the scheduler route.
        const results = await Promise.all(
          posts.map((post, i) => {
            const scheduled = new Date(baseDate);
            scheduled.setDate(scheduled.getDate() + i);
            return fetch('/api/scheduler/schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ postId: post._id, scheduledDate: scheduled.toISOString() }),
            }).then(r => r.json().then(d => ({ ok: r.ok, data: d })));
          })
        );
        const failed = results.filter(r => !r.ok);
        if (failed.length > 0) throw new Error(failed[0].data.error || 'Failed to schedule some posts');
      } else {
        // Fallback: no pre-saved IDs, create via batch endpoint.
        const postsPayload = posts.map((post, i) => {
          const scheduled = new Date(baseDate);
          scheduled.setDate(scheduled.getDate() + i);
          return {
            title: post.title,
            content: post.body,
            postType: post.postType,
            hashtags: post.hashtags,
            cta: post.cta,
            scheduledDate: scheduled.toISOString(),
          };
        });
        const res = await fetch('/api/content/schedule/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ posts: postsPayload }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to schedule posts');
      }

      setBatchResult({ count: posts.length, startLabel: formatShortDate(startDate) });
      setShowSchedulePanel(false);
    } catch (err: any) {
      setBatchError(err.message);
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Your Generated Posts</h3>
          <p className="text-slate-500 text-sm mt-1">
            Review and schedule these posts directly to your Google Business Profile.
          </p>
        </div>

        {batchResult ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {batchResult.count} posts scheduled, starting {batchResult.startLabel}
          </div>
        ) : (
          <button
            onClick={() => { setShowSchedulePanel((v) => !v); setBatchError(''); }}
            className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
          >
            {showSchedulePanel ? 'Cancel' : 'Schedule All'}
          </button>
        )}
      </div>

      {/* Inline date-picker panel for Schedule All */}
      {showSchedulePanel && !batchResult && (
        <div className="mb-6 p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-1">Pick a start date</p>
            <p className="text-xs text-slate-500">
              All {posts.length} posts will be spaced one day apart, each at the same time, starting from
              your chosen date.
            </p>
          </div>
          <input
            type="datetime-local"
            value={startDate}
            min={new Date().toISOString().slice(0, 16)}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
          {batchError && (
            <p className="text-sm text-red-500">{batchError}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => { setShowSchedulePanel(false); setBatchError(''); }}
              className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleScheduleAll}
              disabled={isScheduling || !startDate}
              className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {isScheduling && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              {isScheduling ? 'Scheduling…' : `Schedule All ${posts.length} Posts`}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {posts.map((post, index) => (
          <PostCard key={index} post={post} />
        ))}
      </div>
    </div>
  );
}
