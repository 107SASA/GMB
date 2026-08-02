import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { jwtVerify } from 'jose';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import PendingGbpConnection from '@/models/PendingGbpConnection';
import { encrypt } from '@/lib/crypto';
import { finalizeGbpConnection, formatLocationAddress } from '@/lib/gbpConnect';

function getSigningKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

/**
 * Builds an absolute redirect URL rooted at NEXT_PUBLIC_APP_URL rather than
 * `request.url`. Behind a reverse proxy that doesn't forward the original
 * Host header (e.g. nginx without `proxy_set_header Host $host;`), Next sees
 * an internal Host like `localhost:3000`, so `new URL(path, request.url)`
 * silently produces a `localhost` redirect even in production — this is what
 * sent users to `http://localhost:3000/dashboard...` after connecting GBP on
 * the live site. NEXT_PUBLIC_APP_URL is already required to be the real HTTPS
 * domain in production (validated at boot in src/lib/env.ts).
 */
function appRedirect(path: string, request: NextRequest): NextResponse {
  const base = process.env.NEXT_PUBLIC_APP_URL || request.url;
  return NextResponse.redirect(new URL(path, base));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateFromGoogle = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    return appRedirect(`/dashboard/insights?error=${encodeURIComponent(errorParam)}`, request);
  }

  // --- Verify state cookie ---
  const cookieStore = request.cookies;
  const stateToken = cookieStore.get('gbp_oauth_state')?.value;

  if (!stateToken || !stateFromGoogle) {
    return appRedirect('/dashboard/insights?error=state_mismatch', request);
  }

  let businessId: string;
  try {
    const { payload } = await jwtVerify(stateToken, getSigningKey());
    if ((payload as any).state !== stateFromGoogle) {
      throw new Error('State mismatch');
    }
    businessId = (payload as any).businessId;
  } catch {
    return appRedirect('/dashboard/insights?error=state_mismatch', request);
  }

  if (!code) {
    return appRedirect('/dashboard/insights?error=no_code', request);
  }

  // --- Exchange code for tokens ---
  const tokenParams = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
    grant_type: 'authorization_code',
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    return appRedirect('/dashboard/insights?error=token_exchange_failed', request);
  }

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_in, scope } = tokenData;

  // If no refresh_token, user already consented before — force re-consent
  if (!refresh_token) {
    return appRedirect('/api/auth/google?prompt=consent&access_type=offline', request);
  }

  // --- Fetch Google user info for email/sub ---
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  const userInfo = await userInfoRes.json();
  const googleAccountId: string = userInfo.sub;
  const googleEmail: string = userInfo.email;

  // --- Fetch GBP accounts ---
  const accountsRes = await fetch(
    'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
    { headers: { Authorization: `Bearer ${access_token}` } }
  );

  if (!accountsRes.ok) {
    // NOTE: this is almost never "the user has no account". It's an API error
    // — most commonly a 403 because the "My Business Account Management API"
    // isn't enabled in the Cloud project, or Business Profile API access
    // hasn't been granted yet. Log Google's real response so it's diagnosable
    // from the server terminal instead of the misleading "no gbp account".
    const errBody = await accountsRes.text();
    console.error(
      `[gbp/callback] accounts.list failed for ${googleEmail}: ` +
        `${accountsRes.status} ${accountsRes.statusText} — ${errBody}`
    );
    const reason = accountsRes.status === 403 ? 'gbp_api_access' : 'gbp_api_error';
    return appRedirect(`/dashboard/insights?error=${reason}&status=${accountsRes.status}`, request);
  }

  const accountsData = await accountsRes.json();
  const accounts: any[] = accountsData.accounts ?? [];
  if (accounts.length === 0) {
    console.warn(
      `[gbp/callback] accounts.list returned an EMPTY list for ${googleEmail} ` +
        `(API is reachable but this Google account manages no Business Profile accounts).`
    );
    return appRedirect('/dashboard/insights?error=no_gbp_account', request);
  }

  const account = accounts[0];
  const accountId: string = account.name; // "accounts/{id}"

  // --- Fetch locations for this account ---
  await dbConnect();
  const business = await Business.findById(businessId).lean() as any;
  const organizationId: string = business?.organizationId?.toString?.() ?? business?.organizationId;

  // `metadata` MUST be in the readMask — the matching logic below reads
  // `l.metadata?.placeId`, and Google's Business Information API only
  // returns fields you explicitly ask for. Without it, metadata is
  // undefined on every location and the placeId match below can never
  // succeed.
  const locUrl =
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations` +
    `?readMask=name,title,storefrontAddress,metadata`;

  const locRes = await fetch(locUrl, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  let locations: any[] = [];
  if (locRes.ok) {
    const locData = await locRes.json();
    locations = locData.locations ?? [];
  }

  // Try to match by googlePlaceId when the workspace has one on file.
  const matched = business?.googlePlaceId
    ? locations.find((l: any) => l.metadata?.placeId === business.googlePlaceId)
    : null;

  const expiresAt = new Date(Date.now() + expires_in * 1000);
  const scopes: string[] = scope ? scope.split(' ') : [];

  if (!matched && locations.length > 1) {
    // Multiple candidate locations and no confident match — do NOT guess.
    // Silently picking locations[0] here is exactly what caused every
    // workspace connecting this Google account to inherit the same first
    // listing. Stage the exchanged tokens + candidates and let the user
    // choose (src/app/dashboard/gbp-profile/select-location/page.tsx).
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await PendingGbpConnection.create({
      tokenHash,
      businessId,
      organizationId,
      googleAccountId,
      googleEmail,
      accessToken: encrypt(access_token),
      refreshToken: encrypt(refresh_token),
      expiresAt,
      accountId,
      scopes,
      candidateLocations: locations.map((l: any) => ({
        locationId: l.name,
        title: l.title ?? '',
        address: formatLocationAddress(l.storefrontAddress),
        placeId: l.metadata?.placeId,
      })),
    });

    const response = appRedirect('/dashboard/gbp-profile/select-location', request);
    response.cookies.set('gbp_oauth_state', '', { maxAge: 0, path: '/' });
    response.cookies.set('gbp_pending_selection', rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 15 * 60,
    });
    return response;
  }

  // Confident match, or unambiguous (0 or 1 total locations) — proceed as before.
  const locationId: string = matched?.name ?? locations[0]?.name ?? '';

  await finalizeGbpConnection({
    businessId,
    organizationId,
    googleAccountId,
    googleEmail,
    accessToken: access_token,
    refreshToken: refresh_token,
    expiresAt,
    locationId,
    accountId,
    scopes,
  });

  // --- Clear state cookie and redirect to Dashboard (GBP section is now inline) ---
  const response = appRedirect('/dashboard?connected=true', request);
  response.cookies.set('gbp_oauth_state', '', { maxAge: 0, path: '/' });
  return response;
}
