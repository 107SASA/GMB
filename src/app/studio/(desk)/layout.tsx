import { redirect } from "next/navigation";
import { getStudioViewer } from "@/lib/studioAuth";
import { StudioShell } from "@/components/studio/StudioShell";

export default async function StudioDeskLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getStudioViewer();
  if (!viewer) redirect("/admin-login");
  return (
    <StudioShell
      viewer={{
        name: viewer.fullName || viewer.email,
        email: viewer.email,
        isSuperAdmin: viewer.isSuperAdmin,
        permissions: viewer.permissions,
      }}
    >
      {children}
    </StudioShell>
  );
}
