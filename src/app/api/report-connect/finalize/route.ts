import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import ReportConversation from '@/models/ReportConversation';
import { decrypt } from '@/lib/crypto';
import { verifyReportConnectToken, finalizeReportConnection } from '@/lib/reportConnect';

/**
 * Submitted from /connect-google/select-listing once the visitor picks which
 * of their multiple GBP listings is theirs. The Google tokens themselves were
 * already staged (encrypted) on the ReportConversation by the callback route
 * — this route only needs to know which candidate location was chosen.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const token = String(body.token || '');
    const locationId = String(body.locationId || '');

    const payload = await verifyReportConnectToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'This link has expired. Please restart from WhatsApp.' }, { status: 401 });
    }
    if (!locationId) {
      return NextResponse.json({ error: 'Please choose a listing.' }, { status: 400 });
    }

    await dbConnect();
    const convo: any = await ReportConversation.findById(payload.reportConversationId);
    if (!convo?.pendingGoogleAuth) {
      return NextResponse.json({ error: 'No pending Google connection found. Please restart from WhatsApp.' }, { status: 404 });
    }

    const location = convo.pendingGoogleAuth.candidateLocations.find(
      (l: any) => l.locationId === locationId
    );
    if (!location) {
      return NextResponse.json({ error: 'That listing was not found. Please try again.' }, { status: 400 });
    }

    const pending = convo.pendingGoogleAuth;
    await finalizeReportConnection(payload.reportConversationId, location, {
      accessToken: decrypt(pending.accessToken),
      refreshToken: decrypt(pending.refreshToken),
      expiresAt: pending.expiresAt,
      scopes: pending.scopes,
      googleAccountId: pending.googleAccountId,
      googleEmail: pending.googleEmail,
      accountId: pending.accountId,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error('Report Connect Finalize Error:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
