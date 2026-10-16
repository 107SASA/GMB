/**
 * Review-reply auto-publish requires the OWNER's consent — the real
 * autoReplyToReview / reply pipeline against an in-memory MongoDB. The AI and
 * Google's reply endpoint are fakes; nothing reaches Groq or Google, and the
 * default Google path is disabled (GBP_LIVE_WRITES_ENABLED=false).
 *
 * Run: npm run test:workflow
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.GBP_LIVE_WRITES_ENABLED = 'false';
process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
process.env.QA_SUPPRESS_EMAIL_SENDS = 'true';
process.env.QA_SUPPRESS_PUSH_SENDS = 'true';
for (const k of Object.keys(process.env)) if (/^(GROQ|OPENAI|DO_SPACES|TWILIO|META_WHATSAPP|RESEND|SENDGRID)_/.test(k)) delete process.env[k];

const POS = 'Ramesh and his team did a neat job on our bathroom tiles. Finished on time and cleaned up after.';
const GOOD_REPLY = 'Thank you, Priya! We are glad the bathroom tiles came out neat and that Ramesh and the team finished on time and cleaned up. — The Sahyadri Tile Works Team';
const DAY = 86_400_000;

let memoryServer: any = null;
let skipReason: string | null = null;
let m: any = {};
let googleCalls = 0;
const deps = {
  generate: async () => ({ reply: GOOD_REPLY }),
  postToGoogle: async () => {
    googleCalls++;
    return { liveWriteApplied: true, googleResponse: '{"comment":"...","updateTime":"2026-10-16T10:00:00Z"}' };
  },
};

before(async () => {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
  } catch (err: any) {
    skipReason = `mongodb-memory-server unavailable (${err?.message})`;
    return;
  }
  process.env.MONGODB_URI = memoryServer.getUri(`gm_review_consent_${Date.now()}`);
  await (await import('../../src/lib/mongodb')).default();
  m = {
    mongoose: (await import('mongoose')).default,
    User: (await import('../../src/models/User')).default,
    Organization: (await import('../../src/models/Organization')).default,
    Business: (await import('../../src/models/Business')).default,
    Review: (await import('../../src/models/Review')).default,
    consent: await import('../../src/lib/reviewReplyConsent'),
    autoReply: await import('../../src/services/reviews/autoReply'),
  };
});

after(async () => {
  if (m.mongoose?.connection?.readyState === 1) {
    await m.mongoose.connection.dropDatabase();
    await m.mongoose.disconnect();
  }
  if (memoryServer) await memoryServer.stop();
});

let seq = 0;
async function mkBusiness(reviewReplySettings: Record<string, unknown>) {
  seq++;
  const user: any = await m.User.create({ fullName: `Owner ${seq}`, email: `consent${seq}@example.invalid`, phone: `+9197777${String(seq).padStart(5, '0')}`, role: 'CLIENT' });
  const org: any = await m.Organization.create({ name: `Org ${seq}`, ownerId: user._id, subscriptionPlan: 'Pro' });
  const b: any = await m.Business.create({
    name: 'Sahyadri Tile Works', category: 'Tile contractor', address: 'Gangapur Road, Nashik', area: 'Gangapur Road', city: 'Nashik', country: 'India',
    services: 'Tile installation, Bathroom renovation', organizationId: org._id, userId: user._id,
    subscriptionStatus: 'active', googleConnected: true, reviewReplySettings,
  } as any);
  return { businessId: String(b._id), ownerId: String(user._id) };
}

let rseq = 0;
const mkReview = (businessId: string, postedAt = new Date()) =>
  m.Review.create({ businessId, providerReviewId: `accounts/1/locations/2/reviews/c${++rseq}`, source: 'gbp_api', reviewer: 'Priya Kulkarni', rating: 5, reviewText: POS, sentiment: 'positive', postedAt } as any);

const settingsOf = async (businessId: string) => ((await m.Business.findById(businessId).lean()) as any).reviewReplySettings;

/** The settings route's write, through the same builder the route uses. */
async function ownerSaves(businessId: string, ownerId: string, mode: 'manual' | 'auto') {
  const wasAuto = m.consent.isAutoPublishActive(await settingsOf(businessId));
  await m.Business.updateOne({ _id: businessId }, m.consent.replyModeUpdate({ mode, wasAuto, ownerUserId: ownerId }));
}

