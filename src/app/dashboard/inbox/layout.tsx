import { redirect } from 'next/navigation';
import { requireSuperAdmin } from '@/lib/superAdminAuth';

/**
 * /dashboard/inbox is the earlier version of the WhatsApp AI Agent page
 * (superseded by /dashboard/whatsapp, but still a live, directly reachable
 * route since it isn't gated anywhere else). It reads/writes the same
 * Super Admin–exclusive WhatsApp AI Agent APIs, so it gets the same guard —
 * otherwise it would remain an unrestricted backdoor into the feature.
 */
export default async function LegacyInboxLayout({
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
