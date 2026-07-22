import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import Organization from '@/models/Organization';
import Subscription from '@/models/Subscription';
import { createSession, signSessionToken, SESSION_MAX_AGE_SECONDS } from '@/lib/session';
import { validatePasswordStrength } from '@/services/auth/security';
import { generateOTP, hashOTP } from '@/services/auth/otp';
import { sendEmailOtp } from '@/services/email';
import bcrypt from 'bcryptjs';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export async function POST(req: Request) {
  // Track only what THIS request creates, so a failure part-way can be rolled
  // back without deleting a pre-existing account that was merely resuming.
  let createdUserId: string | null = null;
  let createdOrgId: string | null = null;

  try {
    await dbConnect();
    const body = await req.json();

    let newUser = await User.findOne({ email: body.email });

    // Only validate email/password/phone when actually creating a new account —
    // an existing user resuming onboarding keeps their existing credentials.
    if (!newUser) {
      if (!body.email || !EMAIL_REGEX.test(body.email)) {
        return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
      }

      const passwordCheck = validatePasswordStrength(body.password || '');
      if (!passwordCheck.isValid) {
        return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
      }

      const normalizedPhone = normalizePhone(body.phone || '');
      if (!PHONE_REGEX.test(normalizedPhone)) {
        return NextResponse.json(
          { error: 'Please enter a valid phone number in international format, e.g. +14155550100.' },
          { status: 400 }
        );
      }

      // Hash the password before any DB writes — no plain-text bypass
      const passwordHash = await bcrypt.hash(body.password, 12);

      const otp = generateOTP();
      newUser = await User.create({
        fullName: body.fullName || 'Test User',
        email: body.email,
        phone: normalizedPhone,
        passwordHash,
        role: 'CLIENT',
        isEmailVerified: false,
        onboardingCompleted: true,
        emailOtpHash: hashOTP(otp),
        emailOtpExpiry: new Date(Date.now() + 15 * 60 * 1000),
        // Freemium gate: brand-new signups only get the GMB Audit module
        // (one report) until they upgrade. Existing/resuming accounts
        // (the `newUser` branch above is skipped for them) never get this
        // field set, so they're completely unaffected.
        freemiumAuditGate: { active: true, auditUsed: false },
      });

      // Newly created in this request → eligible for rollback if a later step fails.
      createdUserId = newUser._id.toString();

      // Mirrors the freemium gate in the existing module-entitlement system
      // (src/lib/moduleGating.ts) so API routes that already call
      // requireModule() — CRM leads, Inbox, Reviews, GBP insights — are
      // correctly locked for this brand-new user too. Only 'google_ranking_agent'
      // (the Audit module) is enabled; billingStatus is explicitly 'Active'
      // (not the schema-default 'Trialing') so the trial bypass in
      // requireModule() doesn't grant full access.
      await Subscription.create({
        userId: newUser._id,
        planType: 'Free',
        billingStatus: 'Active',
        trialStatus: { isActive: false },
      });

      const otpResult = await sendEmailOtp(newUser.email, otp, 'verify');
      if (!otpResult.success) {
        console.error('Failed to send onboarding OTP email:', otpResult.error);
      }
    }

    // 2. Create Organization
    const newOrg = await Organization.create({
      name: body.businessName || 'My Organization',
      ownerId: newUser._id,
      subscriptionPlan: body.selectedPlan === 'starter' ? 'Free' : 'Pro',
    });
    createdOrgId = newOrg._id.toString();

    // Naive city/state extraction from comma-separated address
    const addressParts = (body.address || '').split(',').map((p: string) => p.trim());
    let city = 'Unknown';
    let state = 'Unknown';
    if (addressParts.length >= 3) {
      city = addressParts[addressParts.length - 3];
      state = addressParts[addressParts.length - 2].split(' ')[0];
    } else if (addressParts.length === 2) {
      city = addressParts[0];
      state = addressParts[1].split(' ')[0];
    }

    // 3. Create Business
    const newBusiness = await Business.create({
      name: body.businessName,
      category: body.category || 'Local Business',
      description: body.description,
      address: body.address || 'Unknown',
      area: body.area,
      city: body.city || city,
      state: body.state || state,
      country: body.country,
      phone: body.phone,
      website: body.website,
      placeId: body.googlePlaceId || undefined,
      googlePlaceId: body.googlePlaceId || undefined,
      googleMapsUrl: body.googleMapsUrl,
      coordinates:
        body.latitude && body.longitude
          ? { lat: body.latitude, lng: body.longitude }
          : undefined,
      googleConnected: !!body.googlePlaceId,
      organizationId: newOrg._id,
      userId: newUser._id,
      metaBusinessProfileUrl: body.metaBusinessProfileUrl,
      facebookPageUrl: body.facebookPageUrl,
      instagramUrl: body.instagramUrl,
      // integrations.whatsappNumber is the Twilio WhatsApp number for this business.
      // The webhook routes incoming messages by matching To against this field.
      // whatsappConfig.businessPhone stores the same value for display / Meta future use.
      //
      // Migration for existing records (run once in MongoDB shell):
      // db.businesses.updateMany(
      //   { 'whatsappConfig.businessPhone': { $exists: true, $ne: '' }, 'integrations.whatsappNumber': { $exists: false } },
      //   [{ $set: { 'integrations.whatsappNumber': '$whatsappConfig.businessPhone' } }]
      // )
      integrations: {
        whatsappNumber: body.whatsappBusinessNumber || undefined,
      },
      whatsappConfig: {
        provider: 'meta',
        businessPhone: body.whatsappBusinessNumber,
        metaProfileUrl: body.metaBusinessProfileUrl,
        isConnected: !!body.whatsappBusinessNumber,
      },
      aiSettings: {
        tone: body.aiTone || 'professional',
        salesPrompt: body.aiSalesPrompt,
      },
      onboardingCompleted: true,
    });

    // 4. Update User context
    await User.findByIdAndUpdate(newUser._id, {
      $set: {
        organizationId: newOrg._id,
        activeBusinessId: newBusiness._id,
      },
    });

    // 5. Unverified accounts don't get a session until they confirm their email —
    //    an existing, already-verified user resuming onboarding does.
    if (!newUser.isEmailVerified) {
      return NextResponse.json(
        { success: true, requiresVerification: true, email: newUser.email, businessId: newBusiness._id },
        { status: 200 }
      );
    }

    // Issue a signed session for the verified user — overwrites any stale session
    // that was in the browser from a previous account.
    await createSession(newUser._id.toString(), newUser.role);

    const cookieStore = await cookies();
    cookieStore.set('activeBusinessId', newBusiness._id.toString(), {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30,
    });

    // Mobile clients get the JWT in the body (no cookie support); web never does.
    if (req.headers.get('x-client') === 'mobile') {
      const token = await signSessionToken(newUser._id.toString(), newUser.role);
      const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
      return NextResponse.json(
        { success: true, businessId: newBusiness._id, token, expiresAt },
        { status: 200 }
      );
    }

    return NextResponse.json({ success: true, businessId: newBusiness._id }, { status: 200 });
  } catch (error: any) {
    // Full detail to the server log, never to the browser. This used to return
    // `error.message` straight through, which is how raw driver text like
    // "E11000 duplicate key error collection: test.businesses index: placeId_1"
    // ended up on screen during signup.
    console.error('Onboarding Creation Error:', error);

    // Roll back anything THIS request created, so a retry starts from a clean
    // slate instead of tripping over a half-built account. Only records created
    // in this request are removed — a pre-existing user resuming onboarding
    // (createdUserId stays null) is never touched.
    await rollbackPartialSignup({ createdUserId, createdOrgId });

    return NextResponse.json(
      { error: friendlyOnboardingError(error) },
      { status: 400 }
    );
  }
}

