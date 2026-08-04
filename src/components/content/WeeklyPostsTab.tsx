'use client';

import { useState, useEffect, useRef } from 'react';
import { GeneratedPost } from '@/services/ai/contentEngine';
import PostCard from './PostCard';
import { Zap, Calendar, CheckCircle, AlertCircle } from 'lucide-react';
import { defaultScheduleDateTimeLocal, nowDateTimeLocal } from '@/lib/scheduleTime';

interface WeeklyPostsTabProps {
  posts: GeneratedPost[];
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
  const [startDate, setStartDate] = useState(defaultScheduleDateTimeLocal);
  const [isScheduling, setIsScheduling] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [batchResult, setBatchResult] = useState<{ count: number; startLabel: string } | null>(null);

  // Auto state
  const [autoResult, setAutoResult] = useState<{ count: number; firstDate: string; lastDate: string } | null>(null);
  const [autoError, setAutoError] = useState('');

  // Thumbnails are generated in the background after generation returns, so poll
  // for them and merge the URLs in as they land. Stops once every post that
  // expects an image has one (or after a safety cap so it never polls forever).
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const pollAttempts = useRef(0);
  useEffect(() => {
    const pendingIds = () =>
      posts
        .filter(p => p._id && p.thumbnailPrompt && !p.imageUrl && !imageMap[p._id!])
        .map(p => p._id!);

    if (pendingIds().length === 0) return;

    let stopped = false;
    const MAX_ATTEMPTS = 30; // ~30 × 4s = 2 min ceiling
    const tick = async () => {
      const ids = pendingIds();
      if (ids.length === 0 || pollAttempts.current >= MAX_ATTEMPTS) { stopped = true; return; }
      pollAttempts.current += 1;
      try {
        const res = await fetch(`/api/content/posts/images?ids=${ids.join(',')}`);
        const json = await res.json();
        if (json?.images) {
          const resolved = Object.entries(json.images).filter(([, url]) => !!url) as [string, string][];
          if (resolved.length) {
            setImageMap(prev => ({ ...prev, ...Object.fromEntries(resolved) }));
          }
        }
      } catch {
        /* transient — retry on next tick */
      }
    };
    tick();
    const interval = setInterval(() => {
      if (stopped) { clearInterval(interval); return; }
      tick();
    }, 4000);
    return () => clearInterval(interval);
  }, [posts, imageMap]);

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
          <h3 className="text-xl font-bold text-on-surface">Your Generated Posts</h3>
          <p className="text-on-surface-variant text-sm mt-1">
            Review and schedule these posts directly to your Google Business Profile.
          </p>
        </div>

        {/* Top-right action area */}
        {isScheduled ? (
          <div className="flex items-center gap-2 px-4 py-2 bg-secondary-container/40 border border-secondary-fixed rounded-lg text-sm text-on-secondary-container font-medium">
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
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-container transition-colors shadow-sm"
            >
              <Zap className="w-4 h-4" />
              Auto Schedule
            </button>
            <button
              onClick={() => { setMode('manual'); setBatchError(''); }}
              className="flex items-center gap-2 px-4 py-2 border border-outline-variant bg-surface-container-lowest text-on-surface text-sm font-semibold rounded-lg hover:bg-surface transition-colors shadow-sm"
            >
              <Calendar className="w-4 h-4" />
              Manual Schedule
            </button>
          </div>
        ) : (
          <button
            onClick={() => setMode('none')}
            className="text-sm text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Auto Schedule Panel */}
      {mode === 'auto' && !isScheduled && (
        <div className="mb-6 p-5 bg-primary-fixed border border-primary-fixed-dim rounded-xl space-y-4">
          <div>
            <p className="text-sm font-semibold text-primary mb-1 flex items-center gap-2">
              <Zap className="w-4 h-4" />
              Auto Schedule — one post per day after your last scheduled post
            </p>
            <p className="text-xs text-primary">
              We'll find your most recently scheduled post and queue all {posts.length} new posts immediately after it at 9:00 AM, spaced one day apart.
            </p>
          </div>
          {autoError && (
            <div className="flex items-center gap-2 text-sm text-error">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {autoError}
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setMode('none')}
              className="px-4 py-2 text-sm border border-primary-fixed-dim text-primary rounded-lg hover:bg-primary-fixed transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAutoSchedule}
              disabled={isScheduling}
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-container transition-colors disabled:opacity-60 flex items-center gap-2"
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
        <div className="mb-6 p-5 bg-surface border border-outline-variant rounded-xl space-y-4">
          <div>
            <p className="text-sm font-semibold text-on-surface mb-1">Pick a start date</p>
            <p className="text-xs text-on-surface-variant">
              All {posts.length} posts will be spaced one day apart, each at the same time, starting from your chosen date.
            </p>
          </div>
          <input
            type="datetime-local"
            value={startDate}
            min={nowDateTimeLocal()}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 text-sm border border-outline-variant rounded-lg focus:ring-2 focus:ring-primary focus:outline-none"
          />
          {batchError && (
            <p className="text-sm text-error">{batchError}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => { setMode('none'); setBatchError(''); }}
              className="px-4 py-2 text-sm border border-outline-variant rounded-lg hover:bg-surface-container transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleManualSchedule}
              disabled={isScheduling || !startDate}
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary transition-colors disabled:opacity-60 flex items-center gap-2"
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
          <PostCard
            key={post._id ?? index}
            post={post._id && imageMap[post._id] && !post.imageUrl ? { ...post, imageUrl: imageMap[post._id] } : post}
          />
        ))}
      </div>
    </div>
  );
}
