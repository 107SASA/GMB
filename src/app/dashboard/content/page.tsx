import { Suspense } from 'react';
import ContentWorkspace from '@/components/content/ContentWorkspace';

export const metadata = {
  title: 'AI Content Studio',
  description: 'Generate high-converting GMB posts, SEO content, and FAQs instantly.',
};

export default function ContentStudioPage() {
  return (
    <div className="min-h-screen bg-surface p-4 pt-10">
      <div className="max-w-7xl mx-auto">
        {/* ContentWorkspace reads ?tab= via useSearchParams (legacy
            /dashboard/scheduler and /dashboard/posts/* links land here with
            it) — App Router requires that behind a Suspense boundary. */}
        <Suspense fallback={null}>
          <ContentWorkspace />
        </Suspense>
      </div>
    </div>
  );
}
