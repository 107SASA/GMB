import ReviewsDashboard from '@/components/reviews/ReviewsDashboard';

export const metadata = {
  title: 'AI Reputation Agent | GMB Optimizer',
  description: 'Manage and respond to reviews with AI.',
};

export default function ReviewsPage() {
  return (
    <div className="min-h-screen bg-slate-50/50 p-4 pt-10">
      <div className="max-w-[1400px] mx-auto">
        <ReviewsDashboard />
      </div>
    </div>
  );
}
