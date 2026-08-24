import { redirect } from 'next/navigation';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import WhatsAppAgentPanel from '@/components/inbox/WhatsAppAgentPanel';

// Super Admin–only — explicit product decision (Aug 2026): customers should
// never see any WhatsApp-related tab in their own dashboard. The sidebar
// already hid the nav link (superAdminOnly), but this route itself had no
// server-side check — a regular customer who knew/guessed the URL could
// still load it directly. This closes that gap the same way every other
// Super Admin page does (see src/app/admin/layout.tsx's requireSuperAdmin()).
export default async function WhatsAppAgentPage() {
  const authResult = await requireSuperAdmin();
  if (!authResult.ok) {
    redirect('/dashboard');
  }

  return <WhatsAppAgentPanel />;
}
