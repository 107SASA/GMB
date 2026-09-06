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
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-60 sm:w-80 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-surface-container-lowest rounded-xl card-shadow border border-outline-variant p-4 relative">
        <button
          onClick={() => setVisible(false)}
          className="absolute top-2.5 right-2.5 p-1 hover:bg-surface-container rounded-full transition-colors"
          aria-label="Dismiss"
        >
          <X className="w-3.5 h-3.5 text-on-surface-variant" />
        </button>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 shrink-0 bg-primary rounded-lg flex items-center justify-center shadow-sm">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0 pr-4">
            <h2 className="font-heading text-sm font-bold text-on-surface">Share your success story</h2>
            <p className="text-xs text-on-surface-variant mt-1">
              Record a quick video and leave a review — approved submissions go live on our public showcase.
            </p>
            <div className="flex items-center gap-3 mt-3">
              <button
                onClick={() => { setVisible(false); router.push('/dashboard/success-stories'); }}
                className="px-3 py-1.5 text-xs font-bold text-white bg-primary hover:bg-primary-container rounded-lg transition-colors"
              >
                Share now
              </button>
              <button
                onClick={() => setVisible(false)}
                className="text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
