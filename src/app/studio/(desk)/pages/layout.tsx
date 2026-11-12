import { studioViewerFor } from "@/lib/studioAuth";
import { Notice } from "@/components/studio/ui";

/** Website pages area: needs the 'cms' permission (Super Admins always have it). */
export default async function PagesAreaLayout({ children }: { children: React.ReactNode }) {
  const viewer = await studioViewerFor("cms");
  if (!viewer) {
    return (
      <Notice tone="warn" title="No access to website pages">
        Ask a Super Admin to give you “Website pages” access in Super Admin → Team.
      </Notice>
    );
  }
  return <>{children}</>;
}
