import { redirect } from 'next/navigation';

export default function PendingPostsRedirect() {
  redirect('/dashboard/content?tab=schedule');
}
