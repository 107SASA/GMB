import { redirect } from 'next/navigation';

export default function PostsRedirect() {
  redirect('/dashboard/content?tab=schedule');
}
