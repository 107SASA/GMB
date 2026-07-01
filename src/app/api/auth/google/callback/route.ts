import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import dbConnect from '@/lib/mongodb';
import GBPToken from '@/models/GBPToken';
import Business from '@/models/Business';
import { encrypt } from '@/lib/crypto';
import { inngest } from '@/services/inngest/client';

function getSigningKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(secret);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateFromGoogle = searchParams.get('state');
  const errorParam = searchParams.get('error');

  if (errorParam) {
    return NextResponse.redirect(
      new URL(`/dashboard/insights?error=${encodeURIComponent(errorParam)}`, request.url)
    );
  }

  // --- Verify state cookie ---
  const cookieStore = request.cookies;
  const stateToken = cookieStore.get('gbp_oauth_state')?.value;

  if (!stateToken || !stateFromGoogle) {
    return NextResponse.redirect(
      new URL('/dashboard/insights?error=state_mismatch', request.url)
    );
  }

  let businessId: string;
  try {
    const { payload } = await jwtVerify(stateToken, getSigningKey());
    if ((payload as any).state !== stateFromGoogle) {
      throw new Error('State mismatch');
    }
    businessId = (payload as any).businessId;
  } catch {
    return NextResponse.redirect(
      new URL('/dashboard/insights?error=state_mismatch', request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/dashboard/insights?error=no_code', request.url)
    );
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
    return NextResponse.redirect(
      new URL('/dashboard/insights?error=token_exchange_failed', request.url)
    );
  }

  const tokenData = await tokenRes.json();
  const { access_token, refresh_token, expires_in, scope } = tokenData;

  // If no refresh_token, user already consented before — force re-consent
  if (!refresh_token) {
    return NextResponse.redirect(
      new URL('/api/auth/google?prompt=consent&access_type=offline', request.url)
    );
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
    return NextResponse.redirect(
      new URL('/dashboard/insights?error=no_gbp_account', request.url)
    );
  }

  const accountsData = await accountsRes.json();
  const accounts: any[] = accountsData.accounts ?? [];
  if (accounts.length === 0) {
    return NextResponse.redirect(
      new URL('/dashboard/insights?error=no_gbp_account', request.url)
    );
  }

  const account = accounts[0];
  const accountId: string = account.name; // "accounts/{id}"

  // --- Fetch locations for this account ---
  await dbConnect();
  const business = await Business.findById(businessId).lean() as any;

  const locUrl =
    `https://mybusinessbusinessinformation.googleapis.com/v1/${accountId}/locations` +
    `?readMask=name,title,storefrontAddress`;

  const locRes = await fetch(locUrl, {
    headers: { Authorization: `Bearer ${access_token}` },
  });

  let locationId = '';
  if (locRes.ok) {
    const locData = await locRes.json();
    const locations: any[] = locData.locations ?? [];

    // Try to match by googlePlaceId, otherwise take the first location
    const matched = business?.googlePlaceId
      ? locations.find((l: any) =>
          l.metadata?.placeId === business.googlePlaceId
        )
      : null;

    const chosenLocation = matched ?? locations[0];
    locationId = chosenLocation?.name ?? '';
  }

  // --- Encrypt and upsert GBPToken ---
  const expiresAt = new Date(Date.now() + expires_in * 1000);
  const scopes: string[] = scope ? scope.split(' ') : [];

  await GBPToken.findOneAndUpdate(
    { businessId },
    {
      $set: {
        businessId,
        organizationId: business?.organizationId,
        googleAccountId,
        googleEmail,
        accessToken: encrypt(access_token),
        refreshToken: encrypt(refresh_token),
        expiresAt,
        locationId,
        accountId,
        scopes,
        connectedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  // --- Update Business ---
  await Business.findByIdAndUpdate(businessId, {
    googleConnected: true,
    googleLocationId: locationId,
  });

  // --- Trigger automatic GBP sync in the background ---
  try {
    await inngest.send({
      name: 'gbp/sync.requested',
      data: { businessId },
    });
  } catch (e) {
    // Non-blocking — sync will be retried by the nightly cron if this fails
    console.error('Failed to trigger GBP auto-sync:', e);
  }

  // --- Clear state cookie and redirect to Dashboard (GBP section is now inline) ---
  const response = NextResponse.redirect(
    new URL('/dashboard?connected=true', request.url)
  );
  response.cookies.set('gbp_oauth_state', '', { maxAge: 0, path: '/' });
  return response;
}
