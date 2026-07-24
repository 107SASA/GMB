import GatedAuditReport from '@/components/audit/GatedAuditReport';

export const metadata = {
  title: 'Audit Results | GrowwMatics AI',
  description: 'View your AI-powered Google Business Profile audit results.',
};

export default async function AuditResultsPage(
  { params }: { params: Promise<{ id: string }> } // Next 15 awaits params
) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-slate-50 p-4 pt-10">
      <GatedAuditReport auditId={id} />
    </div>
  );
}
