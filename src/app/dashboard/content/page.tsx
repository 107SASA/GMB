import ContentWorkspace from '@/components/content/ContentWorkspace';

export const metadata = {
  title: 'AI Content Studio',
  description: 'Generate high-converting GMB posts, SEO content, and FAQs instantly.',
};

export default function ContentStudioPage() {
  return (
    <div className="min-h-screen bg-surface p-4 pt-10">
      <div className="max-w-7xl mx-auto">
        <ContentWorkspace />
      </div>
    </div>
  );
}
