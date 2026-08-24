import { redirect } from 'next/navigation';

export default function ScheduledPostsRedirect() {
  redirect('/dashboard/content?tab=schedule');
}
