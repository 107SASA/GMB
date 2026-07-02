import SchedulerDashboard from '@/components/scheduler/SchedulerDashboard';

export const metadata = {
  title: 'AI Marketing Automation | GMB Optimizer',
  description: 'Manage your automated 7-day content buffer.',
};

export default function SchedulerPage() {
  return (
    <div className="min-h-screen bg-slate-50/50 p-4 pt-10">
      <div className="max-w-[1400px] mx-auto">
        <SchedulerDashboard />
      </div>
    </div>
  );
}
