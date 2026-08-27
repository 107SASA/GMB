import { Suspense } from 'react';
import SuccessStoriesWorkspace from '@/components/dashboard/SuccessStoriesWorkspace';

export const metadata = {
  title: 'Success Stories',
  description: 'Share photos, video, or a review with GrowwMatics — approved submissions go live on growwmatics.com/showcase.',
};

export default function SuccessStoriesPage() {
  return (
    <div className="min-h-screen bg-surface p-4 pt-10">
      <div className="max-w-7xl mx-auto">
        {/* SuccessStoriesWorkspace reads ?tab= via useSearchParams (old
            /dashboard/showcase, /dashboard/testimonials links, and
            notification links, land here with it) — App Router requires
            that behind a Suspense boundary. */}
        <Suspense fallback={null}>
          <SuccessStoriesWorkspace />
        </Suspense>
      </div>
    </div>
  );
}