test('newly created business: manual, no consent; a new review becomes a DRAFT and nothing goes to Google', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId } = await mkBusiness(m.consent.newBusinessReviewReplySettings());
  const s = await settingsOf(businessId);
  assert.equal(s.mode, 'manual');
  assert.equal(s.autoPublishConsentAt, undefined);
  assert.equal(s.autoPublishConsentBy, undefined);

  googleCalls = 0;
  const r = await mkReview(businessId);
  const out = await m.autoReply.autoReplyToReview(businessId, r, deps);
  const doc: any = await m.Review.findById(r._id).lean();
  assert.deepEqual(out, { drafted: 'DRAFT', published: null });
  assert.equal(doc.replyStatus, 'DRAFT');
  assert.ok(!doc.response, 'nothing posted');
  assert.equal(googleCalls, 0);
});

test('existing synthetic-consent settings: drafts only — including an old unanswered review', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId } = await mkBusiness({ mode: 'auto', tone: 'Professional', autoPublishConsentAt: new Date('2026-10-05'), autoPublishConsentBy: m.consent.DEFAULT_AUTO_REPLY_CONSENT_BY });
  assert.equal(m.consent.isAutoPublishActive(await settingsOf(businessId)), false);

  googleCalls = 0;
  const fresh = await mkReview(businessId);
  const old = await mkReview(businessId, new Date(Date.now() - 730 * DAY));
  for (const r of [fresh, old]) {
    const out = await m.autoReply.autoReplyToReview(businessId, r, deps);
    assert.equal(out.published, null);
    const doc: any = await m.Review.findById(r._id).lean();
    assert.equal(doc.replyStatus, 'DRAFT', 'the draft is kept for the owner');
    assert.ok(!doc.response);
  }
  assert.equal(googleCalls, 0, 'synthetic consent never reaches Google');
  // Settings and reviews are left as they were — nothing deleted.
  assert.equal((await settingsOf(businessId)).autoPublishConsentBy, m.consent.DEFAULT_AUTO_REPLY_CONSENT_BY);
  assert.equal(await m.Review.countDocuments({ businessId }), 2);
});

test('explicit owner opt-in (replacing synthetic consent) records the owner and publishes fact-checked replies', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, ownerId } = await mkBusiness({ mode: 'auto', tone: 'Professional', autoPublishConsentAt: new Date('2026-10-05'), autoPublishConsentBy: m.consent.DEFAULT_AUTO_REPLY_CONSENT_BY });
  await ownerSaves(businessId, ownerId, 'auto');
  const s = await settingsOf(businessId);
  assert.equal(s.mode, 'auto');
  assert.equal(s.autoPublishConsentBy, ownerId, 'consent belongs to the owner, not the default');
  assert.ok(s.autoPublishConsentAt > new Date('2026-10-05'), 'consent time is the opt-in, not the creation default');
  assert.equal(m.consent.isAutoPublishActive(s), true);

  googleCalls = 0;
  const r = await mkReview(businessId);
  const out = await m.autoReply.autoReplyToReview(businessId, r, deps);
  assert.deepEqual(out, { drafted: 'DRAFT', published: 'published' });
  assert.equal(googleCalls, 1);
});

test('owner switching back to manual clears consent: drafts only again, existing drafts kept', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { businessId, ownerId } = await mkBusiness(m.consent.newBusinessReviewReplySettings());
  await ownerSaves(businessId, ownerId, 'auto');
  await ownerSaves(businessId, ownerId, 'manual');
  const s = await settingsOf(businessId);
  assert.equal(s.mode, 'manual');
  assert.equal(s.autoPublishConsentAt, undefined);
  assert.equal(s.autoPublishConsentBy, undefined);

  googleCalls = 0;
  const r = await mkReview(businessId);
  const out = await m.autoReply.autoReplyToReview(businessId, r, deps);
  assert.equal(out.published, null);
  assert.equal(googleCalls, 0);
  assert.equal(((await m.Review.findById(r._id).lean()) as any).replyStatus, 'DRAFT');
});
