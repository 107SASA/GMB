import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import { requireClient } from '@/lib/auth';

/**
 * Lets a shadow-account owner dismiss the "set email/password" claim prompt
 * (src/app/dashboard/onboarding/claim/page.tsx) without completing it.
 * Phone+OTP login already gives them a durable way back into the account —
 * that was the whole reason the claim gate existed — so once they say "not
 * now", proxy.ts's needsClaim stops hard-blocking the dashboard behind it.
 * Purely a UX dismissal: isShadowAccount / isEmailVerified are untouched, so
 * nothing else that reads those fields is affected, and the claim page stays
 * reachable any time from account settings if they change their mind.
 */
export async function POST() {
  try {
    const authResult = await requireClient();
    if (!authResult.ok) return authResult.response;

    await dbConnect();
    await User.findByIdAndUpdate(authResult.userId, { claimSkipped: true });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Claim Skip Error:', error);
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 });
  }
}
