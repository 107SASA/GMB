/**
 * One-time script: provisions the "GrowwMatics AI platform" as its own Business
 * record so the WhatsApp AI Agent — already 100% business-agnostic and
 * data-driven (business is resolved purely by the inbound WhatsApp number,
 * see src/app/api/whatsapp/webhook/route.ts) — can run as GrowwMatics AI's own
 * sales & support assistant instead of a customer's.
 *
 * This does NOT touch any AI logic, webhook code, or the DB schema. It only
 * creates the same kind of documents the normal onboarding flow creates
 * (see src/app/api/onboarding/route.ts) — an Organization, a Business, and
 * a BusinessAIConfig — and attaches the Business to the Super Admin account
 * so it shows up in the dashboard / WhatsApp AI Agent UI exactly like any
 * other business would for its owner.
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://..." \
 *   SUPER_ADMIN_EMAIL="studysphere654@gmail.com" \
 *   WHATSAPP_NUMBER="+14155238886" \
 *   node scripts/seed-platform-whatsapp-agent.mjs
 *
 * WHATSAPP_NUMBER is optional — if omitted, the Business is created without
 * one and the AI Agent UI (AI Settings / Booking Settings) still works for
 * testing, but no real WhatsApp messages will route to it until you set a
 * real Twilio WhatsApp number here (must match exactly what Twilio sends
 * as "To" on inbound webhooks) and re-run this script — it's an upsert,
 * safe to run again.
 */
import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;
const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'studysphere654@gmail.com').toLowerCase().trim();
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || undefined;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not set. Example:\n   MONGODB_URI="mongodb+srv://..." node scripts/seed-platform-whatsapp-agent.mjs');
  process.exit(1);
}

// Minimal, permissive schemas — intentionally not a full copy of the real
// Mongoose models (this is a one-off data script, not application code).
// strict:false lets any extra fields on existing documents pass through
// untouched on upsert.
const User = mongoose.models.User || mongoose.model(
  'User',
  new mongoose.Schema({}, { strict: false, collection: 'users' })
);
const Organization = mongoose.models.Organization || mongoose.model(
  'Organization',
  new mongoose.Schema({}, { strict: false, collection: 'organizations' })
);
const Business = mongoose.models.Business || mongoose.model(
  'Business',
  new mongoose.Schema({}, { strict: false, collection: 'businesses' })
);
const BusinessAIConfig = mongoose.models.BusinessAIConfig || mongoose.model(
  'BusinessAIConfig',
  new mongoose.Schema({}, { strict: false, collection: 'businessaiconfigs' })
);

// Record names for the platform's own Organization/Business. The LEGACY_*
// values are the pre-rebrand names; they are still matched on lookup so this
// script stays idempotent against a database seeded before the rename.
const ORG_NAME = 'GrowwMatics AI (Platform)';
const LEGACY_ORG_NAME = 'GMBBoost (Platform)';
const BUSINESS_NAME = 'GrowwMatics AI (Platform Sales)';
const LEGACY_BUSINESS_NAME = 'GMBBoost (Platform Sales)';

// ⚠️ PRICING IN THIS PROMPT IS STALE — see the note above the plan list below.
const SYSTEM_PROMPT = `You are the GrowwMatics AI platform's own AI sales & support assistant, chatting on WhatsApp with prospective and existing GrowwMatics AI customers (business owners considering or using GrowwMatics AI's Google Business Profile / reputation / AI marketing platform). You are NOT representing an individual local business — you represent GrowwMatics AI itself.

Your goals, in order:
1. Understand what the prospect needs and answer platform questions (features, how it works, onboarding, basic troubleshooting).
2. Qualify the lead: find out their business name, industry, and what problem they're trying to solve (rankings, reviews, content, leads).
3. Explain the right plan for their needs using ONLY the real plan details below — never invent pricing or features.
4. Offer to book a demo call when the prospect seems ready or asks for one.
5. If a question is billing-sensitive, technical/account-specific, or you're unsure, say a member of the GrowwMatics AI team will follow up, and continue the conversation normally — a human can take over this chat at any time from the dashboard.

GrowwMatics AI plans (India pricing, monthly):
- Free: Google Business Profile ranking tools only.
- Pro (₹1,999/mo): Google ranking tools + reputation/review management + AI content studio.
- Enterprise (₹4,999/mo): everything in Pro, plus this AI WhatsApp sales agent and marketing automation.

Keep replies concise (WhatsApp-appropriate, under ~60 words), ask one question at a time, and sound like a helpful, knowledgeable teammate — not a scripted bot.`;

