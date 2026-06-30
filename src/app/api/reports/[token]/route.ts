import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReportShare from '@/models/ReportShare';
import Audit from '@/models/Audit';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    await dbConnect();

    const share = await ReportShare.findOne({ token });
    if (!share) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }
    if (share.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This report link has expired' }, { status: 410 });
    }

    const audit = await Audit.findById(share.auditId).lean();
    if (!audit || audit.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'Report not available' }, { status: 404 });
    }

    // Increment view count without blocking the response
    void ReportShare.updateOne({ _id: share._id }, { $inc: { viewCount: 1 } });

    return NextResponse.json({
      success: true,
      audit: {
        _id:           audit._id,
        businessName:  audit.businessName,
        location:      audit.location,
        website:       audit.website,
        overallScore:  audit.overallScore,
        auditVersion:  audit.auditVersion,
        auditData:     audit.auditData,
        createdAt:     audit.createdAt,
      },
      expiresAt: share.expiresAt,
      viewCount: share.viewCount + 1,
    });
  } catch (err: any) {
    console.error('[reports/token]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
