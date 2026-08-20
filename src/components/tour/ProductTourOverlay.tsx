'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, ArrowRight, ArrowLeft } from 'lucide-react';
import { useProductTour } from '@/context/ProductTourContext';

/**
 * Renders the dashboard product tour — either a spotlight around the
 * current step's target element (when the user is already on the right
 * page) or a small floating nudge pointing them to the right page (when
 * they're not). Mount once near the root of the dashboard layout; renders
 * nothing once the tour is inactive.
 */
export default function ProductTourOverlay() {
  const { active, step, stepIndex, stepCount, onCurrentRoute, next, back, skip } = useProductTour();

  if (!active || !step) return null;

  if (!onCurrentRoute) {
    return (
      <TourNudge
        key={step.id}
        title={step.title.replace(/^Step \d+ — /, '')}
        route={step.route}
        stepIndex={stepIndex}
        stepCount={stepCount}
        onSkip={skip}
      />
    );
  }

  return <SpotlightStep key={step.id} selector={step.selector} title={step.title} body={step.body}
    stepIndex={stepIndex} stepCount={stepCount} onNext={next} onBack={back} onSkip={skip} />;
}

/**
 * The "not on the right page yet" nudge. Previously a static corner card
 * that just silently appeared — easy to miss, and on mobile it sat at
 * bottom-6 which overlaps the fixed bottom nav bar (Sidebar.tsx renders
 * that at bottom-0, h-16, so anything below ~72px collides with it). Now:
 * clears the mobile nav properly, slides/scales in on mount instead of
 * popping in silently, and carries a small pulsing badge — the standard
 * "unread notification" visual cue — so it actually catches the eye
 * instead of blending into the corner.
 */
function TourNudge({
  title,
  route,
  stepIndex,
  stepCount,
  onSkip,
}: {
  title: string;
  route: string;
  stepIndex: number;
  stepCount: number;
  onSkip: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Next tick, not the same paint — lets the initial (hidden) state
    // actually apply first, so the transition has something to animate FROM.
    const t = setTimeout(() => setShown(true), 20);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className={`fixed z-[300] max-w-xs bottom-20 right-4 sm:right-6 lg:bottom-6 transition-all duration-300 ease-out ${
        shown ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'
      }`}
    >
      <div className="relative bg-primary text-white rounded-2xl shadow-xl ring-4 ring-primary/25 p-4 flex items-start gap-3">
        {/* Pulsing "look here" badge — the classic unread-notification cue. */}
        <span className="absolute -top-1.5 -left-1.5 flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-secondary" />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white/80 uppercase tracking-wide mb-0.5">
            Quick tour · {stepIndex + 1} of {stepCount}
          </p>
          <p className="text-sm font-medium leading-snug">{title}</p>
          <Link
            href={route}
            className="inline-flex items-center gap-1 mt-2 text-sm font-semibold underline underline-offset-2 hover:no-underline"
          >
            Take me there
            <ArrowRight className="w-3.5 h-3.5 animate-bounce" />
          </Link>
        </div>
        <button
          onClick={onSkip}
          aria-label="Skip tour"
          className="shrink-0 text-white/70 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SpotlightStep({
  selector,
  title,
  body,
  stepIndex,
  stepCount,
  onNext,
  onBack,
  onSkip,
}: {
  selector: string;
  title: string;
  body: string;
  stepIndex: number;
  stepCount: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  // The target element often isn't in the DOM yet on first render (data
  // still loading, a conditional section not shown until a fetch resolves)
  // — poll briefly for it rather than giving up after one missed check.
  useEffect(() => {
    setRect(null);
    let attempts = 0;
    let cancelled = false;
    let raf = 0;

    const measure = () => {
      const el = document.querySelector(selector);
      if (!el) return false;
      if (!cancelled) setRect(el.getBoundingClientRect());
      return true;
    };

    const tick = () => {
      if (cancelled) return;
      const found = measure();
      attempts += 1;
      if (!found && attempts < 30) {
        setTimeout(tick, 300); // ~9s ceiling
      } else if (found) {
        document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    tick();

    const onRecompute = () => {
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onRecompute);
    window.addEventListener('scroll', onRecompute, true);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onRecompute);
      window.removeEventListener('scroll', onRecompute, true);
    };
  }, [selector]);

  if (!rect) return null;

  const pad = 8;
  const spotTop = rect.top - pad;
  const spotLeft = rect.left - pad;
  const spotWidth = rect.width + pad * 2;
  const spotHeight = rect.height + pad * 2;

  // Prefer the tooltip below the target; flip above if there isn't room.
  const spaceBelow = window.innerHeight - (spotTop + spotHeight);
  const showBelow = spaceBelow > 180;
  const tooltipTop = showBelow ? spotTop + spotHeight + 12 : Math.max(12, spotTop - 12);

  return (
    <>
      {/* Dimmed backdrop with a cut-out ring around the target — purely
          visual (pointer-events-none) so the real button underneath stays
          fully clickable through the highlight. */}
      <div
        className="z-[290] pointer-events-none transition-all duration-200"
        style={{
          position: 'fixed',
          top: spotTop,
          left: spotLeft,
          width: spotWidth,
          height: spotHeight,
          borderRadius: 12,
          boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.6)',
          outline: '2px solid var(--color-primary, #16a34a)',
          outlineOffset: 2,
        }}
      />

      <div
        className="fixed z-[300] w-80 max-w-[calc(100vw-2rem)] bg-surface-container-lowest border border-outline-variant rounded-2xl shadow-lg p-5"
        style={{
          top: showBelow ? tooltipTop : undefined,
          bottom: showBelow ? undefined : window.innerHeight - tooltipTop,
          left: Math.min(Math.max(12, spotLeft), window.innerWidth - 332),
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">
            Quick tour · {stepIndex + 1} of {stepCount}
          </p>
          <button onClick={onSkip} aria-label="Skip tour" className="text-outline hover:text-on-surface transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <h3 className="text-sm font-bold text-on-surface leading-snug mb-1.5">{title}</h3>
        <p className="text-sm text-on-surface-variant leading-relaxed mb-4">{body}</p>
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={onSkip}
            className="text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                onClick={onBack}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-on-surface-variant border border-outline-variant hover:bg-surface-container transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <button
              onClick={onNext}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary transition-colors"
            >
              {stepIndex >= stepCount - 1 ? 'Finish' : 'Next'} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
