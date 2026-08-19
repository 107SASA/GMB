import type { Metadata } from "next";

// checkout/page.tsx is a Client Component ('use client', live Razorpay
// checkout state + useSearchParams) so it can't export `metadata` itself —
// see free-report/layout.tsx for why a layout.tsx here fixes that without
// touching the page's logic. noindex: this is a mid-funnel step reached only
// via a Subscribe click, not a page that should rank on its own.
export const metadata: Metadata = {
  title: "Checkout",
  robots: { index: false, follow: false },
};

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
