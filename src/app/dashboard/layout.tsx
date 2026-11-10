import { Sidebar } from "@/components/layout/Sidebar";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { BusinessProvider } from "@/context/BusinessContext";
import { MobileNavProvider } from "@/context/MobileNavContext";
import { ProductTourProvider } from "@/context/ProductTourContext";
import ProductTourOverlay from "@/components/tour/ProductTourOverlay";
import SuccessStoryPrompt from "@/components/dashboard/SuccessStoryPrompt";
import WeeklyOfferPrompt from "@/components/dashboard/WeeklyOfferPrompt";
import { GuidedFixBar } from "@/components/tasks/PlanTasks";
import WorkspaceLockGate from "@/components/layout/WorkspaceLockGate";
import GoogleAccessNotice from "@/components/layout/GoogleAccessNotice";
import { GoogleAccessProvider } from "@/context/GoogleAccessContext";
import { requireClient } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import AdminViewAsBanner from "@/components/layout/AdminViewAsBanner";
import { VIEW_AS_COOKIE, VIEW_AS_MAX_AGE_SEC, decodeViewAs } from "@/lib/adminViewAs";
import User from "@/models/User";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authResult = await requireClient();

  if (!authResult.ok) {
    redirect("/login");
  }

  // "Login as customer" — only ever honoured for a confirmed SUPER_ADMIN.
  let viewAsBanner: React.ReactNode = null;
  if ((authResult.user as any).role === "SUPER_ADMIN") {
    const viewAs = decodeViewAs((await cookies()).get(VIEW_AS_COOKIE)?.value);
    if (viewAs) {
      let ownerName: string | undefined;
      if (viewAs.ownerUserId) {
        const owner = await User.findById(viewAs.ownerUserId).select("fullName").lean<{ fullName?: string }>().catch(() => null);
        ownerName = owner?.fullName || undefined;
      }
      const expiresAt = new Date(Date.parse(viewAs.startedAt) + VIEW_AS_MAX_AGE_SEC * 1000).toISOString();
      viewAsBanner = <AdminViewAsBanner businessName={viewAs.businessName} ownerName={ownerName} expiresAt={expiresAt} />;
    }
  }

  return (
    <MobileNavProvider>
      <BusinessProvider>
        <ProductTourProvider>
          <GoogleAccessProvider>
          <div className="min-h-screen bg-background flex overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col min-h-screen overflow-hidden lg:ml-64">
              {viewAsBanner}
              <DashboardHeader />
              <main className="flex-1 overflow-y-auto p-gutter pb-24 lg:pb-8 custom-scrollbar">
                <div className="max-w-container-max mx-auto">
                  <GoogleAccessNotice />
                  <WorkspaceLockGate>{children}</WorkspaceLockGate>
                </div>
              </main>
            </div>
            <ProductTourOverlay />
            <SuccessStoryPrompt />
            <WeeklyOfferPrompt />
            <GuidedFixBar />
          </div>
          </GoogleAccessProvider>
        </ProductTourProvider>
      </BusinessProvider>
    </MobileNavProvider>
  );
}
