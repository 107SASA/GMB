import type { Metadata } from "next";

// book-demo/page.tsx is a Client Component ('use client', form state +
// useSearchParams) so it can't export `metadata` itself — see
// free-report/layout.tsx for why a layout.tsx here fixes that without
// touching the page's logic.
export const metadata: Metadata = {
  title: "Book a Free Demo",
  description:
    "See how GrowwMatics AI can grow your Google Business Profile — book a free demo and we'll walk you through it on WhatsApp.",
  alternates: { canonical: "/book-demo" },
  openGraph: {
    title: "Book a Free Demo | GrowwMatics AI",
    description: "See how GrowwMatics AI can grow your Google Business Profile.",
    url: "/book-demo",
    type: "website",
  },
};

export default function BookDemoLayout({ children }: { children: React.ReactNode }) {
  return <div className="theme-marketing">{children}</div>;
}
