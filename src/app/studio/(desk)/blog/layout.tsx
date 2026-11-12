import { studioViewerFor } from "@/lib/studioAuth";
import { Notice } from "@/components/studio/ui";

/** Blog area: needs the 'blog' permission (Super Admins always have it). */
export default async function BlogAreaLayout({ children }: { children: React.ReactNode }) {
  const viewer = await studioViewerFor("blog");
  if (!viewer) {
    return (
      <Notice tone="warn" title="No access to the blog">
        Ask a Super Admin to give you “Blog” access in Super Admin → Team.
      </Notice>
    );
  }
  return <>{children}</>;
}
