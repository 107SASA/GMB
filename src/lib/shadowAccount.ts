import { cookies } from 'next/headers';
import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Organization from '@/models/Organization';
import Business from '@/models/Business';
import Subscription from '@/models/Subscription';
import { createSession } from '@/lib/session';
import { normalizePhoneE164 } from '@/lib/phone';
import { isWorkspaceUnlocked } from '@/lib/workspaceAccess';
import { isQaTestingMode } from '@/lib/testingMode';

/**
 * Shadow accounts: a real, unverified, passwordless User+Organization+Business
 * created automatically the instant a phone-only visitor gets a free report
 * (e.g. /free-report), immediately given a real session cookie. This is what
 * lets the existing audit engine, dashboard, and billing/checkout stack — all
 * of which assume a real logged-in User — work completely unmodified for a
 * visitor who never signed up. There's no separate "claim" step to convert
 * one into a normal account — phone+WhatsApp OTP (/api/auth/phone-login) is
 * the durable, permanent way back in for these accounts.
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
  /**
   * Rating/review-count snapshot read live from the Places Details API when
   * the visitor picked their listing — see PlaceDetailsResult in
   * src/services/google/places.ts. Stored as Business.placesRating/
   * placesReviewCount so the free-report audit (which otherwise only has
   * access to synced Review documents, and skips syncing in fastMode — see
   * auditService.ts) has real numbers to fall back to instead of 0.
   */
  placesRating?: number;
  placesReviewCount?: number;
  /**
   * Google's own one-line summary of the place (editorial_summary.overview),
   * used as the closest available live substitute for a business description
   * when the visitor hasn't typed one — most listings don't have one, so
   * this is commonly absent even for a fully "live" fetch.
   */
  editorialSummary?: string;
  /**
   * Also read live from Places Details — closes the "Business Photos" /
   * "Business Hours" checklist items (calculateProfileCompletion in
   * seoAnalyzer.ts) without needing GBP OAuth. Stored on Business.photoCount/
   * hasHours, the same fields the SerpApi review-sync path (fuller audits)
   * already populates — this just also populates them for the fastMode
   * free-report path, which skips that sync.
   */
  photoCount?: number;
  hasHours?: boolean;
  /** Raw Places `types[]` — stored on Business.googleTypes (a field that
   *  already existed on the model but was never actually populated).
   *  Powers the competitor-relevance filter in competitorService.ts. */
  googleTypes?: string[];
}

export interface ProvisionShadowAccountInput {
  /** Raw phone input from the visitor — normalized internally. */
  phone: string;
  businessData: ShadowBusinessData;
  /** Traceability tag, e.g. 'free-report-form'. */
  source: string;
  /**
   * True ONLY when the caller has independently verified this phone number
   * out-of-band (e.g. an authenticated inbound WhatsApp message from that
   * exact number). False (the default) for anonymous HTTP callers like
   * /free-report's public form, where `phone` is just user-typed input.
   *
   * SECURITY: without this distinction, an unauthenticated caller could POST
   * any phone number and be silently logged in AS that phone's existing
   * account — including an already-claimed, password-protected real
   * customer, or a shadow account that has already paid but not yet
   * claimed (i.e. hijacking a paid account before its real owner sets a
   * password). See CLAIMED_OR_PAID_REUSE_ERROR below for the guard.
   */
  phoneVerified?: boolean;
}

export const CLAIMED_OR_PAID_REUSE_ERROR =
  'An account already exists for this phone number. Please log in to continue.';

export interface ProvisionShadowAccountResult {
  user: any;
  organization: any;
  business: any;
  /** True if this exact business (matched by googlePlaceId, or name when
   *  neither side has one) already existed for this phone number and was
   *  reused — false if a new business was created, even for a returning
   *  phone checking a different business for the first time. */
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
  // Set inside the `if (user)` branch below; stays false for a brand-new
  // user (nothing "established" yet — the create-from-scratch branch always
  // needs to set activeBusinessId, same as before).
  let isEstablishedAccount = false;

