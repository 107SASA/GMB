/**
 * LIVE verification of GBP Intelligence (FR-3.2 → FR-3.6) for ONE dedicated
 * TEST workspace that has already been connected to Google through the real
 * UI (/dashboard/gbp-profile). Calls the real Google APIs and the real code
 * paths; never prints tokens, keys or response values (key shapes and counts
 * only).
 *
 *   npx tsx scripts/gbp-live-verify.ts --business <testBusinessId> --confirm-test-business [--shapes] [--sync] [--reviews] [--no-places]
 *
 *   --shapes   one raw read of each Google endpoint → printed KEY SHAPES, plus
 *              which normalized FR-3.2 fields came out non-empty (validates
 *              the live response shapes against the normalizers)
 *   --sync     runs syncCompleteGbpIntelligence twice (manual, then
 *              scheduled) → call counts, section statuses, health, changes,
 *              snapshot identity; the second run must reuse media/posts/Places
 *              and create no new change records
 *   --reviews  runs the real review sync twice → mode, counts, duplicates,
 *              alert events (captured, not sent)
 *   (no mode flag = --shapes --sync)
 *
 * Safety: Google WRITES stay off (GBP_LIVE_WRITES_ENABLED=false), DO Spaces
 * credentials are removed, WhatsApp sends and Inngest events are intercepted
 * (captured, never sent), and the script refuses to run without
 * --confirm-test-business. It writes only to the test business's own
 * GbpLocationSnapshot / Review / GBPToken / Notification documents.
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const businessId = opt('--business');
if (!businessId || !flag('--confirm-test-business')) {
  console.error('Usage: npx tsx scripts/gbp-live-verify.ts --business <testBusinessId> --confirm-test-business [--shapes] [--sync] [--reviews] [--no-places]');
  console.error('Only run this against a dedicated TEST workspace, never a customer business.');
  process.exit(2);
}
const anyMode = flag('--shapes') || flag('--sync') || flag('--reviews');
const MODES = { shapes: flag('--shapes') || !anyMode, sync: flag('--sync') || !anyMode, reviews: flag('--reviews') };

for (const file of ['.env.local', '.env']) {
  const p = path.resolve(file);
  if (!fs.existsSync(p)) continue;
  for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (!/^["']/.test(v)) v = v.replace(/\s+#.*$/, '');
    v = v.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
process.env.GBP_LIVE_WRITES_ENABLED = 'false';
process.env.QA_SUPPRESS_WHATSAPP_SENDS = 'true';
for (const k of Object.keys(process.env)) if (k.startsWith('DO_SPACES_')) delete process.env[k];
if (flag('--no-places')) delete process.env.GOOGLE_MAPS_API_KEY;

// Intercept outbound side effects (match the resolved `.ts` path too — tsx
// passes it for lazy imports).
const intercepted = new Set<string>();
const capturedEvents: Array<{ name: string }> = [];
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request: string, ...rest: any[]) {
  if (/services[\\/]whatsapp[\\/]send(\.ts)?$/.test(request)) {
    intercepted.add('whatsapp');
    return { __esModule: true, sendOutboundMessage: async () => ({ success: true, sid: 'captured' }), sendOtpMessage: async () => ({ success: true }) };
  }
  if (/services[\\/]inngest[\\/]client(\.ts)?$/.test(request)) {
    intercepted.add('inngest');
    const inngest = { send: async (e: any) => { for (const x of Array.isArray(e) ? e : [e]) capturedEvents.push({ name: x?.name }); return { ids: [] }; } };
    return { __esModule: true, inngest, default: inngest };
  }
  return origLoad.call(this, request, ...rest);
};

/** Key/type tree of a JSON value; strings are never printed except enum-like fields. */
const ENUM_KEYS = new Set(['diffMask', 'pendingMask', 'status', 'state', 'topicType', 'valueType', 'mediaFormat', 'recommendationReason', 'businessType', 'openDay', 'closeDay', 'actionType']);
function shape(v: any, key = '', depth = 0): any {
  if (v == null) return v === null ? 'null' : 'undefined';
  if (Array.isArray(v)) return v.length ? [`len=${v.length}`, shape(v[0], key, depth + 1)] : ['len=0'];
  if (typeof v === 'object') {
    if (depth > 5) return '{…}';
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, k, depth + 1)]));
  }
  if (typeof v === 'string') return ENUM_KEYS.has(key) ? `"${v.slice(0, 80)}"` : `string(${v.length})`;
  return typeof v === 'boolean' ? v : typeof v;
}
const show = (label: string, v: unknown) => console.log(`\n── ${label}\n${JSON.stringify(v, null, 2)}`);

