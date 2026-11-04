import { Redirect, useGlobalSearchParams, usePathname } from 'expo-router';

import { appPathForWebPath } from '@/lib/taskLinks';

/**
 * Any path the app has no screen for. Android App Links bring website paths
 * (https://growwmatics.com/dashboard/profile-optimization?section=services,
 * from WhatsApp fix reminders) here — they are sent to the matching app
 * screen; anything else goes home. Sign-in is still enforced by (app)/_layout.
 */
export default function NotFound() {
  const pathname = usePathname();
  const { section } = useGlobalSearchParams<{ section?: string }>();
  const search = typeof section === 'string' ? `?section=${encodeURIComponent(section)}` : '';
  return <Redirect href={appPathForWebPath(pathname, search) as never} />;
}
