'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useBusiness } from '@/context/BusinessContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import ContentHistoryTab from './ContentHistoryTab';
import CreatePostForm from './CreatePostForm';
import WeeklyCalendar from '@/components/scheduler/WeeklyCalendar';
import { friendlyClientMessage } from '@/lib/errors/friendlyClientMessage';

// Single combined page — posting is fully automated (weekly content
// autopilot, see lib/contentAutopilot.ts + services/inngest/functions.ts):
// exactly 4 posts per business per week, generated and scheduled by the
// weekly job. This page only READS that state (calendar + post list + offer)
// and offers the legitimate manual actions on existing posts (view, edit a
// draft, reschedule, publish). There is deliberately NO button that creates
// another AI batch (removed Oct 2026: it caused duplicate posts and extra
// AI / image-generation cost). The same data is shown in the mobile app.

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
  generating,
  stalled,
}: {
  hasKeywords: boolean;
  qualified: boolean;
  nextRunAt?: string;
  /** A batch was just dispatched and its posts haven't landed yet. */
  generating?: boolean;
  /** Dispatched over 75 minutes ago and still no posts. */
  stalled?: boolean;
}) {
  if (stalled) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-outline-variant bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
        <MaterialIcon name="schedule" size={16} className="mt-0.5 shrink-0" />
        <span>
          <strong>This week&apos;s posts are taking longer than expected.</strong> The weekly job retries automatically —
          contact support if they still don&apos;t appear.
        </span>
      </div>
    );
  }
  if (generating) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-primary-fixed-dim bg-primary-fixed px-4 py-3 text-sm text-primary">
        <MaterialIcon name="progress_activity" size={16} className="mt-0.5 shrink-0 animate-spin" />
        <span>
          <strong>Your AI agent is working on this week&apos;s posts</strong> — writing 4 posts from your SEO plan and
          creating their images. They&apos;ll appear here in a minute or two and are scheduled automatically through the
          week. No action needed.
        </span>
      </div>
    );
  }

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
        No action needed.
      </span>
    </div>
  );
}

