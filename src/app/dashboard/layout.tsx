import { Sidebar } from "@/components/layout/Sidebar";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { BusinessProvider } from "@/context/BusinessContext";
import { MobileNavProvider } from "@/context/MobileNavContext";
import { ProductTourProvider } from "@/context/ProductTourContext";
import ProductTourOverlay from "@/components/tour/ProductTourOverlay";
import SuccessStoryPrompt from "@/components/dashboard/SuccessStoryPrompt";
import WorkspaceLockGate from "@/components/layout/WorkspaceLockGate";
import { requireClient } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authResult = await requireClient();

  if (!authResult.ok) {
    redirect("/login");
  }

  return (
    <MobileNavProvider>
      <BusinessProvider>
        <ProductTourProvider>
          <div className="min-h-screen bg-background flex overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col min-h-screen overflow-hidden lg:ml-64">
              <DashboardHeader />
              <main className="flex-1 overflow-y-auto p-gutter pb-24 lg:pb-8 custom-scrollbar">
                <div className="max-w-container-max mx-auto">
                  <WorkspaceLockGate>{children}</WorkspaceLockGate>
                </div>
              </main>
            </div>
            <ProductTourOverlay />
            <SuccessStoryPrompt />
          </div>
        </ProductTourProvider>
      </BusinessProvider>
    </MobileNavProvider>
  );
}
