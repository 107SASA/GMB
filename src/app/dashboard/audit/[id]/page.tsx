import AuditResultsDashboard from '@/components/audit/AuditResultsDashboard';

export const metadata = {
  title: 'Audit Results | GMB Optimizer',
  description: 'View your AI-powered Google Business Profile audit results.',
};

export default async function AuditResultsPage(
  { params }: { params: Promise<{ id: string }> } // Next 15 awaits params
) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-slate-50 p-4 pt-10">
      <AuditResultsDashboard auditId={id} />
    </div>
  );
}
