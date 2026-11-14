import dbConnect from '@/lib/mongodb';
import User from '@/models/User';
import Organization from '@/models/Organization';
import Business from '@/models/Business';
import { findAccountForPhone, provisionShadowAccount, type ShadowBusinessData } from '@/lib/shadowAccount';
import { listingFacts } from '@/lib/reportConnect';
import { markPhoneVerified } from '@/services/auth/phoneVerification';
import { getFreeSignupSettings } from '@/lib/freeSignupSettings';

/**
 * One registration for free accounts (docs/FREE_ACCOUNT_REGISTRATION_PLAN.md).
 * Called only AFTER the phone was proven with a WhatsApp code.
 *
 *  - number already has an established account (real, or a paid / trial
 *    workspace)  → nothing is created; the caller just logs them in
 *  - number has an old shadow account (earlier website free report)
 *                 → that account is taken over (its business + report kept)
 *  - new number   → user + organization + business, unpaid = Free CRM tier
 *
 * Every free account is a prospect in the super-admin CRM, and when a Google
 * listing was picked the free report starts in the background.
 */

export interface FreeSignupBusiness {
  name?: string;
  category?: string;
  city?: string;
  googlePlaceId?: string;
}

export interface FreeSignupInput {
  /** E.164, already OTP-verified by the caller. */
  phone: string;
  personName: string;
  business: FreeSignupBusiness;
  channel: 'app' | 'website';
}

export type FreeSignupOutcome = 'created' | 'claimed' | 'existing';

export interface FreeSignupResult {
  outcome: FreeSignupOutcome;
  user: any;
  business: any | null;
  /** Free report started (or reused) for the chosen listing. */
  auditId: string | null;
}

async function businessDataFor(b: FreeSignupBusiness): Promise<ShadowBusinessData> {
  const facts = b.googlePlaceId ? await listingFacts(b.googlePlaceId) : {};
  const name = (b.name || '').trim() || facts.name || 'My business';
  return {
    ...facts,
    name,
    category: (b.category || '').trim() || facts.category,
    city: (b.city || '').trim() || facts.city,
    ...(b.googlePlaceId ? { googlePlaceId: b.googlePlaceId } : {}),
  };
}

export async function registerFreeAccount(input: FreeSignupInput): Promise<FreeSignupResult> {
  await dbConnect();
  const existing = await findAccountForPhone(input.phone);
  if (existing.user && existing.established) {
    const business: any = existing.user.activeBusinessId ? await Business.findById(existing.user.activeBusinessId).lean() : null;
    // An unpaid account (Free CRM) signing up again is still a prospect —
    // make sure sales has a lead for it (the first source is kept).
    if (business) {
      const { freeCrmAllowed } = await import('@/lib/freeCrm');
      if (await freeCrmAllowed(String(existing.user._id), String(business._id)).catch(() => false)) {
        const { fileSignupPlatformLead } = await import('@/services/leads/platformProspectEntry');
        await fileSignupPlatformLead({
          name: existing.user.fullName || input.personName || business.name,
          phone: input.phone,
          businessName: business.name,
          channel: input.channel,
        }).catch((err) => console.error('[free-signup] CRM lead for existing free account failed:', (err as Error)?.message));
      }
    }
    return { outcome: 'existing', user: existing.user, business, auditId: null };
  }

  const businessData = await businessDataFor(input.business);
  const { user, organization, business } = await provisionShadowAccount({
    phone: input.phone,
    source: input.channel === 'app' ? 'app-signup' : 'website-signup',
    personName: input.personName,
    businessData,
    // The caller verified the number with a WhatsApp code.
    phoneVerified: true,
  });

  // A verified free account is a real account, not a shadow one any more —
  // from now on the website free report logs this number in.
  await User.updateOne({ _id: user._id }, { $set: { isShadowAccount: false, claimedAt: new Date(), activeBusinessId: business._id } });
  await markPhoneVerified(user._id, 'whatsapp_otp').catch(() => {});

  // Sales: a prospect in the super-admin CRM.
  let leadId: string | null = null;
  try {
    const { fileSignupPlatformLead } = await import('@/services/leads/platformProspectEntry');
    leadId = (await fileSignupPlatformLead({ name: input.personName, phone: input.phone, businessName: business.name, channel: input.channel })).leadId;
  } catch (err) {
    console.error('[free-signup] CRM lead failed (account still created):', (err as Error)?.message);
  }

  // Free Google profile report in the background when a listing was picked.
  let auditId: string | null = null;
  if (business.googlePlaceId && (await getFreeSignupSettings()).autoReport) {
    try {
      const { startOrReuseFreeReport } = await import('@/services/leads/freeReport');
      const org = organization ?? (await Organization.findById(user.organizationId));
      const started = await startOrReuseFreeReport(business, org, user);
      if (started.ok) {
        auditId = started.auditId;
        if (leadId) {
          const { linkPlatformLeadAudit } = await import('@/services/leads/platformProspectEntry');
          await linkPlatformLeadAudit(leadId, auditId).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[free-signup] free report failed to start (account still created):', (err as Error)?.message);
    }
  }

  return { outcome: existing.user ? 'claimed' : 'created', user, business, auditId };
}
