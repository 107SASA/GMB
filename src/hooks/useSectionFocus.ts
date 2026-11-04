'use client';

import { useEffect, useState } from 'react';

/** Fired (detail = section) to focus a section on the page that is already open. */
export const SECTION_FOCUS_EVENT = 'gm:section-focus';

/**
 * Deep link into a page section: `?section=services` opens (for a <details>),
 * scrolls to and briefly highlights the element with id `section-services`.
 * Plan-task "Fix now" links (src/services/tasks/planTasks.ts) use these. Runs
 * once `ready` is true, i.e. after the section has rendered. `missing` = the
 * page has nothing to show for that section right now.
 */
export function useSectionFocus(ready: boolean): { section: string | null; missing: boolean } {
  const [section, setSection] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setSection(new URLSearchParams(window.location.search).get('section'));
    // The guided-fix bar moves between sections of the page already open.
    const onFocus = (e: Event) => setSection((e as CustomEvent<string>).detail || null);
    window.addEventListener(SECTION_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(SECTION_FOCUS_EVENT, onFocus);
  }, []);

  useEffect(() => {
    if (!ready || !section) return;
    const el = document.getElementById(`section-${section}`);
    setMissing(!el);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
    const timer = window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2'), 2500);
    return () => window.clearTimeout(timer);
  }, [ready, section]);

  return { section, missing };
}
