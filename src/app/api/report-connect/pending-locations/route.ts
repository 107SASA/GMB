import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReportConversation from '@/models/ReportConversation';
import { verifyReportConnectToken } from '@/lib/reportConnect';

/**
 * Resolves the candidate GBP listings staged by the OAuth callback for the
 * /connect-google/select-listing picker. Token-gated rather than trusting
 * anything client-supplied — the token is the same short-lived one minted
 * for the picker redirect.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token') || '';

  const payload = await verifyReportConnectToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'This link has expired. Please restart from WhatsApp.' }, { status: 401 });
  }

  await dbConnect();
  const convo: any = await ReportConversation.findById(payload.reportConversationId).lean();
  if (!convo?.pendingGoogleAuth) {
    return NextResponse.json({ error: 'No pending Google connection found.' }, { status: 404 });
  }

  const locations = (convo.pendingGoogleAuth.candidateLocations || []).map((l: any) => ({
    locationId: l.locationId,
    title: l.title,
    address: l.address,
  }));

  return NextResponse.json({ success: true, locations }, { status: 200 });
}
