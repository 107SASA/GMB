import dbConnect from '@/lib/mongodb';
import { festivalsBetween } from '@/lib/festivalCalendar';
import { normalizeOrigin } from '@/services/intel/websiteExtract';
import { planWeeklySlots, contentWeekKey, type ContentFacts, type ContentSeoPlan, type PlannedSlot, type WeekOffer } from './plan';
import { validatePost, type PostEvidence } from './validatePost';
import { resolveBrand, templatePost } from './creative';
import { fetchLogo, imageForSlot, logoColors } from './images';

/**
 * One weekly content batch for a business: SEO plan → 4 planned slots →
 * AI copy under fact rules → evidence gate (1 regeneration) → image
 * (customer photo / generated with the customer's logo / branded graphic) →
 * Post rows with full traceability. Reads only stored data (SEO plan,
 * WebsiteIntelligence, brand, photos, offer, festival calendar) — no crawl,
 * no ranking or search-volume call. Idempotent per (business, batchKey, slot).
 */

export interface BatchDeps {
  generate?: (req: any) => Promise<{ posts: Array<{ title: string; body: string; cta?: string; hashtags?: string[]; postType?: string; thumbnailPrompt?: string }> }>;
  regenerate?: (input: any) => Promise<{ title: string; body: string; cta: string; hashtags: string[]; thumbnailPrompt: string } | null>;
  generateImage?: (prompt: string) => Promise<string | null>;
}

export interface BatchResult {
  batchKey: string;
  created: Array<{ postId: string; slot: number; status: string; scheduledDate: string }>;
  skippedSlots: number[];
  contextNotes: string[];
}

const splitList = (s?: string) => String(s || '').split(/[,;\n]+/).map((x) => x.trim()).filter((x) => x.length >= 3);

export async function loadContentContext(business: any) {
  await dbConnect();
  const [{ getActiveSeoPlan }, { default: WebsiteIntelligence }, { default: GbpMediaAsset }] = await Promise.all([
    import('@/services/seoPlan/seoPlanService'),
    import('@/models/WebsiteIntelligence'),
    import('@/models/GbpMediaAsset'),
  ]);
  const notes: string[] = [];
  const seo: any = await getActiveSeoPlan(String(business._id)).catch(() => null);
  const origin = normalizeOrigin(String(business.website || ''));
  // Stored research only — the weekly job never crawls.
  const wi: any = origin ? await WebsiteIntelligence.findOne({ origin }).lean() : null;
  if (!business.website) notes.push('No website — content uses verified business and Google profile facts only.');
  else if (!wi) notes.push('Website not researched yet — website facts not used this week.');
  else if (wi.status === 'failed') notes.push('Website could not be read — website facts not used.');

  const websiteOk = wi && wi.status !== 'failed';
  const rows: any[] = seo?.keywordTable || [];
  const plan: ContentSeoPlan = {
    seoPlanId: seo?._id ? String(seo._id) : null,
    themes: seo?.postThemes || [],
    // Measured = the audit actually ran this phrase on Google Maps; brand-name phrases are not content targets.
    measuredKeywords: rows.filter((r) => (r.rankStatus ?? 'ok') === 'ok' && !(business.name && String(r.keyword).toLowerCase().includes(String(business.name).toLowerCase().split(' ')[0]))).map((r) => r.keyword),
    proposedKeywords: (seo?.draft?.proposedKeywords || []).map((p: any) => p.keyword),
  };
  if (!seo) notes.push('No SEO plan yet — posts follow verified services / category only.');

  const facts: ContentFacts = {
    businessName: business.name,
    category: business.userDefinedCategory || business.category || '',
    city: business.city || '',
    area: business.area || '',
    phone: business.phone || '',
    website: business.website || '',
    ownerServices: splitList(business.services),
    websiteServices: websiteOk ? (wi.services || []).slice(0, 12) : [],
    ownerDescription: business.description || business.intake?.uniqueSellingPoints || '',
    websiteDescription: websiteOk ? wi.description ?? null : null,
  };

  // Customer assets from the Photos section (uploaded or already on Google).
  const assets: any[] = await GbpMediaAsset.find({ businessId: business._id, status: { $in: ['published', 'staged'] }, url: { $regex: '^https://' } })
    .sort({ createdAt: -1 }).select('category url mediaType geotag').limit(40).lean();
  const logoAsset = assets.find((a) => a.category === 'LOGO');
  const customerPhotos = assets.filter((a) => (a.category === 'ADDITIONAL' || a.category === 'COVER') && a.mediaType !== 'video').map((a) => ({ id: String(a._id), url: a.url, geotag: a.geotag }));
  // The only coordinates ever written into image GPS metadata (lib/verifiedLocation.ts).
  const { getVerifiedBusinessLocation } = await import('@/lib/verifiedLocation');
  const location = await getVerifiedBusinessLocation(String(business._id));
  const websiteLogo = websiteOk ? wi.brand?.logoUrl : undefined;
  const logoUrl = logoAsset?.url || business.brandProfile?.logoUrl || websiteLogo || null;
  const logoSource = logoAsset?.url ? 'customer_upload' : business.brandProfile?.logoSource || (websiteLogo ? 'website' : null);
  const customerLogo = await fetchLogo(logoUrl).catch(() => null);
  const brand = resolveBrand({
    manualColors: business.brandProfile?.manualColors,
    logoColors: await logoColors(customerLogo),
    websiteColors: websiteOk ? wi.brand?.cssColors : null,
    themeColors: websiteOk && wi.brand?.themeColor ? [wi.brand.themeColor] : null,
    logoUrl,
    logoSource: logoSource as any,
    sourceUrl: websiteOk ? wi.brand?.sourceUrl : null,
  });
  const websiteImages = websiteOk ? [wi.brand?.ogImage, ...(wi.brand?.images || [])].filter((u: any) => typeof u === 'string' && u.startsWith('https://')).map((u: string) => ({ url: u, sourceUrl: wi.brand?.sourceUrl })) : [];
  return { seo, wi: websiteOk ? wi : null, plan, facts, brand, customerLogo, customerPhotos, websiteImages, location, notes };
}

