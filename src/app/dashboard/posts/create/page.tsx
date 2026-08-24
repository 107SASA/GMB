import { redirect } from 'next/navigation';

export default function CreatePostRedirect() {
  redirect('/dashboard/content?tab=generate');
}
