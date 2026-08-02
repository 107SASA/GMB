import { redirect } from 'next/navigation';

export default function PendingPostsRedirect() {
  redirect('/dashboard/scheduler');
}
