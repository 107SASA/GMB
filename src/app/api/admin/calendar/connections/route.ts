import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import SalespersonCalendarConnection from '@/models/SalespersonCalendarConnection';
import { publicCalendarConnection } from '@/services/calendar/demoScheduling';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  await dbConnect();
  const rows = await SalespersonCalendarConnection.find()
    .select('userId googleEmail calendarId status lastCheckedAt')
    .lean();
  return NextResponse.json({
    success: true,
    connections: rows.map((row: any) => publicCalendarConnection({ ...row, userId: String(row.userId) })),
  });
}

export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === 'string' ? body.userId : auth.userId;
  if (userId !== auth.userId) {
    return NextResponse.json({ success: false, error: 'You can disconnect only your own calendar.' }, { status: 403 });
  }
  await dbConnect();
  await SalespersonCalendarConnection.updateOne(
    { userId },
    { $set: { status: 'revoked', refreshTokenEnc: '', accessTokenEnc: '', lastError: 'Disconnected by the salesperson.' } }
  );
  return NextResponse.json({ success: true });
}