function factsBlockOf(f: ContentFacts, slotEvidence: PlannedSlot['evidence']): string {
  const lines = [
    `Business: ${f.businessName}`,
    f.category && `Google category: ${f.category}`,
    f.city && `Location: ${[f.area, f.city].filter(Boolean).join(', ')}`,
    f.ownerServices.length && `Services (owner-confirmed): ${f.ownerServices.join(', ')}`,
    f.websiteServices.length && `Services the website states: ${f.websiteServices.map((s) => s.value).join(', ')}`,
    f.ownerDescription && `Owner description: ${f.ownerDescription}`,
    f.websiteDescription?.value && `Website says: ${f.websiteDescription.value}`,
    ...slotEvidence.filter((e) => e.state === 'OWNER_CONFIRMED' || e.state === 'CALENDAR').map((e) => e.label),
  ].filter(Boolean);
  return lines.join('\n');
}

function briefOf(s: PlannedSlot, f: ContentFacts): string {
  const kw = s.keyword ? ` Primary keyword: "${s.keyword}".` : '';
  switch (s.purpose) {
    case 'seo_theme': return `SEO theme — ${s.seoTheme}.${s.service ? ` Service: ${s.service}.` : ''}${kw}`;
    case 'service': return `Explain the service "${s.service}" and who it helps — general, factual, no results claims.${kw}`;
    case 'local': return `Local relevance: ${f.businessName} as a ${f.category || 'business'} in ${[f.area, f.city].filter(Boolean).join(', ')}${s.service ? `, mentioning ${s.service}` : ''}.${kw}`;
    case 'festival': return `A ${s.festival?.name} greeting from ${f.businessName}. No offer, discount or promotion.`;
    case 'offer': return `The owner's offer, exactly as given: "${s.offerText}"${s.festival ? ` (for ${s.festival.name})` : ''}. Do not add any condition, price, date or discount not in the offer.`;
    default: return `An educational post about ${f.category || 'this type of business'} — general advice, no claims about this business's results.`;
  }
}

type ContentContext = Awaited<ReturnType<typeof loadContentContext>>;
export interface SlotCopy {
  post: { title: string; body: string; cta: string; hashtags: string[] };
  status: 'scheduled' | 'draft';
  generatedVia: 'ai' | 'ai_regenerated' | 'template';
  check: { ok: boolean; reasons: string[] };
  attempts: number;
  draftReason?: string;
  /** Why the first AI draft was rejected when a regeneration then passed (audit trail). */
  firstRejection?: string[];
}

