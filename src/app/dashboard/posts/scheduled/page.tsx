import { redirect } from 'next/navigation';

export default function ScheduledPostsRedirect() {
  redirect('/dashboard/scheduler');
}
