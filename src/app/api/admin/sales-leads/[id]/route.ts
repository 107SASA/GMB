import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import dbConnect from '@/lib/mongodb';
import { requireSuperAdmin } from '@/lib/superAdminAuth';
import Business from '@/models/Business';

/** PATCH /api/admin/sales-leads/[id] — moves a workspace between pipeline stages (KanbanBoard drag/drop, or column deletion clearing its cards). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !('pipelineStage' in body)) {
    return NextResponse.json({ success: false, error: 'pipelineStage is required.' }, { status: 400 });
  }

  try {
    await dbConnect();
    await Business.updateOne(
      { _id: id },
      body.pipelineStage === null
        ? { $unset: { pipelineStage: '' } }
        : { $set: { pipelineStage: String(body.pipelineStage) } }
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[admin/sales-leads/:id] PATCH failed:', error);
    return NextResponse.json({ success: false, error: 'Failed to update stage.' }, { status: 500 });
  }
}