/**
 * Copy for the planned slots: one AI call for all slots under the fact
 * rules → evidence gate per post → one regeneration for a rejected post →
 * otherwise a safe template saved as DRAFT (also when AI is unavailable).
 */
export async function writeSlotCopy(ctx: ContentContext, slots: PlannedSlot[], business: any, deps: BatchDeps = {}): Promise<SlotCopy[]> {
  const evidenceText = [ctx.facts.businessName, ctx.facts.category, ctx.facts.city, ctx.facts.area, ...ctx.facts.ownerServices, ...ctx.facts.websiteServices.map((s) => s.value), ctx.facts.ownerDescription, ctx.facts.websiteDescription?.value, ...(ctx.wi?.credentials || []).map((c: any) => c.value), ...(ctx.wi?.differentiators || []).map((c: any) => c.value)].filter(Boolean).join(' | ');
  const baseEvidence = (s: PlannedSlot): PostEvidence => ({
    businessName: ctx.facts.businessName,
    evidenceText,
    serviceTerms: [ctx.facts.category, ...ctx.facts.ownerServices, ...ctx.facts.websiteServices.map((x) => x.value), ...ctx.plan.measuredKeywords, s.keyword || ''].filter(Boolean),
    places: [ctx.facts.city, ctx.facts.area || ''].filter(Boolean),
    businessNames: [],
    offerText: s.purpose === 'offer' ? s.offerText : null,
    festivalName: s.festival ? s.festival.name : null,
    phone: ctx.facts.phone,
    website: ctx.facts.website,
  });

  const generate = deps.generate ?? (async (req: any) => (await import('@/services/ai/contentEngine')).generateAIContent(req));
  const regenerate = deps.regenerate ?? (async (i: any) => (await import('@/services/ai/contentEngine')).regenerateSinglePost(i));
  const briefs = slots.map((s) => briefOf(s, ctx.facts));
  const allFacts = factsBlockOf(ctx.facts, slots.flatMap((s) => s.evidence));
  let aiPosts: any[] = [];
  let aiError: string | null = null;
  try {
    const res = await generate({
      businessName: ctx.facts.businessName, businessType: ctx.facts.category || 'Local business',
      location: [ctx.facts.area, ctx.facts.city].filter(Boolean).join(', '), tone: business.tone || 'Professional',
      keywords: slots.map((s) => s.keyword).filter(Boolean), contentTypes: ['GMB Posts'], slotBriefs: briefs, factsBlock: allFacts,
    });
    aiPosts = Array.isArray(res?.posts) ? res.posts : [];
  } catch (err: any) {
    aiError = String(err?.message || err).slice(0, 160);
  }

  const out: SlotCopy[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const ev = baseEvidence(s);
    let post: { title: string; body: string; cta: string; hashtags: string[] } | null = aiPosts[i]
      ? { title: String(aiPosts[i].title || ''), body: String(aiPosts[i].body || ''), cta: String(aiPosts[i].cta || 'Learn more'), hashtags: Array.isArray(aiPosts[i].hashtags) ? aiPosts[i].hashtags.map(String) : [] }
      : null;
    let generatedVia: 'ai' | 'ai_regenerated' | 'template' = 'ai';
    let attempts = post ? 1 : 0;
    let check = post ? validatePost(post, ev) : { ok: false, reasons: [aiError ? `AI unavailable: ${aiError}` : 'AI returned no post for this slot'] };
    let firstRejection: string[] | undefined;
    if (post && !check.ok) {
      const again = await regenerate({ brief: briefs[i], factsBlock: factsBlockOf(ctx.facts, s.evidence), rejected: post, reasons: check.reasons, tone: business.tone });
      attempts++;
      if (again) {
        const recheck = validatePost(again, ev);
        if (recheck.ok) { firstRejection = check.reasons; post = again; check = recheck; generatedVia = 'ai_regenerated'; }
        else check = { ok: false, reasons: recheck.reasons };
      }
    }
    let status: 'scheduled' | 'draft' = 'scheduled';
    let draftReason: string | undefined;
    if (!post || !check.ok) {
      // Safe template from verified facts only — saved as DRAFT for the owner to review.
      const t = templatePost(s, ctx.facts);
      const tCheck = validatePost({ ...t, hashtags: [] }, ev);
      post = { ...t, hashtags: [] };
      generatedVia = 'template';
      status = 'draft';
      draftReason = !aiPosts.length ? 'AI content was unavailable — safe template saved for your review' : `Generated copy failed the fact check (${check.reasons.slice(0, 3).join('; ')}) — safe template saved for your review`;
      if (!tCheck.ok) draftReason += ` · template check: ${tCheck.reasons.join('; ')}`;
    }

    out.push({ post: post!, status, generatedVia, check, attempts, draftReason, firstRejection });
  }
  return out;
}

