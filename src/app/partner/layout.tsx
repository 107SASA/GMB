import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveGrowthPartner } from '@/lib/partners/partnerAuth';
import { PartnerShell } from '@/components/partner/PartnerShell';

export const metadata: Metadata = {
  title: 'Growth Partner Dashboard',
  robots: { index: false, follow: false },
};

/** Everything under /partner requires a signed-in, non-suspended Growth Partner. */
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const auth = await resolveGrowthPartner();
  if (!auth.ok) {
    redirect(auth.code === 'PARTNER_SUSPENDED' ? '/partner-login?error=suspended' : '/partner-login');
  }

  return (
    <PartnerShell partnerName={auth.partner.fullName} companyName={auth.partner.companyName}>
      {children}
    </PartnerShell>
  );
}
