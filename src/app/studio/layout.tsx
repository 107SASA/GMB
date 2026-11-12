import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStudioViewer } from "@/lib/studioAuth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Content Studio",
  robots: { index: false, follow: false },
};

/**
 * Content Studio — the marketing team's editor for the blog and website pages.
 * Signed-in Super Admins and TEAM_MEMBERs only (sign in at /admin-login).
 * Every /api/studio/* route re-checks access itself.
 */
export default async function StudioRootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getStudioViewer();
  if (!viewer) redirect("/admin-login");
  return <>{children}</>;
}
