import { redirect } from 'next/navigation';
import { requireSuperAdmin } from '@/lib/superAdminAuth';

/**
 * WhatsApp AI Agent is a Super Admin–exclusive feature.
 * This layout only guards the /dashboard/whatsapp route segment — it does
 * not affect any other page under /dashboard (those keep using the existing
 * requireClient() check in src/app/dashboard/layout.tsx unchanged).
 * Non-super-admins (including anyone typing the URL directly) are redirected
 * back to the main dashboard before the page ever renders.
 */
export default async function WhatsAppAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authResult = await requireSuperAdmin();

  if (!authResult.ok) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
