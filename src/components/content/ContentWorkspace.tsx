'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useBusiness } from '@/context/BusinessContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import ContentHistoryTab from './ContentHistoryTab';
import WeeklyCalendar from '@/components/scheduler/WeeklyCalendar';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

// Single combined page — posting is now fully automated (weekly content
// autopilot, see lib/contentAutopilot.ts + services/inngest/functions.ts),
// so the old 3-tab split (Existing Posts / Generate / Schedule) no longer
// matched what people actually needed to do here: mostly nothing, and
// occasionally glance at what's queued or nudge out an extra batch. This
// merges the calendar + buffer health from the old "Schedule" tab and a
// single manual "Generate extra batch now" action from the old "Generate"
// form (which asked for business identity/topic/tone/content-type on every
// use — replaced by the same one-click dispatch the autopilot itself uses,
// see handleGenerateNow below) into one page, with the post history list
// underneath.

function formatAutopilotDate(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
}

// Surfaced at the top of the page so autopilot is never silent — it runs
// fully in the background by design (no approval step, no owner action), but
// landing on a Content page that only ever showed manual controls made it
// look like nothing had been automated at all.
function AutopilotBanner({
  hasKeywords,
  qualified,
  nextRunAt,
}: {
  hasKeywords: boolean;
  qualified: boolean;
  nextRunAt?: string;
}) {
  if (!hasKeywords) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-outline-variant bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
        <MaterialIcon name="info" size={16} className="mt-0.5 shrink-0" />
        <span>
          Autopilot posting is ready but needs your target keywords first — add them under{' '}
          <strong>Dashboard → Onboarding / Profile</strong> and it&apos;ll start generating a fresh batch of 4 posts
          automatically, then every week after on the same day.
        </span>
      </div>
    );
  }

  if (!qualified) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-outline-variant bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
        <MaterialIcon name="info" size={16} className="mt-0.5 shrink-0" />
        <span>
          Autopilot posting starts the moment your subscription is active and your Google Business Profile is
          connected — 4 posts generate and schedule automatically, then again every week after on that same day.
        </span>
      </div>
    );
  }

  const nextRun = formatAutopilotDate(nextRunAt);

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-primary-fixed-dim bg-primary-fixed px-4 py-3 text-sm text-primary">
      <MaterialIcon name="auto_awesome" size={16} className="mt-0.5 shrink-0" />
      <span>
        <strong>Autopilot is on</strong> — every week we generate 4 new posts from your keywords and schedule them
        through the week automatically.{' '}
        {nextRun ? (
          <>
            Next batch: <strong>{nextRun}</strong>.
          </>
        ) : (
          'Starting shortly.'
        )}{' '}
        No action needed, but you can still generate an extra batch anytime below.
      </span>
    </div>
  );
}

export default function ContentWorkspace() {
  const { activeBusiness } = useBusiness();

  const [bufferData, setBufferData] = useState<any>(null);
  const [bufferLoading, setBufferLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  // Bumped after a manual generate dispatch to force ContentHistoryTab to
  // refetch a little later, once the async job has actually run.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const fetchBuffer = useCallback(async () => {
    try {
      const res = await fetch('/api/scheduler/buffer');
      const json = await res.json();
      if (json.success) setBufferData(json.data);
    } catch (err) {
      console.error(err);
    } finally {
      setBufferLoading(false);
    }
  }, []);

  // /api/scheduler/buffer is scoped to the active business server-side, but
  // switching workspaces doesn't remount this component — refetch whenever
  // the active business changes so the calendar/buffer never show the
  // previous workspace's data.
  useEffect(() => {
    if (!activeBusiness?._id) return;
    fetchBuffer();
  }, [fetchBuffer, activeBusiness?._id]);

  const handleGenerateNow = useCallback(async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/scheduler/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Generation failed to dispatch');
      toast.success('Generating 4 new posts — they’ll appear below shortly.');
      setTimeout(fetchBuffer, 5000);
      setTimeout(() => setHistoryRefreshKey((k) => k + 1), 8000);
    } catch {
      toast.error('Failed to dispatch generation.');
    } finally {
      setGenerating(false);
    }
  }, [fetchBuffer]);

  const handlePublish = async (id: string) => {
    try {
      const res = await fetch('/api/scheduler/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId: id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? 'Publish failed');
      }
      await fetchBuffer();
    } catch (err: any) {
      toast.error(friendlyClientMessage(err, 'Failed to publish'));
    }
  };

  // Called by WeeklyCalendar after an optimistic drag-drop update. Throws on
  // failure so the calendar can roll back its local state.
  const handleReschedule = useCallback(async (postId: string, newDate: Date) => {
    const res = await fetch('/api/scheduler/schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, scheduledDate: newDate.toISOString() }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? 'Reschedule failed');
    }
    fetchBuffer();
  }, [fetchBuffer]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl sm:text-3xl font-bold text-on-surface">Content</h1>
        <p className="text-on-surface-variant mt-1">Fully automated — new posts generate and schedule themselves every week. Review what's queued, or generate an extra batch anytime.</p>
      </div>

      <AutopilotBanner
        hasKeywords={!!activeBusiness?.keywords?.length}
        qualified={activeBusiness?.subscriptionStatus === 'active' && !!activeBusiness?.googleConnected}
        nextRunAt={activeBusiness?.autopilotNextRunAt}
      />

      <div className="flex justify-end">
        <button
          data-tour="generate-content"
          onClick={handleGenerateNow}
          disabled={generating}
          className="flex items-center gap-2 bg-primary hover:bg-primary-container text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60"
        >
          {generating ? (
            <>
              <MaterialIcon name="progress_activity" size={16} className="animate-spin" /> Generating…
            </>
          ) : (
            <>
              <MaterialIcon name="auto_awesome" size={16} /> Generate extra batch now
            </>
          )}
        </button>
      </div>

      {/* Buffer Health / "Action Required: Low Content Buffer" deliberately
          removed — those were built for a manual-posting world where a thin
          queue meant "go generate something." Everything here is automated
          now (autopilot keeps the queue topped up on its own), so a health
          meter/warning about it was just noise. The calendar itself already
          gives full manual control (reschedule/edit/delete — see
          WeeklyCalendar's PostDetailModal) for whenever it's actually needed. */}
      {!bufferLoading && bufferData && (
        <WeeklyCalendar
          posts={bufferData.allPosts}
          onPublish={handlePublish}
          onReschedule={handleReschedule}
          onDataChanged={fetchBuffer}
        />
      )}

      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant p-4 sm:p-8">
        <ContentHistoryTab key={historyRefreshKey} />
      </div>
    </div>
  );
}
