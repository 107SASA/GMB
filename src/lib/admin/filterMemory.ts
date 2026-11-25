/**
 * Remembers a list page's last filters (its URL query) for this browser tab,
 * so opening a lead and coming back — via "Back", the sidebar, or any plain
 * link to the page — lands on the same filtered list instead of a reset one.
 *
 * sessionStorage on purpose: a per-viewer convenience that lasts for the tab,
 * not shared state. Every access is guarded — storage can be blocked
 * (private mode, site data off) and the page must still work without it.
 */

export type FilterPage = 'leads' | 'pipeline';

const key = (page: FilterPage) => `gm-admin-filters:${page}`;

/** The saved query string (no leading "?"), or '' when none. */
export function loadFilters(page: FilterPage): string {
  try {
    return window.sessionStorage.getItem(key(page)) || '';
  } catch {
    return '';
  }
}

export function saveFilters(page: FilterPage, query: string): void {
  try {
    if (query) window.sessionStorage.setItem(key(page), query);
    else window.sessionStorage.removeItem(key(page));
  } catch {
    /* storage unavailable — filters just won't be remembered */
  }
}

/** `/admin/leads` plus the remembered filters, for "Back to …" links. */
export function hrefWithFilters(path: string, page: FilterPage): string {
  const q = loadFilters(page);
  return q ? `${path}?${q}` : path;
}
