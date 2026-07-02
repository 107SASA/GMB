import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import AutomationLog from '@/models/AutomationLog';

export async function POST() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  try {
    await dbConnect();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);

    const result = await AutomationLog.deleteMany({ createdAt: { $lt: cutoff } });

    return NextResponse.json({
      success: true,
      data: {
        deleted:  result.deletedCount,
        olderThan: cutoff.toISOString().slice(0, 10),
      },
    });
  } catch (error: any) {
    console.error('Clear Logs Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to clear automation logs' },
      { status: 500 }
    );
  }
}
