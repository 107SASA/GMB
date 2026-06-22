import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authResult = await requireSuperAdmin();

  if (!authResult.ok) {
    redirect('/admin-login');
  }

  return (
    <div className="min-h-screen bg-slate-50 flex overflow-hidden">
      <AdminSidebar />
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden lg:ml-64">
        <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
