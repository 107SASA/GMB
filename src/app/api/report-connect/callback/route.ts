import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import dbConnect from '@/lib/mongodb';
import ReportConversation from '@/models/ReportConversation';
import { encrypt } from '@/lib/crypto';
import { finalizeReportConnection, mintReportConnectToken } from '@/lib/reportConnect';
import type { ICandidateLocation } from '@/models/ReportConversation';

/**
 * Unauthenticated counterpart to /api/auth/google/callback/route.ts. Mirrors
 * its code-exchange, userinfo, and GBP accounts/locations calls verbatim.
 * Difference: when the account manages more than one GBP location, this
 * route stages the result and sends the visitor to a picker instead of
 * silently choosing locations[0] (the authenticated flow's behavior, fine
 * there since it already knows which single Business is being connected —
 * here we don't know which of possibly several listings is theirs).
 */

function getSigningKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

function errorRedirect(reason: string, req: NextRequest, extra?: Record<string, string>): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL || req.url;
  const url = new URL('/connect-google/error', base);
  url.searchParams.set('reason', reason);
  for (const [k, v] of Object.entries(extra || {})) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

function appRedirect(path: string, req: NextRequest): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL || req.url;
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateFromGoogle = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    return errorRedirect('google_denied', request);
  }

  const stateToken = request.cookies.get('report_oauth_state')?.value;
  if (!stateToken || !stateFromGoogle) {
    return errorRedirect('state_mismatch', request);
  }

  let reportConversationId: string;
  try {
    const { payload } = await jwtVerify(stateToken, getSigningKey());
    if ((payload as any).state !== stateFromGoogle) throw new Error('State mismatch');
    reportConversationId = (payload as any).reportConversationId;
  } catch {
    return errorRedirect('state_mismatch', request);
  }

  if (!code) return errorRedirect('no_code', request);

  await dbConnect();
  const convo: any = await ReportConversation.findById(reportConversationId);
  if (!convo) return errorRedirect('conversation_not_found', request);

  const redirectUri = process.env.GOOGLE_REPORT_CONNECT_REDIRECT_URI;

  const tokenParams = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri!,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });
  if (!tokenRes.ok) return errorRedirect('token_exchange_failed', request);

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_in, scope } = tokenData;

  if (!refresh_token) {
    // Already consented before without offline access — retry; the start
    // route always forces prompt=consent so this gets a fresh refresh_token.
    const retryToken = await mintReportConnectToken({ reportConversationId, phone: convo.leadPhone });
    return appRedirect(`/api/report-connect/${encodeURIComponent(retryToken)}`, request);
  }

  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const userInfo = await userInfoRes.json();
  const googleAccountId: string = userInfo.sub;
  const googleEmail: string = userInfo.email;

  const accountsRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!accountsRes.ok) {
    const errBody = await accountsRes.text();
    console.error(`[report-connect/callback] accounts.list failed for ${googleEmail}: ${accountsRes.status} — ${errBody}`);
    const reason = accountsRes.status === 403 ? 'gbp_api_access' : 'gbp_api_error';
    return errorRedirect(reason, request);
  }
  const accountsData = await accountsRes.json();
  const accounts: any[] = accountsData.accounts ?? [];
  if (accounts.length === 0) return errorRedirect('no_gbp_account', request);

  const account = accounts[0];
  const accountId: string = account.name;

  const locUrl =
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations` +
    `?readMask=name,title,storefrontAddress,metadata`;
  const locRes = await fetch(locUrl, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!locRes.ok) return errorRedirect('gbp_api_error', request);

  const locData = await locRes.json();
  const rawLocations: any[] = locData.locations ?? [];
  if (rawLocations.length === 0) return errorRedirect('no_gbp_locations', request);

  const candidateLocations: ICandidateLocation[] = rawLocations.map((l: any) => ({
    locationId: l.name,
    placeId: l.metadata?.placeId,
    title: l.title || 'Untitled listing',
    address: [l.storefrontAddress?.addressLines?.join(', '), l.storefrontAddress?.locality]
      .filter(Boolean)
      .join(', '),
  }));

  const googleBundle = {
    accessToken: access_token as string,
    refreshToken: refresh_token as string,
    expiresAt: new Date(Date.now() + expires_in * 1000),
    scopes: scope ? scope.split(' ') : [],
    googleAccountId,
    googleEmail,
    accountId,
  };

  if (candidateLocations.length === 1) {
    await finalizeReportConnection(reportConversationId, candidateLocations[0], googleBundle);
    const response = appRedirect('/connect-google/connected', request);
    response.cookies.set('report_oauth_state', '', { maxAge: 0, path: '/' });
    return response;
  }

  // Multiple listings — stage the result and let the visitor pick.
  convo.pendingGoogleAuth = {
    accessToken: encrypt(googleBundle.accessToken),
    refreshToken: encrypt(googleBundle.refreshToken),
    expiresAt: googleBundle.expiresAt,
    scopes: googleBundle.scopes,
    googleAccountId,
    googleEmail,
    accountId,
    candidateLocations,
  };
  await convo.save();

  const pickerToken = await mintReportConnectToken({ reportConversationId, phone: convo.leadPhone });
  const response = appRedirect(`/connect-google/select-listing?token=${encodeURIComponent(pickerToken)}`, request);
  response.cookies.set('report_oauth_state', '', { maxAge: 0, path: '/' });
  return response;
}
