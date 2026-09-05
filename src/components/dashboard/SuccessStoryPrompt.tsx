'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sparkles, X } from 'lucide-react';

/**
 * Dashboard-wide nudge toward /dashboard/success-stories, replacing the
 * permanent sidebar link (owner's explicit call, Sep 2026) — a one-time ask
 * (one video + one review, ever) doesn't deserve a permanent nav slot.
 *
 * Shows once per login session (sessionStorage flag) — reappears next
 * session if dismissed without submitting, but never again once BOTH a
 * video and a review are done (checked via /api/success-stories/status,
 * the same endpoint the page itself reads).
 */
const SESSION_FLAG = 'successStoryPromptShown';

export default function SuccessStoryPrompt() {
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Pointless to nudge someone who's already on the form — and deliberately
    // NOT marked as "shown" here, so the check still runs (and the popup can
    // still appear) once they navigate to any other page later this session.
    if (pathname?.startsWith('/dashboard/success-stories')) return;
    if (sessionStorage.getItem(SESSION_FLAG)) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/success-stories/status');
        const json = await res.json();
        if (cancelled) return;
        const bothDone = json.success && json.videoDone && json.reviewDone;
        if (!bothDone) setVisible(true);
      } catch {
        // Best-effort — a failed check just skips showing the popup this
        // load rather than risking an error state on top of the dashboard.
      } finally {
        // Mark shown for this session regardless of outcome above, so a
        // flaky status check can't retry-loop the popup on every navigation.
        if (!cancelled) sessionStorage.setItem(SESSION_FLAG, '1');
      }
    })();
    return () => { cancelled = true; };
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-container-lowest rounded-2xl card-shadow w-full max-w-sm border border-outline-variant p-6 text-center relative">
        <button
          onClick={() => setVisible(false)}
          className="absolute top-3 right-3 p-1.5 hover:bg-surface-container rounded-full transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-4 h-4 text-on-surface-variant" />
        </button>
        <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-sm mx-auto mb-4">
          <Sparkles className="w-6 h-6 text-white" />
        </div>
        <h2 className="font-heading text-lg font-bold text-on-surface">Share your success story</h2>
        <p className="text-sm text-on-surface-variant mt-1.5">
          Record a quick video and leave a review — approved submissions go live on our public showcase. Takes a minute, one of each.
        </p>
        <button
          onClick={() => { setVisible(false); router.push('/dashboard/success-stories'); }}
          className="w-full mt-5 px-5 py-3 text-sm font-bold text-white bg-primary hover:bg-primary-container rounded-xl transition-colors"
        >
          Share now
        </button>
        <button
          onClick={() => setVisible(false)}
          className="w-full mt-2 px-5 py-2 text-sm font-medium text-on-surface-variant hover:text-on-surface transition-colors"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
