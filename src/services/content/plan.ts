/**
 * Weekly content plan — pure (runs under `node --test`).
 *
 * The existing SEO plan IS the content strategy: each week's POSTS_PER_WEEK
 * (4) slots are filled from its themes, verified services and keywords, plus
 * an owner-confirmed offer and the dated festival calendar when they exist.
 * Nothing is forced: no offer without the owner's words, no festival that
 * isn't in the calendar this week, no service that no source states.
 */

export type ContentPurpose = 'seo_theme' | 'service' | 'local' | 'education' | 'festival' | 'offer';

export interface ContentFacts {
  businessName: string;
  category: string;
  city: string;
  area?: string;
  phone?: string;
  website?: string;
  /** Services from verified sources: owner intake, live GBP, the SEO plan's verified list. */
  ownerServices: string[];
  /** Services the business's website states (SOURCE_CLAIM, with page URLs). */
  websiteServices: Array<{ value: string; sourceUrl?: string }>;
  /** Owner-provided USP / description (trusted), website description (claim). */
  ownerDescription?: string;
  websiteDescription?: { value: string; sourceUrl?: string } | null;
}

export interface SeoTheme { weekday: string; theme: string; keyword: string; postType: string }

export interface ContentSeoPlan {
  seoPlanId: string | null;
  themes: SeoTheme[];
  /** Keywords actually measured (keyword table rows with a real search). */
  measuredKeywords: string[];
  /** AI-proposed keywords (never measured). */
  proposedKeywords: string[];
}

export interface WeekOffer { text: string; festivalName?: string | null; startsAt?: string | null; endsAt?: string | null; imageId?: string | null }

export interface PlannedSlot {
  slot: 1 | 2 | 3 | 4;
  purpose: ContentPurpose;
  service?: string;
  keyword?: string;
  keywordSource?: 'measured' | 'proposed' | 'category';
  keywordMeasured: boolean;
  seoPlanId: string | null;
  seoThemeIndex?: number;
  seoTheme?: string;
  festival?: { key: string; name: string; date: string } | null;
  offerText?: string;
  /** Where every business fact this slot may use comes from. */
  evidence: Array<{ label: string; state: 'VERIFIED' | 'SOURCE_CLAIM' | 'OWNER_CONFIRMED' | 'CALENDAR'; sourceUrl?: string }>;
}

