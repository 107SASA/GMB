import { SignJWT, jwtVerify } from 'jose';
import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import Business from '@/models/Business';
import ReportConversation, { type ICandidateLocation } from '@/models/ReportConversation';
import { encrypt } from '@/lib/crypto';
import { provisionShadowAccount } from '@/lib/shadowAccount';
import { createPendingAuditAndDispatch } from '@/lib/startAudit';
import { inngest } from '@/services/inngest/client';

/**
 * Shared plumbing for the WhatsApp-first "connect your Google Business
 * Profile" flow (see plan: Flow A Part 1). Mirrors the signing pattern
 * already used by src/app/api/auth/google/route.ts's gbp_oauth_state cookie,
 * reused here (same SESSION_SECRET, same `jose` library) for a token that
 * travels in a URL instead of a cookie, since this flow starts from a fresh
 * browser opened from WhatsApp with no prior session.
 */

function getSigningKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export interface ReportConnectTokenPayload {
  reportConversationId: string;
  phone: string;
}

/** Mints the token embedded in the WhatsApp connect link, and reused (fresh)
 *  to carry the visitor from the OAuth callback into the listing picker. */
export async function mintReportConnectToken(payload: ReportConnectTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(getSigningKey());
}

export async function verifyReportConnectToken(token: string): Promise<ReportConnectTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey());
    const { reportConversationId, phone } = payload as any;
    if (!reportConversationId || !phone) return null;
    return { reportConversationId, phone };
  } catch {
    return null;
  }
}

export interface GoogleTokenBundle {
  accessToken: string;  // plaintext, will be encrypted before persisting
  refreshToken: string; // plaintext
  expiresAt: Date;
  scopes: string[];
  googleAccountId: string;
  googleEmail: string;
  accountId: string;
}

/**
 * Provisions the shadow account for a chosen GBP location, creates the
 * GBPToken from the Google tokens obtained during OAuth, starts the audit,
 * and marks the ReportConversation connected. Called either directly from
 * the callback (single-location accounts, no picker needed) or from
 * POST /api/report-connect/finalize (multi-location accounts, after the
 * visitor picks one on /connect-google/select-listing).
 */
export async function finalizeReportConnection(
  reportConversationId: string,
  location: ICandidateLocation,
  google: GoogleTokenBundle
) {
  await dbConnect();

  const convo: any = await ReportConversation.findById(reportConversationId);
  if (!convo) throw new Error('Report conversation not found');

  const { user, business, organization } = await provisionShadowAccount({
    phone: convo.leadPhone,
    source: 'whatsapp-report-agent',
    // The webhook that created this conversation already verified the
    // inbound WhatsApp message's sender (Meta/Twilio signature validation)
    // — phone ownership is proven out-of-band here, unlike an anonymous
    // HTTP form submission.
    phoneVerified: true,
    businessData: {
      name: location.title,
      address: location.address,
      googlePlaceId: location.placeId,
    },
  });

  await GBPToken.findOneAndUpdate(
    { businessId: business._id },
    {
      $set: {
        businessId: business._id,
        organizationId: organization._id,
        googleAccountId: google.googleAccountId,
        googleEmail: google.googleEmail,
        accessToken: encrypt(google.accessToken),
        refreshToken: encrypt(google.refreshToken),
        expiresAt: google.expiresAt,
        locationId: location.locationId,
        accountId: google.accountId,
        scopes: google.scopes,
        connectedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  await Business.findByIdAndUpdate(business._id, {
    googleConnected: true,
    googleLocationId: location.locationId,
  });

  const audit = await createPendingAuditAndDispatch(business, organization, user);

  convo.status = 'connected';
  convo.businessId = business._id;
  convo.auditId = audit._id;
  convo.connectedAt = new Date();
  convo.pendingGoogleAuth = undefined;
  await convo.save();

  // Hands off to the WhatsApp report agent (D3) to poll for the audit and
  // deliver the report-card image once it's ready.
  await inngest.send({ name: 'report/deliver.requested', data: { conversationId: convo._id.toString() } });

  return { convo, business, audit };
}
