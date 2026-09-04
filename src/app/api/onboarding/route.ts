import { NextResponse } from 'next/server';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import Organization from '@/models/Organization';
import Subscription from '@/models/Subscription';
import { generateOTP, hashOTP } from '@/services/auth/otp';
import { sendOtpMessage } from '@/services/whatsapp/send';
import { normalizePhoneE164 } from '@/lib/phone';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isQaTestingMode } from '@/lib/testingMode';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes — matches phone-login/request
// Reserved for shadow accounts (see src/lib/shadowAccount.ts) — must never be
// registerable through normal signup. Without this block, an attacker could
// pre-register a specific phone number's future shadow email, permanently
// denying that phone the /free-report flow (targeted DoS via unique-index
// collision) — see shadowAccount.ts's shadowEmailFor().
const SHADOW_EMAIL_DOMAIN = '@shadow.growwmatics.internal';

export async function POST(req: Request) {
  // Track only what THIS request creates, so a failure part-way can be rolled
  // back without deleting a pre-existing account that was merely resuming.
  let createdUserId: string | null = null;
  let createdOrgId: string | null = null;
  let createdBusinessId: string | null = null;

  try {
    const ip = getClientIp(req);
    const rate = checkRateLimit(`onboarding:${ip}`, 8, 15 * 60 * 1000);
    if (!rate.allowed && !isQaTestingMode()) {
      return NextResponse.json(
        { error: 'Too many signup attempts. Please try again in a few minutes.' },
        { status: 429 }
      );
    }

    await dbConnect();
    const body = await req.json();

    // Normalize the email the same way the schema stores it (lowercase + trim).
    // No longer the login identity, but still stored as a contact record and
    // still unique-indexed, so a typo'd-case duplicate should still resolve
    // to the same account rather than a confusing E11000 error.
    const email = String(body.email || '').trim().toLowerCase();

    if (email.endsWith(SHADOW_EMAIL_DOMAIN)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }

    // The user's OWN contact number (StepAccount) — deliberately separate
    // from `body.phone`, which is the BUSINESS's phone from StepBusinessSearch/
    // StepBusinessConfirm (used below for Business.create only). These used to
    // be the same field, so autofilling a business's Google-listed phone
    // number silently became the user's personal account phone too.
    const personalPhone = normalizePhoneE164(String(body.personalPhone || ''));
    if (!personalPhone) {
      return NextResponse.json(
        { error: 'Please enter your phone number in international format, e.g. +14155550100.' },
        { status: 400 }
      );
    }

    // Phone is the login identity now (WhatsApp-OTP-only), so it's the
    // resume-detection key too — not email.
    let newUser = await User.findOne({ phone: personalPhone });

    if (newUser && newUser.isPhoneVerified) {
      // A real, already-verified account already owns this phone number —
      // this is someone re-submitting the signup form, not a fresh signup or
      // a legitimate resume. There's no password here to prove they're the
      // owner, so the only safe answer is "go log in" rather than silently
      // attaching a new business to an existing stranger's account.
      return NextResponse.json(
        { error: 'An account already exists for this phone number. Please log in instead.', existingAccount: true },
        { status: 409 }
      );
    }

    if (!newUser) {
      const otp = generateOTP();
      newUser = await User.create({
        fullName: body.fullName || 'Test User',
        email,
        phone: personalPhone,
        companyName: body.companyName || undefined,
        role: 'CLIENT',
        isEmailVerified: false,
        isPhoneVerified: false,
        onboardingCompleted: true,
        phoneOtpHash: hashOTP(otp),
        phoneOtpExpiry: new Date(Date.now() + OTP_TTL_MS),
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

      const otpResult = await sendOtpMessage(
        newUser.phone,
        `Your GrowwMatics AI signup code is ${otp}. It expires in 10 minutes. Never share this code with anyone.`
      );
      if (!otpResult.success) {
        console.error('Failed to send onboarding OTP over WhatsApp:', otpResult.error);
      }
    } else {
      // Existing but not-yet-verified account resuming onboarding (e.g. they
      // closed the tab before entering the code). No password to check here
      // — they haven't proven phone ownership yet either way — so a fresh
      // OTP is sent below and verification is the gate, same as a first-time
      // signup. Backfill the company name they just typed in StepOrganization
      // (never overwrites one already saved).
      const otp = generateOTP();
      const resumeSet: Record<string, unknown> = {
        phoneOtpHash: hashOTP(otp),
        phoneOtpExpiry: new Date(Date.now() + OTP_TTL_MS),
      };
      if (body.companyName && !newUser.companyName) {
        resumeSet.companyName = body.companyName;
        newUser.companyName = body.companyName;
      }
      // updateOne (not newUser.save()) so a drifted legacy field on this
      // pre-existing account can't 500 a resumed signup — see
      // auth/phone-login/request/route.ts.
      await User.updateOne({ _id: newUser._id }, { $set: resumeSet });

      const otpResult = await sendOtpMessage(
        newUser.phone,
        `Your GrowwMatics AI signup code is ${otp}. It expires in 10 minutes. Never share this code with anyone.`
      );
      if (!otpResult.success) {
        console.error('Failed to send onboarding OTP over WhatsApp:', otpResult.error);
      }
    }

    // 2 & 3. Create Organization + Business — UNLESS this (possibly resuming)
    // user already completed this exact step before. Without this guard, a
    // double-click or a client retry after a network blip (the request may
    // have actually succeeded server-side) silently creates a SECOND
    // Organization + Business for the same account on every retry.
    let newOrg: any = null;
    let newBusiness: any = null;
    if (newUser.organizationId && newUser.activeBusinessId) {
      newOrg = await Organization.findById(newUser.organizationId);
      newBusiness = await Business.findById(newUser.activeBusinessId);
    }

    if (!newOrg || !newBusiness) {
      newOrg = await Organization.create({
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

      newBusiness = await Business.create({
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
      createdBusinessId = newBusiness._id.toString();

      // 4. Update User context. `businessIds` is the canonical list of workspaces
      //    a user owns — it's read by automation.ts, push/notification targeting
      //    and the user's business-list routes, so every workspace a user creates
      //    must be recorded here (this was previously never populated, which is
      //    why a second business per user didn't behave as a first-class workspace).
      await User.findByIdAndUpdate(newUser._id, {
        $set: {
          organizationId: newOrg._id,
          activeBusinessId: newBusiness._id,
        },
        $addToSet: { businessIds: newBusiness._id },
      });
    }

    // 5. Every account reaching this point is unverified — a brand-new signup
    //    always starts that way, and the 409 branch above already sent back
    //    anyone whose phone belongs to an already-verified account. So this
    //    handler never issues a session itself; verifying the WhatsApp OTP
    //    just sent (via /api/auth/verify-phone-otp) is what does that.
    return NextResponse.json(
      { success: true, requiresVerification: true, phone: newUser.phone, businessId: newBusiness._id },
      { status: 200 }
    );
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
    await rollbackPartialSignup({ createdUserId, createdOrgId, createdBusinessId });

    return NextResponse.json(
      { error: friendlyOnboardingError(error) },
      { status: 400 }
    );
  }
}

/** Deletes records created by a signup attempt that failed partway through. */
async function rollbackPartialSignup(
  { createdUserId, createdOrgId, createdBusinessId }:
  { createdUserId: string | null; createdOrgId: string | null; createdBusinessId: string | null }
) {
  try {
    // Business first — it references the Organization/User being deleted
    // next, so this order avoids leaving it pointing at nothing.
    if (createdBusinessId) await Business.deleteOne({ _id: createdBusinessId });
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
    if (key.includes('phone')) {
      return 'An account with this phone number already exists. Please log in instead.';
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