const norm = (s: string) => String(s || '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();

export function keywordInfo(keyword: string | undefined, plan: ContentSeoPlan): Pick<PlannedSlot, 'keyword' | 'keywordSource' | 'keywordMeasured'> {
  if (!keyword) return { keywordMeasured: false };
  const k = norm(keyword);
  if (plan.measuredKeywords.some((m) => norm(m) === k)) return { keyword, keywordSource: 'measured', keywordMeasured: true };
  if (plan.proposedKeywords.some((m) => norm(m) === k)) return { keyword, keywordSource: 'proposed', keywordMeasured: false };
  // A theme keyword that is neither measured nor listed as proposed is still NOT measured.
  return { keyword, keywordSource: 'proposed', keywordMeasured: false };
}

/**
 * The 4 slots for one week. `weekIndex` rotates the plan's themes and the
 * verified services so consecutive weeks follow the plan instead of repeating.
 */
export function planWeeklySlots(input: {
  facts: ContentFacts;
  plan: ContentSeoPlan;
  weekIndex: number;
  offer: WeekOffer | null;
  festivals: Array<{ key: string; name: string; date: string }>;
}): PlannedSlot[] {
  const { facts, plan, weekIndex, offer, festivals } = input;
  const services: Array<{ value: string; state: 'VERIFIED' | 'SOURCE_CLAIM'; sourceUrl?: string }> = [];
  for (const s of facts.ownerServices) if (!services.some((x) => norm(x.value) === norm(s))) services.push({ value: s, state: 'VERIFIED' });
  for (const s of facts.websiteServices) if (!services.some((x) => norm(x.value) === norm(s.value))) services.push({ value: s.value, state: 'SOURCE_CLAIM', sourceUrl: s.sourceUrl });

  const base = [
    { label: `Business name: ${facts.businessName}`, state: 'VERIFIED' as const },
    ...(facts.category ? [{ label: `Category: ${facts.category}`, state: 'VERIFIED' as const }] : []),
    ...(facts.city ? [{ label: `Location: ${[facts.area, facts.city].filter(Boolean).join(', ')}`, state: 'VERIFIED' as const }] : []),
  ];
  const svcEvidence = (s?: { value: string; state: 'VERIFIED' | 'SOURCE_CLAIM'; sourceUrl?: string }) =>
    s ? [{ label: `Service: ${s.value}`, state: s.state, sourceUrl: s.sourceUrl }] : [];
  const theme = (offset: number) => (plan.themes.length ? { t: plan.themes[(weekIndex + offset) % plan.themes.length], i: (weekIndex + offset) % plan.themes.length } : null);
  const service = (offset: number) => (services.length ? services[(weekIndex + offset) % services.length] : undefined);

  const slots: PlannedSlot[] = [];
  // 1 — priority SEO theme (else a verified service, else the category).
  const t1 = theme(0);
  const s1 = service(0);
  slots.push({
    slot: 1,
    purpose: t1 ? 'seo_theme' : s1 ? 'service' : 'education',
    service: s1?.value,
    ...keywordInfo(t1?.t.keyword, plan),
    seoPlanId: plan.seoPlanId,
    ...(t1 ? { seoThemeIndex: t1.i, seoTheme: t1.t.theme } : {}),
    evidence: [...base, ...svcEvidence(s1)],
  });
  // 2 — another verified service, or an educational post about the category.
  const s2 = services.length > 1 ? service(1) : undefined;
  slots.push({ slot: 2, purpose: s2 ? 'service' : 'education', service: s2?.value, keywordMeasured: false, seoPlanId: plan.seoPlanId, evidence: [...base, ...svcEvidence(s2)] });
  // 3 — local relevance (verified business + location), with a measured local keyword when one exists.
  const cityKws = plan.measuredKeywords.filter((k) => facts.city && norm(k).includes(norm(facts.city)));
  // Prefer a local keyword slot 1 is not already targeting (one keyword per post, no repeats).
  const localKw = cityKws.find((k) => !t1 || norm(k) !== norm(t1.t.keyword)) ?? cityKws[0];
  slots.push({ slot: 3, purpose: facts.city ? 'local' : 'education', service: service(2)?.value, ...keywordInfo(localKw, plan), seoPlanId: plan.seoPlanId, evidence: [...base, ...svcEvidence(service(2))] });
  // 4 — the week's opportunity: owner offer > festival > next SEO theme > education.
  const festival = festivals[0] || null;
  if (offer?.text?.trim()) {
    const offerFestival = offer.festivalName ? festivals.find((f) => norm(f.name) === norm(offer.festivalName!)) || { key: 'owner', name: offer.festivalName, date: '' } : null;
    slots.push({ slot: 4, purpose: 'offer', offerText: offer.text.trim(), festival: offerFestival, keywordMeasured: false, seoPlanId: plan.seoPlanId, evidence: [...base, { label: `Offer (owner's words): ${offer.text.trim()}`, state: 'OWNER_CONFIRMED' }] });
    // A festival this week that the offer is not about gets its greeting in slot 3.
    if (festival && !offerFestival) slots[2] = { slot: 3, purpose: 'festival', festival, keywordMeasured: false, seoPlanId: plan.seoPlanId, evidence: [...base, { label: `${festival.name}: ${festival.date}`, state: 'CALENDAR' }] };
  } else if (festival) {
    slots.push({ slot: 4, purpose: 'festival', festival, keywordMeasured: false, seoPlanId: plan.seoPlanId, evidence: [...base, { label: `${festival.name}: ${festival.date}`, state: 'CALENDAR' }] });
  } else {
    const t4 = plan.themes.length > 1 ? theme(1) : null;
    const s4 = service(3);
    slots.push({
      slot: 4,
      purpose: t4 ? 'seo_theme' : 'education',
      service: s4?.value,
      ...keywordInfo(t4?.t.keyword, plan),
      seoPlanId: plan.seoPlanId,
      ...(t4 ? { seoThemeIndex: t4.i, seoTheme: t4.t.theme } : {}),
      evidence: [...base, ...svcEvidence(s4)],
    });
  }
  return slots;
}

const IST_OFFSET_MS = 330 * 60_000;

/** Content week key — ISO week (Mon–Sun) in India time, e.g. '2026-W40'. */
export function contentWeekKey(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const t = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;
}

/** Monday 00:00 India time of the week containing `d`. */
export function contentWeekStart(d: Date): Date {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDay() || 7;
  const mondayIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - (day - 1));
  return new Date(mondayIst - IST_OFFSET_MS);
}
