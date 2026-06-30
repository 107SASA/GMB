import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import dbConnect from '@/lib/mongodb';
import Audit from '@/models/Audit';
import ReportShare from '@/models/ReportShare';
import { requireBusinessContext } from '@/lib/tenant';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireBusinessContext();
    if (!ctx.ok) return ctx.response;

    const { id: auditId } = await params;

    await dbConnect();

    const audit = await Audit.findOne({ _id: auditId, businessId: ctx.businessId });
    if (!audit) {
      return NextResponse.json({ error: 'Audit not found' }, { status: 404 });
    }

    // Re-use existing non-expired share if one already exists
    const existing = await ReportShare.findOne({
      auditId:   audit._id,
      expiresAt: { $gt: new Date() },
    });
    if (existing) {
      return NextResponse.json({ success: true, token: existing.token });
    }

    const token     = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await ReportShare.create({ auditId: audit._id, token, createdBy: ctx.userId, expiresAt });

    return NextResponse.json({ success: true, token });
  } catch (err: any) {
    console.error('[audit/share]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
