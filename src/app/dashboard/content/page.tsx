import { Suspense } from 'react';
import ContentWorkspace from '@/components/content/ContentWorkspace';

export const metadata = {
  title: 'AI Content Studio',
  description: 'Weekly GMB posts generate and schedule themselves automatically — review what\'s queued here.',
};

export default function ContentStudioPage() {
  return (
    <div className="min-h-screen bg-surface p-4 pt-10">
      <div className="max-w-7xl mx-auto">
        <Suspense fallback={null}>
          <ContentWorkspace />
        </Suspense>
      </div>
    </div>
  );
}
