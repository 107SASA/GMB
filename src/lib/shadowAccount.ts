import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Organization from '@/models/Organization';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';
import { createSession } from '@/lib/session';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * Shadow accounts: a real, unverified, passwordless User+Organization+Business
 * created automatically the instant a phone-only visitor gets a free report
 * (e.g. /free-report), immediately given a real session cookie. This is what
 * lets the existing audit engine, dashboard, and billing/checkout stack — all
 * of which assume a real logged-in User — work completely unmodified for a
 * visitor who never signed up. "Claiming" later (see /api/onboarding/claim)
 * just means setting a real email + password on the same User document.
 */

export interface ShadowBusinessData {
  name: string;
  category?: string;
  address?: string;
  area?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  website?: string;
  googlePlaceId?: string;
  googleMapsUrl?: string;
  coordinates?: { lat: number; lng: number };
}

export interface ProvisionShadowAccountInput {
  /** Raw phone input from the visitor — normalized internally. */
  phone: string;
  businessData: ShadowBusinessData;
  /** Traceability tag, e.g. 'free-report-form'. */
  source: string;
}

export interface ProvisionShadowAccountResult {
  user: any;
  organization: any;
  business: any;
  /** True if an existing account for this phone number was found and reused
   *  instead of creating a new one — the second-visit idempotency guarantee. */
  reused: boolean;
}

function shadowEmailFor(normalizedPhone: string): string {
  return `${normalizedPhone.replace(/\D/g, '')}@shadow.growwmatics.internal`;
}

export async function provisionShadowAccount(
  input: ProvisionShadowAccountInput
): Promise<ProvisionShadowAccountResult> {
  await dbConnect();

  const normalizedPhone = normalizePhoneE164(input.phone);
  if (!normalizedPhone) {
    throw new Error('Please enter a valid phone number.');
  }

  let user = await User.findOne({ phone: normalizedPhone });
  let organization: any = null;
  let business: any = null;
  const reused = !!user;

  if (user) {
    if (user.organizationId) organization = await Organization.findById(user.organizationId);
    if (user.activeBusinessId) business = await Business.findById(user.activeBusinessId);
  } else {
    user = await User.create({
      fullName: input.businessData.name || 'Business Owner',
      email: shadowEmailFor(normalizedPhone),
      phone: normalizedPhone,
      role: 'CLIENT',
      isShadowAccount: true,
      shadowSource: input.source,
      isEmailVerified: false,
      onboardingCompleted: false,
    });
  }

  if (!organization) {
    organization = await Organization.create({
      name: input.businessData.name || 'My Organization',
      ownerId: user._id,
      subscriptionPlan: 'Free',
    });
  }

  if (!business) {
    business = await Business.create({
      name: input.businessData.name,
      category: input.businessData.category || 'Local Business',
      address: input.businessData.address || 'Unknown',
      area: input.businessData.area,
      city: input.businessData.city || 'Unknown',
      state: input.businessData.state,
      country: input.businessData.country,
      phone: input.businessData.phone,
      website: input.businessData.website,
      placeId: input.businessData.googlePlaceId || undefined,
      googlePlaceId: input.businessData.googlePlaceId || undefined,
      googleMapsUrl: input.businessData.googleMapsUrl,
      coordinates: input.businessData.coordinates,
      googleConnected: !!input.businessData.googlePlaceId,
      organizationId: organization._id,
      userId: user._id,
      provisionedVia: input.source,
      onboardingCompleted: false,
    });

    await User.findByIdAndUpdate(user._id, {
      $set: { organizationId: organization._id, activeBusinessId: business._id },
      $addToSet: { businessIds: business._id },
    });
    user.organizationId = organization._id;
    user.activeBusinessId = business._id;

    // Mirrors the freemium module entitlement a real new signup gets (see
    // /api/onboarding) so usage gating behaves the same for a shadow account.
    const existingSub = await Subscription.findOne({ userId: user._id });
    if (!existingSub) {
      await Subscription.create({
        userId: user._id,
        planType: 'Free',
        billingStatus: 'Active',
        trialStatus: { isActive: false },
      });
    }
  }

  // Real session, same as a normal login/signup — this is what makes
  // requireClient()/requireBusinessContext() succeed transparently below.
  await createSession(user._id.toString(), user.role);
  const cookieStore = await cookies();
  cookieStore.set('activeBusinessId', business._id.toString(), {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });

  return { user, organization, business, reused };
}
