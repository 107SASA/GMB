/**
 * Where a plan-task link may take the app (server: src/services/tasks/planTasks.ts
 * fixTargetFor → target.mobile). Push data, notification links and web links
 * are checked against this list before navigating — an unknown path is ignored.
 */
const TASK_PATH = /^\/(profile-optimization(\?section=[a-z-]+)?|gbp(\?section=[a-z-]+)?|photos|posts|reviews|dashboard)$/;

export function isTaskPath(path: unknown): path is string {
  return typeof path === 'string' && TASK_PATH.test(path);
}

/**
 * A website dashboard link (WhatsApp, in-app notification) → the app screen
 * for the same fix, or null. "/dashboard/profile-optimization?section=services"
 * → "/profile-optimization?section=services".
 */
export function appPathForTaskLink(link: string | null | undefined): string | null {
  if (!link) return null;
  let path = link.trim();
  try {
    // Absolute links (https://growwmatics.com/dashboard/…) — keep path + query.
    if (/^https?:\/\//i.test(path)) {
      const u = new URL(path);
      path = `${u.pathname}${u.search}`;
    }
  } catch {
    return null;
  }
  const [rawPath, query = ''] = path.split('?');
  const section = query.match(/(?:^|&)section=([a-z-]+)/)?.[1];
  const withSection = (p: string) => (section ? `${p}?section=${section}` : p);
  switch (rawPath.replace(/\/+$/, '')) {
    case '/dashboard/profile-optimization':
      return withSection('/profile-optimization');
    case '/dashboard/gbp-profile':
      return section === 'photos' ? '/photos' : section === 'details' ? '/gbp?section=details' : '/gbp';
    case '/dashboard/seo-plan':
    case '/dashboard':
      // The checklist lives on the home screen.
      return '/dashboard';
    default:
      return null;
  }
}

/**
 * A website path that reached the app (Android App Link to
 * https://growwmatics.com/dashboard/…) → the app route to show. Used by
 * app/+not-found.tsx: website paths match no app route, so they land there.
 */
export function appPathForWebPath(pathname: string, search = ''): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/dashboard')) return '/';
  const task = appPathForTaskLink(`${path}${search}`);
  if (task) return task;
  const audit = path.match(/^\/dashboard\/audit\/([a-f0-9]{24})$/i);
  if (audit) return `/audit/${audit[1]}`;
  return '/dashboard';
}