export async function generateWeeklyBatch(opts: {
  business: any;
  tenantId: string;
  firstDate: Date;
  daySpacing: number;
  /** '<ISO week>' for autopilot (idempotent); pass a unique key for an explicit extra batch. */
  batchKey?: string;
  generatedVia: 'cron' | 'manual';
  now?: Date;
  deps?: BatchDeps;
}): Promise<BatchResult> {
  await dbConnect();
  const { default: Post } = await import('@/models/Post');
  const { default: WeeklyOffer } = await import('@/models/WeeklyOffer');
  const business = opts.business;
  const batchKey = opts.batchKey || contentWeekKey(opts.firstDate);
  const existing: any[] = await Post.find({ businessId: business._id, batchKey }).select('contentMeta.slot').lean();
  const have = new Set(existing.map((p) => p.contentMeta?.slot));
  if (have.size >= 4) return { batchKey, created: [], skippedSlots: [1, 2, 3, 4], contextNotes: ['Batch already generated — nothing new created'] };

  const ctx = await loadContentContext(business);
  const offerDoc: any = await WeeklyOffer.findOne({ businessId: business._id, weekKey: contentWeekKey(opts.now || new Date()), status: 'YES' }).lean();
  const offer: WeekOffer | null = offerDoc?.text ? { text: offerDoc.text, festivalName: offerDoc.festivalName, imageId: offerDoc.imageId } : null;
  // A festival already greeted in an earlier batch is not repeated (batch windows overlap by a day).
  const greeted = new Set<string>(await Post.distinct('contentMeta.festivalKey', { businessId: business._id, batchKey: { $ne: batchKey } }));
  const festivals = festivalsBetween(opts.firstDate, 8).filter((f) => !greeted.has(f.key)).map((f) => ({ key: f.key, name: f.name, date: f.date }));
  // Weeks generated BEFORE this batch → the SEO-plan theme rotation position (stable on retry).
  const weekIndex = (await Post.distinct('batchKey', { businessId: business._id, batchKey: { $regex: /^\d{4}-W\d{2}$/, $lt: batchKey } })).length;
  const slots = planWeeklySlots({ facts: ctx.facts, plan: ctx.plan, weekIndex, offer, festivals }).filter((s) => !have.has(s.slot));

  // Persist the derived brand (manual colours untouched).
  const { default: Business } = await import('@/models/Business');
  await Business.updateOne({ _id: business._id }, { $set: {
    'brandProfile.colors': ctx.brand.colors, 'brandProfile.colorSource': ctx.brand.colorSource,
    ...(ctx.brand.logoUrl ? { 'brandProfile.logoUrl': ctx.brand.logoUrl, 'brandProfile.logoSource': ctx.brand.logoSource } : {}),
    ...(ctx.brand.sourceUrl ? { 'brandProfile.sourceUrl': ctx.brand.sourceUrl } : {}),
    'brandProfile.fetchedAt': new Date(),
  } }).catch(() => {});

  const deps = opts.deps || {};
  const copies = await writeSlotCopy(ctx, slots, business, deps);

  // Recently used customer photos (rotate, avoid repeats).
  const recent: any[] = await Post.find({ businessId: business._id, 'contentMeta.imageSource': 'customer_photo' }).sort({ createdAt: -1 }).limit(8).select('contentMeta.imageAssetId').lean();
  const recentlyUsed = recent.map((p) => p.contentMeta?.imageAssetId).filter(Boolean);

  const created: BatchResult['created'] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const { post, status, generatedVia, check, attempts, draftReason, firstRejection } = copies[i];
    const scheduledDate = new Date(opts.firstDate.getTime() + (s.slot - 1) * opts.daySpacing * 86_400_000);
    const image = await imageForSlot({
      businessId: String(business._id), slot: s, facts: ctx.facts, colors: ctx.brand.colors, customerLogo: ctx.customerLogo,
      customerPhotos: ctx.customerPhotos, location: ctx.location, recentlyUsedPhotoIds: recentlyUsed, websiteImages: ctx.websiteImages,
      offerImageId: offer?.imageId, headline: s.purpose === 'festival' ? `Happy ${s.festival?.name}` : s.purpose === 'offer' ? `This week at ${ctx.facts.businessName}` : s.service || ctx.facts.category || ctx.facts.businessName,
      generate: deps.generateImage,
    });
    if (image.imageAssetId) recentlyUsed.unshift(image.imageAssetId);

    try {
      const doc: any = await Post.create({
        tenantId: opts.tenantId,
        businessId: business._id,
        title: post.title,
        content: post.body,
        cta: post.cta,
        hashtags: post.hashtags,
        imageUrl: image.imageUrl,
        imageGeotag: image.geotag,
        postType: s.purpose,
        status,
        platform: 'gmb',
        aiGenerated: generatedVia !== 'template',
        scheduledDate,
        batchKey,
        automationMetadata: { generatedVia: opts.generatedVia },
        contentMeta: {
          slot: s.slot, purpose: s.purpose, seoPlanId: s.seoPlanId, seoThemeIndex: s.seoThemeIndex, seoTheme: s.seoTheme,
          service: s.service, keyword: s.keyword, keywordSource: s.keywordSource, keywordMeasured: s.keywordMeasured,
          festivalKey: s.festival?.key, festivalName: s.festival?.name, offerId: offerDoc && s.purpose === 'offer' ? String(offerDoc._id) : undefined,
          evidence: s.evidence, websiteIntelligenceId: ctx.wi?._id ? String(ctx.wi._id) : undefined,
          imageSource: image.imageSource, imageAssetId: image.imageAssetId, imageNote: image.note, generatedVia,
          validation: { ok: check.ok, reasons: check.reasons, attempts, ...(firstRejection ? { firstRejection } : {}) }, draftReason,
        },
      });
      created.push({ postId: String(doc._id), slot: s.slot, status, scheduledDate: scheduledDate.toISOString() });
      if (s.purpose === 'offer' && offerDoc) await WeeklyOffer.updateOne({ _id: offerDoc._id }, { $set: { postId: doc._id } });
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // slot already created by a concurrent/retried run
    }
  }
  return { batchKey, created, skippedSlots: [...have].filter(Boolean) as number[], contextNotes: ctx.notes };
}

