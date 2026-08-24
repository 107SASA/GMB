'use client';

import { BusinessProvider } from '@/context/BusinessContext';
import { BusinessSwitcher } from '@/components/layout/BusinessSwitcher';
import WhatsAppAgentPanel from '@/components/inbox/WhatsAppAgentPanel';

/**
 * Hosts the WhatsApp AI Agent directly inside the Admin Panel so Super Admin
 * never has to leave /admin to use it.
 *
 * This does NOT duplicate the feature — it renders the exact same
 * `WhatsAppAgentPanel` component src/app/dashboard/whatsapp/page.tsx uses
 * (same file, same logic, same UI — extracted there Aug 2026 specifically so
 * both routes could share it while each enforces its own Super Admin gate).
 * The only thing added here is the `BusinessProvider` that component needs,
 * since the Admin Panel layout doesn't include one (the regular dashboard
 * layout does).
 *
 * `adminScope` makes BusinessProvider list every customer's business (server
 * enforces SUPER_ADMIN-only, see /api/business/all) instead of just ones the
 * logged-in admin account happens to own — without it this page could only
 * ever show an empty inbox, since a real super-admin doesn't own any
 * customer businesses themselves. BusinessSwitcher is rendered explicitly
 * here because the regular dashboard layout normally supplies it; this route
 * doesn't use that layout.
 *
 * This route inherits its Super Admin–only protection from the existing
 * src/app/admin/layout.tsx guard — no separate check needed here.
 */
export default function AdminWhatsAppAgentPage() {
  return (
    <BusinessProvider adminScope>
      <div className="p-4 border-b border-outline-variant bg-surface-container-lowest">
        <BusinessSwitcher />
      </div>
      <WhatsAppAgentPanel />
    </BusinessProvider>
  );
}