async function main() {
  const dbConnect = (await import('../src/lib/mongodb')).default;
  await dbConnect();
  const { default: Business } = await import('../src/models/Business');
  const { default: GBPToken } = await import('../src/models/GBPToken');
  const { default: Review } = await import('../src/models/Review');
  const { default: Post } = await import('../src/models/Post');
  const { default: GbpMediaAsset } = await import('../src/models/GbpMediaAsset');
  const { default: Audit } = await import('../src/models/Audit');
  const { default: SeoPlan } = await import('../src/models/SeoPlan');
  const { default: GbpLocationSnapshot } = await import('../src/models/GbpLocationSnapshot');

  const business: any = await Business.findById(businessId).select('name organizationId googleConnected googleLocationId').lean();
  if (!business) throw new Error(`Business ${businessId} not found`);
  const token: any = await GBPToken.findOne({ businessId }).lean();

  const counts = async () => ({
    reviews: await Review.countDocuments({ businessId }),
    posts: await Post.countDocuments({ businessId }),
    media: await GbpMediaAsset.countDocuments({ businessId }),
    audits: await Audit.countDocuments({ businessId }),
    seoPlanActiveVersion: ((await SeoPlan.findOne({ businessId, status: 'active' }).sort({ version: -1 }).select('version').lean()) as any)?.version ?? null,
    snapshots: await GbpLocationSnapshot.countDocuments({ businessId }),
  });
  const ENCRYPTED = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/;
  show('BASELINE', {
    businessId,
    name: business.name,
    organizationId: String(business.organizationId),
    googleConnected: business.googleConnected,
    googleLocationId: business.googleLocationId || null,
    gbpToken: token
      ? {
          accountId: token.accountId,
          locationId: token.locationId,
          scopes: token.scopes,
          expiresAt: token.expiresAt,
          accessTokenEncrypted: ENCRYPTED.test(String(token.accessToken || '')),
          refreshTokenEncrypted: ENCRYPTED.test(String(token.refreshToken || '')),
          authStatus: token.authStatus?.state ?? null,
          reviewSync: token.reviewSync ? { mode: token.reviewSync.mode, fetched: token.reviewSync.fetched, hitCap: token.reviewSync.hitCap, googleTotal: token.reviewSync.googleTotal } : null,
        }
      : null,
    counts: await counts(),
  });
  if (!token?.locationId) throw new Error('This business has no connected Google location — connect it through /dashboard/gbp-profile first.');

  if (MODES.shapes) {
    const { getValidToken, listLocationMedia } = await import('../src/lib/gbpClient');
    const { createGbpReadApi } = await import('../src/services/gbp/intelligence/googleApi');
    const { normalizeLocation, normalizeAttributes, normalizeVoiceOfMerchant } = await import('../src/services/gbp/intelligence/normalize');
    const api = createGbpReadApi(fetch as any);
    const accessToken = await getValidToken(businessId!);
    const attempt = async (label: string, fn: () => Promise<any>) => {
      try { const r = await fn(); console.log(`\n${label}: OK`); return r; } catch (e: any) { console.log(`\n${label}: FAILED ${e?.category || ''} ${e?.httpStatus || ''} ${String(e?.message || e).slice(0, 200)}`); return undefined; }
    };
    const loc = await attempt('locations.get', () => api.getLocation(accessToken, token.locationId));
    if (loc) {
      show('locations.get — live KEY SHAPE', shape(loc));
      const n = normalizeLocation(loc);
      show('FR-3.2 normalized field coverage (true = non-empty value from Google)', {
        name: !!n.title, address: !!n.address?.formatted, postalCode: !!n.address?.postalCode, phone: !!n.primaryPhone, website: !!n.websiteUri,
        regularHours: n.regularHours ? n.regularHours.length : 'not set', specialHours: n.specialHours.length,
        primaryCategory: !!n.primaryCategory, additionalCategories: n.additionalCategories.length, services: n.services.length,
        description: !!n.description, pin: !!n.latlng, resourceName: !!n.resourceName, placeId: !!n.metadata.placeId,
        hasGoogleUpdated: n.metadata.hasGoogleUpdated, hasVoiceOfMerchant: n.metadata.hasVoiceOfMerchant, duplicateLocation: !!n.metadata.duplicateLocation, openStatus: n.openInfo?.status ?? null,
      });
      if (n.metadata.hasGoogleUpdated) {
        const gu = await attempt('locations.getGoogleUpdated', () => api.getGoogleUpdated(accessToken, token.locationId));
        if (gu) show('getGoogleUpdated — live KEY SHAPE (diffMask / pendingMask values shown)', shape(gu));
      } else {
        console.log('\nlocations.getGoogleUpdated: not requested (metadata.hasGoogleUpdated = false) — LIVE SUGGESTED-EDIT TEST NOT OBSERVED');
      }
    }
    const attrs = await attempt('locations.getAttributes', () => api.getAttributes(accessToken, token.locationId));
    if (attrs) { show('attributes — live KEY SHAPE', shape(attrs)); console.log(`normalized attributes: ${normalizeAttributes(attrs).length}`); }
    const vom = await attempt('verifications.getVoiceOfMerchantState', () => api.getVoiceOfMerchantState(accessToken, token.locationId));
    if (vom) { show('VoiceOfMerchantState — live KEY SHAPE', shape(vom)); show('normalized verification state', normalizeVoiceOfMerchant(vom)); }
    const posts = await attempt('localPosts.list', () => api.listLocalPosts(accessToken, token.accountId, token.locationId));
    if (posts) { console.log(`posts: ${posts.posts.length}${posts.truncated ? '+ (page cap)' : ''}`); if (posts.posts[0]) show('localPost[0] — live KEY SHAPE', shape(posts.posts[0])); }
    const media = await attempt('media.list (listLocationMedia)', () => listLocationMedia(businessId!));
    if (media) console.log(`owner media items: ${media.length}; with mediaFormat: ${media.filter((m: any) => m.mediaFormat).length}; with createTime: ${media.filter((m: any) => m.createTime).length}`);
  }

  if (MODES.sync) {
    const { syncCompleteGbpIntelligence } = await import('../src/services/gbp/intelligence/runner');
    const summarize = async (label: string, r: any) => {
      const docs: any[] = await GbpLocationSnapshot.find({ businessId }).lean();
      const s = docs[0];
      show(label, {
        result: { ok: r.ok, outcome: r.outcome, healthState: r.healthState, calls: r.calls, newChanges: r.newChanges, profileForBusinessReused: !!r.profileForBusiness },
        snapshotDocsForBusiness: docs.length,
        snapshot: s && {
          organizationMatches: String(s.organizationId) === String(business.organizationId),
          locationMatches: s.locationId === token.locationId,
          source: s.source,
          fetchedAt: s.fetchedAt,
          lastSuccessfulSyncAt: s.lastSuccessfulSyncAt,
          sections: Object.fromEntries(Object.entries(s.sections || {}).map(([k, v]: any) => [k, `${v.meta?.status}${v.meta?.error ? ` (${v.meta.error.category})` : ''}${v.data == null ? ' · no data' : ''}`])),
          health: { state: s.health?.state, issues: (s.health?.issues || []).map((i: any) => i.code) },
          externalChanges: (s.externalChanges || []).length,
        },
      });
    };
    await summarize('SYNC #1 (manual)', await syncCompleteGbpIntelligence(businessId!, { reason: 'manual' }));
    await summarize('SYNC #2 (scheduled, no Google-side changes) — expect only locations.get / attributes / VoM, newChanges = 0', await syncCompleteGbpIntelligence(businessId!, { reason: 'scheduled' }));
  }

  if (MODES.reviews) {
    const { syncReviewsForBusiness } = await import('../src/services/reviews/syncReviews');
    const tenantId = String(business.organizationId);
    for (const n of [1, 2]) {
      const before = await Review.countDocuments({ businessId });
      const r = await syncReviewsForBusiness(businessId!, tenantId);
      const t: any = await GBPToken.findOne({ businessId }).select('reviewSync').lean();
      const dupes = await Review.aggregate([
        { $match: { businessId: business._id, providerReviewId: { $type: 'string' } } },
        { $group: { _id: '$providerReviewId', n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $count: 'dupes' },
      ]);
      show(`REVIEW SYNC #${n}`, {
        fetched: r.synced,
        storedBefore: before,
        storedAfter: await Review.countDocuments({ businessId }),
        reviewSync: t?.reviewSync ? { mode: t.reviewSync.mode, fetched: t.reviewSync.fetched, hitCap: t.reviewSync.hitCap, googleTotal: t.reviewSync.googleTotal, conflicts: t.reviewSync.conflicts } : null,
        duplicateIdsWithinBusiness: dupes[0]?.dupes ?? 0,
        eventsCapturedSoFar: capturedEvents.map((e) => e.name),
      });
    }
  }

  show('AFTER', { counts: await counts(), intercepted: [...intercepted], capturedEvents: capturedEvents.map((e) => e.name) });
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('FAILED:', String(err?.message || err).replace(/ya29\.[\w.-]+|1\/\/[\w.-]+/g, '[redacted]'));
  try { const mongoose = (await import('mongoose')).default; await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