/**
 * Owner answered YES to this week's offer question. Applies it once:
 *   - the week's slot-4 post not yet on Google is rewritten as the offer post;
 *   - if that slot is already published/past and no batch is due later this
 *     week, one extra offer post is created (batch 'offer-<week>');
 *   - if the week's batch has not been generated yet, nothing to do — the
 *     batch plans the offer into slot 4 itself.
 * Idempotent: WeeklyOffer.postId records where it went.
 */
export async function applyWeeklyOffer(opts: { businessId: string; weekKey: string; now?: Date; deps?: BatchDeps }): Promise<{ applied: 'updated' | 'created' | 'pending_batch' | 'already' | 'no_offer'; postId?: string }> {
  await dbConnect();
  const now = opts.now || new Date();
  const [{ default: Post }, { default: WeeklyOffer }, { default: Business }] = await Promise.all([
    import('@/models/Post'), import('@/models/WeeklyOffer'), import('@/models/Business'),
  ]);
  const offerDoc: any = await WeeklyOffer.findOne({ businessId: opts.businessId, weekKey: opts.weekKey, status: 'YES' }).lean();
  if (!offerDoc?.text) return { applied: 'no_offer' };
  if (offerDoc.postId) return { applied: 'already', postId: String(offerDoc.postId) };
  const business: any = await Business.findById(opts.businessId).lean();
  if (!business) return { applied: 'no_offer' };

  const batchPosts: any[] = await Post.find({ businessId: business._id, batchKey: opts.weekKey }).lean();
  if (!batchPosts.length) return { applied: 'pending_batch' };

  const ctx = await loadContentContext(business);
  const offer: WeekOffer = { text: offerDoc.text, festivalName: offerDoc.festivalName, imageId: offerDoc.imageId };
  const festivals = festivalsBetween(now, 8).map((f) => ({ key: f.key, name: f.name, date: f.date }));
  const slot = planWeeklySlots({ facts: ctx.facts, plan: ctx.plan, weekIndex: 0, offer, festivals }).find((x) => x.purpose === 'offer')!;
  const [copy] = await writeSlotCopy(ctx, [slot], business, opts.deps);
  const image = await imageForSlot({
    businessId: String(business._id), slot, facts: ctx.facts, colors: ctx.brand.colors, customerLogo: ctx.customerLogo,
    customerPhotos: ctx.customerPhotos, location: ctx.location, recentlyUsedPhotoIds: [], websiteImages: [], offerImageId: offer.imageId,
    headline: `This week at ${ctx.facts.businessName}`, generate: opts.deps?.generateImage,
  });
  const contentMeta = {
    slot: 4, purpose: 'offer', seoPlanId: slot.seoPlanId, service: slot.service, keyword: slot.keyword, keywordSource: slot.keywordSource, keywordMeasured: slot.keywordMeasured,
    festivalKey: slot.festival?.key, festivalName: slot.festival?.name, offerId: String(offerDoc._id), evidence: slot.evidence,
    imageSource: image.imageSource, imageAssetId: image.imageAssetId, imageNote: image.note, generatedVia: copy.generatedVia,
    validation: { ok: copy.check.ok, reasons: copy.check.reasons, attempts: copy.attempts }, draftReason: copy.draftReason,
  };

  const target = batchPosts.find((p) => p.contentMeta?.slot === 4 && ['scheduled', 'draft', 'approved'].includes(p.status) && p.scheduledDate && new Date(p.scheduledDate) > now);
  if (target) {
    // Replaces the slot-4 copy (and its image) — only while it has not gone to Google.
    const upd = await Post.findOneAndUpdate(
      { _id: target._id, status: { $in: ['scheduled', 'draft', 'approved'] } },
      { $set: { title: copy.post.title, content: copy.post.body, cta: copy.post.cta, hashtags: copy.post.hashtags, postType: 'offer', status: copy.status, ...(image.imageUrl ? { imageUrl: image.imageUrl, imageGeotag: image.geotag } : {}), contentMeta: { ...target.contentMeta, ...contentMeta } } },
      { returnDocument: 'after' },
    );
    if (upd) {
      await WeeklyOffer.updateOne({ _id: offerDoc._id }, { $set: { postId: upd._id } });
      return { applied: 'updated', postId: String(upd._id) };
    }
  }
  if (business.autopilotNextRunAt && new Date(business.autopilotNextRunAt) > now && contentWeekKey(new Date(business.autopilotNextRunAt)) === opts.weekKey) {
    return { applied: 'pending_batch' };
  }
  // Slot 4 already went out — one extra offer post, tomorrow ~10:00 India time.
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const ist = new Date(tomorrow.getTime() + 330 * 60_000);
  const scheduledDate = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 10, 0) - 330 * 60_000);
  try {
    const doc: any = await Post.create({
      tenantId: business.organizationId, businessId: business._id, title: copy.post.title, content: copy.post.body, cta: copy.post.cta,
      hashtags: copy.post.hashtags, imageUrl: image.imageUrl, imageGeotag: image.geotag, postType: 'offer', status: copy.status, platform: 'gmb',
      aiGenerated: copy.generatedVia !== 'template', scheduledDate, batchKey: `offer-${opts.weekKey}`,
      automationMetadata: { generatedVia: 'cron' }, contentMeta,
    });
    await WeeklyOffer.updateOne({ _id: offerDoc._id }, { $set: { postId: doc._id } });
    return { applied: 'created', postId: String(doc._id) };
  } catch (err: any) {
    if (err?.code !== 11000) throw err;
    return { applied: 'already' };
  }
}
