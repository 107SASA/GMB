import { redirect } from 'next/navigation';

export default function ReviewRequestsRedirect() {
  redirect('/dashboard/reviews');
}
