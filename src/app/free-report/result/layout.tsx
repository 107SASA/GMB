import type { Metadata } from "next";

// One person's report (or a "report unavailable" state) — never a search result.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function FreeReportResultLayout({ children }: { children: React.ReactNode }) {
  return children;
}
