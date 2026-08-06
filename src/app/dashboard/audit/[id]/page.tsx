import GatedAuditReport from '@/components/audit/GatedAuditReport';
import { BackLink } from '@/components/ui/BackLink';

export const metadata = {
  title: 'Audit Results',
  description: 'View your AI-powered Google Business Profile audit results.',
};

export default async function AuditResultsPage(
  { params }: { params: Promise<{ id: string }> } // Next 15 awaits params
) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-surface p-4 pt-10">
      <div className="max-w-6xl mx-auto">
        <BackLink href="/dashboard/audit" label="Back to Audits" />
      </div>
      <GatedAuditReport auditId={id} />
    </div>
  );
}