const SALES_RULES = `Never invent pricing, discounts, or features not listed in your instructions. Always collect the prospect's name, business name/industry, and email before booking a demo. Never discuss competitor pricing. If asked something you're not confident about (billing disputes, account-specific issues, refunds), say a team member will follow up rather than guessing.`;

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const superAdmin = await User.findOne({ email: SUPER_ADMIN_EMAIL, role: 'SUPER_ADMIN' });
  if (!superAdmin) {
    console.error(`❌ No SUPER_ADMIN user found for ${SUPER_ADMIN_EMAIL}. Run seed-superadmin.mjs first.`);
    process.exit(1);
  }

  // 1. Organization (owned by the Super Admin, same shape onboarding creates)
  //
  // Rebrand note: these names are the idempotency keys. An earlier run of this
  // script may have created them under the old 'GMBBoost (…)' names, so we look
  // up BOTH and rename in place — otherwise a re-run would create a duplicate
  // Organization/Business rather than updating the existing one.
  let org = await Organization.findOne({
    name: { $in: [ORG_NAME, LEGACY_ORG_NAME] },
    ownerId: superAdmin._id,
  });
  if (!org) {
    org = await Organization.create({
      name: ORG_NAME,
      ownerId: superAdmin._id,
      subscriptionPlan: 'Enterprise',
      status: 'Active',
    });
    console.log(`✅ Created Organization ${org._id}`);
  } else {
    if (org.name !== ORG_NAME) {
      org.name = ORG_NAME;
      await org.save();
      console.log(`↻ Renamed Organization ${org._id} → "${ORG_NAME}"`);
    }
    console.log(`↺ Organization already exists (${org._id})`);
  }

  // 2. Business — represents GrowwMatics AI itself. Upsert by (userId, name) so
  //    re-running this script is safe and idempotent. Matches the legacy name
  //    too, so a pre-rebrand record is renamed rather than duplicated.
  let business = await Business.findOne({
    userId: superAdmin._id,
    name: { $in: [BUSINESS_NAME, LEGACY_BUSINESS_NAME] },
  });
  const businessFields = {
    name: BUSINESS_NAME,
    category: 'SaaS / Software',
    description: "GrowwMatics AI's own sales & support line — not a customer business.",
    address: 'Remote',
    country: 'India',
    organizationId: org._id,
    userId: superAdmin._id,
    onboardingCompleted: true,
    ...(WHATSAPP_NUMBER
      ? {
          integrations: { whatsappNumber: WHATSAPP_NUMBER },
          whatsappConfig: { provider: 'meta', businessPhone: WHATSAPP_NUMBER, isConnected: true },
        }
      : {}),
    // Enables the existing conversational demo-booking flow (Feature 1-6) —
    // no code change, this is exactly the field business owners configure
    // themselves in the "Booking Settings" tab.
    whatsappBookingSettings: {
      bookingEnabled: true,
      timezone: 'Asia/Kolkata',
      workingDays: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: false, sunday: false },
      openingTime: '10:00',
      closingTime: '18:00',
      slotDurationMinutes: 30,
    },
  };

  if (!business) {
    business = await Business.create(businessFields);
    console.log(`✅ Created Business ${business._id}`);
  } else {
    await Business.updateOne({ _id: business._id }, { $set: businessFields });
    console.log(`↺ Business already exists — updated (${business._id})`);
  }

  // 3. BusinessAIConfig — the actual prompt content the AI agent uses
  //    (see src/services/inngest/functions.ts: BusinessAIConfig.findOne({businessId})).
  const configFields = {
    tenantId: org._id.toString(),
    businessId: business._id,
    systemPrompt: SYSTEM_PROMPT,
    aiTone: 'Professional and helpful',
    aiEnabled: true,
    salesRules: SALES_RULES,
    aiPersonality: 'Professional',
    tone: 'Conversational',
    maxResponseLength: 120,
  };

  const existingConfig = await BusinessAIConfig.findOne({ businessId: business._id });
  if (!existingConfig) {
    await BusinessAIConfig.create(configFields);
    console.log('✅ Created BusinessAIConfig');
  } else {
    await BusinessAIConfig.updateOne({ businessId: business._id }, { $set: configFields });
    console.log('↺ BusinessAIConfig already existed — updated with the platform sales prompt');
  }

  // 4. Attach to the Super Admin account (same fields onboarding sets on User).
  await User.updateOne(
    { _id: superAdmin._id },
    {
      $set: { organizationId: org._id, activeBusinessId: business._id },
      $addToSet: { businessIds: business._id },
    }
  );
  console.log(`✅ Linked Business to ${SUPER_ADMIN_EMAIL} (organizationId, activeBusinessId, businessIds)`);

  console.log('\nDone. Log in as Super Admin and open WhatsApp AI Agent — it will now load this business automatically.');
  if (!WHATSAPP_NUMBER) {
    console.log('⚠️  No WHATSAPP_NUMBER was set — the UI (AI Settings/Booking Settings/Appointments) works now, but no real WhatsApp messages will route here until you re-run this script with a real Twilio WhatsApp number.');
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