  if (user) {
    // A returning phone number doesn't always mean the same business — an
    // agency (or someone just testing) may check several. Only reuse an
    // existing business if it's genuinely the SAME one: matched by
    // googlePlaceId when both sides have it, otherwise by name (case-
    // insensitive). Search all of this user's businesses, not just the
    // currently-active one, so re-checking an earlier business also works.
    const candidates = user.businessIds?.length
      ? await Business.find({ _id: { $in: user.businessIds } })
      : [];

    // SECURITY: an anonymous HTTP caller (phoneVerified not set — e.g. the
    // public /free-report form) must NEVER be silently logged into an
    // existing account unless there is genuinely nothing to protect yet.
    // Refuse when the account is already claimed (real password), or when
    // ANY of its workspaces has already paid — that's the exact window
    // where a phone-guessing attacker could hijack a freshly-paid account
    // before its real owner claims it. Reusing an unclaimed, never-paid
    // shadow account is fine (nothing of value to steal) and is what makes
    // "recognize a returning visitor" work safely.
    // Same "claimed, or already has a paid workspace" check the security
    // guard below uses — also drives whether this call is allowed to move
    // the user's activeBusinessId. An established account's active dashboard
    // workspace must never be silently swapped out just because their phone
    // number showed up on another report request (see the activeBusinessId
    // reassignment bug this replaced: a claimed/paid user's dashboard kept
    // jumping to whatever business was most recently free-reported — through
    // the WhatsApp report agent's phoneVerified:true path in production, or
    // through the QA_TESTING_MODE bypass below in local testing — landing
    // them back on an unconfigured workspace's subscription/intake gate).
    isEstablishedAccount =
      !user.isShadowAccount ||
      candidates.some((c: any) =>
        isWorkspaceUnlocked({
          subscriptionStatus: c.subscriptionStatus,
          userSubscriptionPlan: user.subscriptionPlan,
          businessCreatedAt: c.createdAt,
        }),
      );

    if (!input.phoneVerified && !isQaTestingMode() && isEstablishedAccount) {
      throw new Error(CLAIMED_OR_PAID_REUSE_ERROR);
    }

    if (user.organizationId) organization = await Organization.findById(user.organizationId);

    const incomingPlaceId = input.businessData.googlePlaceId;
    const incomingName = input.businessData.name.trim().toLowerCase();
    business = candidates.find((c: any) => {
      if (incomingPlaceId && c.googlePlaceId) return c.googlePlaceId === incomingPlaceId;
      return !c.googlePlaceId && c.name?.trim().toLowerCase() === incomingName;
    }) || null;

    // Only move the user's active workspace for a still-unestablished shadow
    // account (the "recognize a returning visitor" case this was built for).
    // An established account keeps its current activeBusinessId regardless —
    // the caller (free-report, WhatsApp report agent) already returns the
    // resolved `business` directly and doesn't need the cookie/session to
    // point at it.
    if (business && !isEstablishedAccount) {
      await User.findByIdAndUpdate(user._id, { $set: { activeBusinessId: business._id } });
      user.activeBusinessId = business._id;
    }
  } else {
    user = await User.create({
      // NOT input.businessData.name — that's the BUSINESS's name (e.g.
      // "Desun Academy - Top IT Training Institute in Kolkata"), not the
      // person's. It was leaking into every "who's logged in" display
      // (DashboardHeader's name + initials avatar) and into WhatsApp sales
      // messages that address the lead by "first name" (composeFirstMessage
      // → firstName(owner?.fullName)) until PATCH /api/user/profile
      // overwrites this with their real name (e.g. typed at checkout).
      fullName: 'New User',
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

  // Captured before the create-if-missing block below, which always leaves
  // `business` truthy — this is the "did we actually reuse one" signal.
  const reused = !!business;

  if (!business) {
    business = await Business.create({
      name: input.businessData.name,
      // Falls back to 'Local Business' only when BOTH the Places API v1
      // primaryTypeDisplayName lookup AND the legacy types[]-derived guess
      // failed to produce anything — see deriveCategory()/getDetails() in
      // src/services/google/places.ts for the actual resolution order.
      category: input.businessData.category || 'Local Business',
      // Google's own editorial summary is the closest live substitute for a
      // description the free-report form never asks the visitor to type —
      // absent on most listings, but real when present (see ShadowBusinessData).
      description: input.businessData.editorialSummary || undefined,
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
      placesRating: input.businessData.placesRating,
      placesReviewCount: input.businessData.placesReviewCount,
      photoCount: input.businessData.photoCount,
      hasHours: input.businessData.hasHours,
      googleTypes: input.businessData.googleTypes,
      organizationId: organization._id,
      userId: user._id,
      provisionedVia: input.source,
      onboardingCompleted: false,
    });

    // Same rule as the reuse branch above: an established account gets this
    // new business linked (businessIds) so it's reachable from the workspace
    // switcher, but doesn't get silently switched onto it as the active one.
    await User.findByIdAndUpdate(user._id, {
      $set: {
        organizationId: organization._id,
        ...(isEstablishedAccount ? {} : { activeBusinessId: business._id }),
      },
      $addToSet: { businessIds: business._id },
    });
    user.organizationId = organization._id;
    if (!isEstablishedAccount) user.activeBusinessId = business._id;

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
  // Cookie must agree with whatever we decided user.activeBusinessId is
  // above — an established account keeps pointing at ITS existing active
  // workspace (falling back to the new `business` only in the unexpected
  // case it somehow has none yet), never at the just-resolved `business`.
  const cookieBusinessId =
    isEstablishedAccount && user.activeBusinessId ? user.activeBusinessId.toString() : business._id.toString();
  const cookieStore = await cookies();
  cookieStore.set('activeBusinessId', cookieBusinessId, {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  });

  return { user, organization, business, reused };
}
