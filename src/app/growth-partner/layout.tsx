import type { Metadata } from 'next';
import { sharedOpenGraph } from "@/lib/seo";

export const metadata: Metadata = {
  title: 'Become a Growth Partner',
  description:
    'Agencies, freelancers and consultants: bring local businesses to Growwmatics AI and earn commission on their first payment and every renewal.',
  alternates: { canonical: '/growth-partner' },
  openGraph: {
    ...sharedOpenGraph,
    title: 'Become a Growth Partner | Growwmatics AI',
    description: 'Earn recurring commission for every business you bring to Growwmatics AI.',
    url: '/growth-partner',
    type: 'website',
  },
};

export default function GrowthPartnerLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-marketing">{children}</div>;
}
