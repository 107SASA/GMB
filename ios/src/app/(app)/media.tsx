import { Redirect } from 'expo-router';

/**
 * The old Media tab is gone. Photos now live under Posts, and this route
 * only remains so an old /media link opens Reviews.
 */
export default function MediaScreen() {
  return <Redirect href="/reviews" />;
}
