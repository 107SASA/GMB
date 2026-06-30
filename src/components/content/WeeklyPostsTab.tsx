'use client';

import { useState } from 'react';
import { GeneratedPost } from '@/services/ai/contentEngine';
import PostCard from './PostCard';
import { Zap, Calendar, CheckCircle, AlertCircle } from 'lucide-react';

interface WeeklyPostsTabProps {
  posts: GeneratedPost[];
}

function getTomorrowAt9AM(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

type ScheduleMode = 'none' | 'auto' | 'manual';

export default function WeeklyPostsTab({ posts }: WeeklyPostsTabProps) {
  const [mode, setMode] = useState<ScheduleMode>('none');

  // Manual state
  const [startDate, setStartDate] = useState(getTomorrowAt9AM);
  const [isScheduling, setIsScheduling] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchResult, setBatchResult] = useState<{ count: number; startLabel: string } | null>(null);

  // Auto state
  const [autoResult, setAutoResult] = useState<{ count: number; firstDate: string; lastDate: string } | null>(null);
  const [autoError, setAutoError] = useState('');

  const handleAutoSchedule = async () => {
    const postIds = posts.filter(p => p._id).map(p => p._id!);
    if (!postIds.length) {
      setAutoError('Posts were not saved — please regenerate.');
      return;
    }

    setIsScheduling(true);
    setAutoError('');
    try {
      const res = await fetch('/api/content/auto-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-schedule failed.');
      setAutoResult({ count: data.count, firstDate: data.firstDate, lastDate: data.lastDate });
    } catch (err: any) {
      setAutoError(err.message);
    } finally {
      setIsScheduling(false);
    }
  };

  const handleManualSchedule = async () => {
    if (!startDate) return;
    setIsScheduling(true);
    setBatchError('');

    const baseDate = new Date(startDate);

    try {
      if (posts.length > 0 && posts[0]._id) {
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
      setMode('none');
    } catch (err: any) {
      setBatchError(err.message);
    } finally {
      setIsScheduling(false);
    }
  };

  const isScheduled = !!batchResult || !!autoResult;

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h3 className="text-xl font-bold text-slate-900">Your Generated Posts</h3>
          <p className="text-slate-500 text-sm mt-1">
            Review and schedule these posts directly to your Google Business Profile.
          </p>
        </div>

        {/* Top-right action area */}
        {isScheduled ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 font-medium">
            <CheckCircle className="w-4 h-4 shrink-0" />
            {autoResult
              ? `${autoResult.count} posts auto-scheduled · ${formatShortDate(autoResult.firstDate)} → ${formatShortDate(autoResult.lastDate)}`
              : `${batchResult!.count} posts scheduled, starting ${batchResult!.startLabel}`
            }
          </div>
        ) : mode === 'none' ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setMode('auto'); setAutoError(''); }}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <Zap className="w-4 h-4" />
              Auto Schedule
            </button>
            <button
              onClick={() => { setMode('manual'); setBatchError(''); }}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 bg-white text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
            >
              <Calendar className="w-4 h-4" />
              Manual Schedule
            </button>
          </div>
        ) : (
          <button
            onClick={() => setMode('none')}
            className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Auto Schedule Panel */}
      {mode === 'auto' && !isScheduled && (
        <div className="mb-6 p-5 bg-indigo-50 border border-indigo-200 rounded-xl space-y-4">
          <div>
            <p className="text-sm font-semibold text-indigo-900 mb-1 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Auto Schedule — one post per day after your last scheduled post
            </p>
            <p className="text-xs text-indigo-700">
              We'll find your most recently scheduled post and queue all {posts.length} new posts immediately after it at 9:00 AM, spaced one day apart.
            </p>
          </div>
          {autoError && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {autoError}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setMode('none')}
              className="px-4 py-2 text-sm border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAutoSchedule}
              disabled={isScheduling}
              className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {isScheduling && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              <Zap className="w-4 h-4" />
              {isScheduling ? 'Scheduling…' : `Auto-Schedule All ${posts.length} Posts`}
            </button>
          </div>
        </div>
      )}

      {/* Manual Schedule Panel */}
      {mode === 'manual' && !isScheduled && (
        <div className="mb-6 p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-1">Pick a start date</p>
            <p className="text-xs text-slate-500">
              All {posts.length} posts will be spaced one day apart, each at the same time, starting from your chosen date.
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
              onClick={() => { setMode('none'); setBatchError(''); }}
              className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleManualSchedule}
              disabled={isScheduling || !startDate}
              className="px-4 py-2 text-sm bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {isScheduling && (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              <Calendar className="w-4 h-4" />
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
