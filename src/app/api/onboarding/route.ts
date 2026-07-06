import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import Business from '@/models/Business';
import User from '@/models/User';
import Organization from '@/models/Organization';
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
    console.error('Onboarding Creation Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to save configuration' },
      { status: 500 }
    );
  }
}