export default function ContentWorkspace() {
  const { activeBusiness } = useBusiness();

  const [bufferData, setBufferData] = useState<any>(null);
  const [bufferLoading, setBufferLoading] = useState(true);
  // Bumped when a weekly batch lands or a manual post is saved so both lists refetch.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [scheduledPosts, setScheduledPosts] = useState<any[] | null>(null);
  const [scheduledTotal, setScheduledTotal] = useState<number | null>(null);
  const [scheduledError, setScheduledError] = useState('');

  // /api/scheduler/buffer and /api/posts are scoped to the active business.
  // Clear the previous workspace's posts before the next response arrives,
  // and ignore a response that belongs to a business the user already left.
  useEffect(() => {
    if (!activeBusiness?._id) return;
    let cancelled = false;
    setBufferData(null);
    setBufferLoading(true);
    setScheduledPosts(null);
    setScheduledTotal(null);
    setScheduledError('');
    void (async () => {
      try {
        const res = await fetch('/api/scheduler/buffer');
        const json = await res.json();
        if (cancelled) return;
        if (json.success) setBufferData(json.data);
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setBufferLoading(false);
      }
    })();
    void (async () => {
      try {
        const res = await fetch('/api/posts?status=scheduled,publishing&limit=50&page=1&meta=1');
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(json.message || json.error || 'Failed to load upcoming posts');
        const posts = Array.isArray(json.posts) ? json.posts : [];
        setScheduledPosts(posts);
        setScheduledTotal(typeof json.total === 'number' ? json.total : posts.length);
      } catch (err) {
        if (cancelled) return;
        setScheduledPosts([]);
        setScheduledTotal(null);
        setScheduledError(friendlyClientMessage(err, 'Could not load upcoming posts'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBusiness?._id, historyRefreshKey]);

  // Live autopilot state (read-only — opening this page never generates posts).
  const [autopilot, setAutopilot] = useState<{ hasKeywords: boolean; qualified: boolean; nextRunAt: string | null; generating: boolean; stalled?: boolean } | null>(null);
  const fetchAutopilot = useCallback(async () => {
    try {
      const res = await fetch('/api/content/autopilot-status');
      const json = await res.json();
      if (json.success) setAutopilot(json);
    } catch {
      // Banner falls back to the workspace fields.
    }
  }, []);
  useEffect(() => {
    if (!activeBusiness?._id) return;
    setAutopilot(null);
    fetchAutopilot();
  }, [fetchAutopilot, activeBusiness?._id]);
  // While a batch is being made, re-check every 10s; when it lands, refresh the calendar and the list.
  useEffect(() => {
    if (!autopilot?.generating) return;
    const t = setInterval(() => void fetchAutopilot(), 10_000);
    return () => clearInterval(t);
  }, [autopilot?.generating, fetchAutopilot]);
  // This week's stored offer (exactly what the owner entered), shown so they remember it.
  const [weekOffer, setWeekOffer] = useState<{ answered: string | null; offer: { text: string; festivalName: string | null; endsAt: string | null; appliedToPost: boolean } | null } | null>(null);
  useEffect(() => {
    if (!activeBusiness?._id) return;
    setWeekOffer(null);
    fetch('/api/content/weekly-offer')
      .then((r) => r.json())
      .then((j) => { if (j.success) setWeekOffer({ answered: j.answered, offer: j.offer }); })
      .catch(() => {});
  }, [activeBusiness?._id]);

  const wasGenerating = useRef(false);
  useEffect(() => {
    if (wasGenerating.current && autopilot && !autopilot.generating) {
      setHistoryRefreshKey((k) => k + 1);
    }
    wasGenerating.current = !!autopilot?.generating;
  }, [autopilot]);

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
      const json = await res.json().catch(() => ({}));
      if (json.blocked) toast.message(json.message ?? 'Scheduled in GrowwMatics — Google publishing has not been executed.');
      else toast.success('Published to your Google Business Profile.');
      setHistoryRefreshKey((k) => k + 1);
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
    setHistoryRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold text-on-surface">Content</h1>
          <p className="text-on-surface font-semibold mt-1">Your weekly posts are generated automatically.</p>
          <p className="text-on-surface-variant mt-0.5">4 posts are planned every week based on your SEO plan, business information, keywords, offers and relevant festivals. Review what&apos;s scheduled below.</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((open) => !open)}
          className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-bold text-on-primary"
        >
          + Create Post
        </button>
      </div>

      {creating && (
        <CreatePostForm
          onClose={() => setCreating(false)}
          onCreated={() => setHistoryRefreshKey((k) => k + 1)}
        />
      )}

      <section>
        <h2 className="text-xl font-bold text-on-surface">
          Upcoming Posts
          {scheduledTotal != null && !scheduledError ? <span className="ml-2 text-base font-semibold text-on-surface-variant">{scheduledTotal}</span> : null}
        </h2>
        {scheduledPosts == null ? (
          <div className="mt-3 h-24 animate-pulse rounded-xl bg-surface-container" />
        ) : scheduledError ? (
          <p className="mt-3 text-sm text-error">{scheduledError}</p>
        ) : scheduledPosts.length === 0 ? (
          <p className="mt-3 text-sm text-on-surface-variant">No posts scheduled. Weekly posts appear here automatically once they are planned. Use Create Post to write one yourself.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {scheduledPosts.map((post) => (
              <article key={post._id} className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest">
                {post.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={post.imageUrl} alt="" className="h-36 w-full object-cover" />
                )}
                <div className="p-4">
                  <p className="font-semibold text-on-surface line-clamp-2">{post.title || post.content?.slice?.(0, 80) || 'Untitled post'}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-on-surface-variant">{post.status}</p>
                  {post.scheduledDate && (
                    <p className="mt-1 text-xs text-on-surface-variant">
                      Scheduled for {new Date(post.scheduledDate).toLocaleString()}
                    </p>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {weekOffer?.answered === 'YES' && weekOffer.offer && (
        <div className="flex items-start gap-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface">
          <MaterialIcon name="sell" size={16} className="mt-0.5 shrink-0 text-primary" />
          <span>
            <strong>This week&apos;s offer (as you entered it):</strong> &ldquo;{weekOffer.offer.text}&rdquo;
            {weekOffer.offer.festivalName ? ` · for ${weekOffer.offer.festivalName}` : ''}
            {weekOffer.offer.endsAt ? ` · ends ${new Date(weekOffer.offer.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
            {' · '}
            {weekOffer.offer.appliedToPost ? 'used in this week’s offer post.' : 'will be used in this week’s offer post.'}
          </span>
        </div>
      )}
      {weekOffer?.answered === 'NONE' && (
        <div className="flex items-start gap-2.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-3 text-sm text-on-surface-variant">
          <MaterialIcon name="sell" size={16} className="mt-0.5 shrink-0" />
          <span>No offer this week — no promotional post will be created.</span>
        </div>
      )}

      <div data-tour="generate-content">
      <AutopilotBanner
        hasKeywords={autopilot ? autopilot.hasKeywords : !!activeBusiness?.keywords?.length}
        qualified={autopilot ? autopilot.qualified : activeBusiness?.subscriptionStatus === 'active' && !!activeBusiness?.googleConnected}
        nextRunAt={autopilot ? autopilot.nextRunAt ?? undefined : activeBusiness?.autopilotNextRunAt}
        generating={autopilot?.generating}
        stalled={autopilot?.stalled}
      />
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
          posts={(bufferData.allPosts ?? []).filter((p: { status?: string }) => p.status !== 'draft')}
          onPublish={handlePublish}
          onReschedule={handleReschedule}
          onDataChanged={() => setHistoryRefreshKey((k) => k + 1)}
        />
      )}

      <div className="bg-surface-container-lowest rounded-2xl shadow-sm border border-outline-variant p-4 sm:p-8">
        <ContentHistoryTab key={historyRefreshKey} />
      </div>
    </div>
  );
}