/** Deletes records created by a signup attempt that failed partway through. */
async function rollbackPartialSignup(
  { createdUserId, createdOrgId }: { createdUserId: string | null; createdOrgId: string | null }
) {
  try {
    if (createdOrgId) await Organization.deleteOne({ _id: createdOrgId });
    if (createdUserId) {
      await Subscription.deleteMany({ userId: createdUserId });
      await User.deleteOne({ _id: createdUserId });
    }
  } catch (cleanupError) {
    // Never let cleanup failure mask the original error the user needs to see.
    console.error('Onboarding rollback failed:', cleanupError);
  }
}

/**
 * Turns a driver/validation error into something a business owner can act on.
 * Anything unrecognised becomes a generic message — we never surface internal
 * collection names, index names or stack traces to the client.
 */
function friendlyOnboardingError(error: any): string {
  if (error?.code === 11000) {
    const key = Object.keys(error.keyPattern ?? error.keyValue ?? {}).join(',');
    if (key.includes('placeId')) {
      return 'This Google Business Profile is already connected to your workspace. Search for a different business, or continue with the one you already added.';
    }
    if (key.includes('email')) {
      return 'An account with this email already exists. Try signing in instead, or use a different email address.';
    }
    return 'Some of these details are already registered. Please review your entries and try again.';
  }

  if (error?.name === 'ValidationError') {
    const first = Object.values(error.errors ?? {})[0] as any;
    return first?.message
      ? `Please check your details: ${first.message}`
      : 'Some required details are missing or invalid. Please review the form and try again.';
  }

  return "We couldn't finish setting up your workspace. Please try again — if this keeps happening, contact support.";
}
