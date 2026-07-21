'use client';

import { BusinessProvider } from '@/context/BusinessContext';
import InboxDashboard from '@/app/dashboard/whatsapp/page';

/**
 * Hosts the WhatsApp AI Agent directly inside the Admin Panel so Super Admin
 * never has to leave /admin to use it.
 *
 * This does NOT duplicate the feature — it renders the exact same
 * `InboxDashboard` component that /dashboard/whatsapp uses (same file,
 * same logic, same UI). The only thing added here is the `BusinessProvider`
 * that component needs, since the Admin Panel layout doesn't include one
 * (the regular dashboard layout does).
 *
 * This route inherits its Super Admin–only protection from the existing
 * src/app/admin/layout.tsx guard — no separate check needed here.
 */
export default function AdminWhatsAppAgentPage() {
  return (
    <BusinessProvider>
      <InboxDashboard />
    </BusinessProvider>
  );
}
