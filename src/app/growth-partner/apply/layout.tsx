import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Apply as a Growth Partner',
  description: 'Apply to the Growwmatics AI Growth Partner Program: earn commission on every business you bring.',
  alternates: { canonical: '/growth-partner/apply' },
};

export default function GrowthPartnerApplyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
