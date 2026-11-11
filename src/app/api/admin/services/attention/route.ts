import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import ServiceAccount from '@/models/ServiceAccount';

export const dynamic = 'force-dynamic';

/** Sidebar badge: services whose last check was warning or worse (no live calls). */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();
  const rows = await ServiceAccount.find(
    { lastStatus: { $in: ['warning', 'critical', 'error'] }, alertsMuted: { $ne: true } },
    { key: 1, lastStatus: 1 }
  ).lean();
  const critical = rows.filter((r: any) => r.lastStatus !== 'warning').length;
  return NextResponse.json({ success: true, total: rows.length, critical });
}
