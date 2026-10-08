/**
 * GBP Intelligence sync orchestrator — ONE run gathers every FR-3.2…3.6
 * input with the minimum set of Google calls. Pure apart from the injected
 * deps, so it runs under `node --test` with mocked Google responses.
 *
 * Per run (connected business):
 *   1 × locations.get with one readMask covering name, address, PIN, phone,
 *       website, hours, special hours, categories, services, description,
 *       pin, open status and metadata (duplicate / Google-updated / VoM flags)
 *   1 × attributes
 *   1 × VoiceOfMerchantState (verification / suspension)
 *   0–1 × getGoogleUpdated — only when metadata.hasGoogleUpdated
 *   media + posts — reused from the previous snapshot on scheduled runs
 *       while fresher than MEDIA_POSTS_TTL_HOURS
 *   0–1 × Places searchText — only when the duplicate cache is stale or the NAP changed
 *   reviews — no Google call here: the existing review sync (same worker run)
 *       already fetched them; this only summarizes the stored result
 *
 * A failed section keeps its last successful data and records the failure;
 * nothing is ever converted into an empty value.
 */
import type {
  ExternalChange,
  GbpAttribute,
  GbpDuplicates,
  GbpGoogleUpdates,
  GbpLocationData,
  GbpMediaSummary,
  GbpPostsSummary,
  GbpReviewsSummary,
  GbpSnapshotCore,
  GbpSnapshotSections,
  GbpVerificationState,
  Section,
  SectionError,
  SyncReason,
} from './types.ts';
import { MAX_STORED_CHANGES, SNAPSHOT_SCHEMA_VERSION } from './types.ts';
import { normalizeAttributes, normalizeGoogleUpdated, normalizeLocation, normalizeVoiceOfMerchant, summarizeMedia, summarizePosts } from './normalize.ts';
import { canonicalizeLocation, detectChanges } from './changes.ts';
import { computeHealth, newIssueCodes } from './health.ts';
import { napFingerprint, needsPlacesSearch, rankCandidates, SEARCH_RADIUS_M, type PlaceCandidate } from './duplicates.ts';
import { toSectionError } from './errors.ts';
import type { GbpReadApi } from './googleApi.ts';

export const MEDIA_POSTS_TTL_HOURS = 20;

export interface SyncDeps {
  now: () => Date;
  /** Valid access token (refreshes when needed). Throws GBPAuthError when access was revoked. */
  getAccessToken: () => Promise<string>;
  api: GbpReadApi;
  /** Owner media list — reuses lib/gbpClient.ts listLocationMedia. */
  listMedia: () => Promise<Array<{ category?: string; mediaFormat?: string | null; createTime?: string | null }>>;
  /** Summary of reviews already synced by the existing review sync (database only). */
  readReviewsSummary: () => Promise<GbpReviewsSummary>;
  /** Places text search; omit to skip the Places duplicate check (no API key). */
  searchPlaces?: (query: string, center: { latitude: number; longitude: number }, radiusMeters: number) => Promise<PlaceCandidate[]>;
  /** Canonical field keys GrowwMatics itself wrote to Google since `since`. */
  growmaticsEditedFields?: (since: Date | null) => Promise<Set<string>>;
}

export interface SyncInput {
  businessId: string;
  accountId: string | null;
  locationId: string;
  previous: GbpSnapshotCore | null;
  reason: SyncReason;
  /** Force media/posts/Places refresh regardless of freshness. */
  force?: boolean;
}

export interface SyncResult {
  snapshot: GbpSnapshotCore;
  newChanges: ExternalChange[];
  newIssueCodes: string[];
  /** Google calls made this run, by endpoint (for tests and logs). */
  calls: Record<string, number>;
  authRevoked: boolean;
  /** Fields the existing Business gap-fill step needs — no second location read. */
  profileForBusiness: {
    title: string;
    description: string;
    primaryPhone: string;
    website: string;
    primaryCategory: string;
    address: string;
  } | null;
}

const notFetched = <T>(): Section<T> => ({ meta: { status: 'NOT_FETCHED', fetchedAt: null, lastSuccessfulFetchAt: null, error: null }, data: null });

export function emptySections(): GbpSnapshotSections {
  return {
    location: notFetched(),
    attributes: notFetched(),
    verification: notFetched(),
    media: notFetched(),
    posts: notFetched(),
    reviews: notFetched(),
    googleUpdates: notFetched(),
    duplicates: notFetched(),
    products: {
      meta: {
        status: 'NOT_AVAILABLE',
        fetchedAt: null,
        lastSuccessfulFetchAt: null,
        error: null,
        note: 'No Google Business Profile API endpoint available to this integration returns the product catalog.',
      },
      data: null,
    },
  };
}

const success = <T>(data: T, at: string): Section<T> => ({ meta: { status: 'SUCCESS', fetchedAt: at, lastSuccessfulFetchAt: at, error: null }, data });

/** Failure keeps the previous successful data — never replaced by an empty value. */
const failed = <T>(prev: Section<T> | undefined | null, error: SectionError, at: string): Section<T> => ({
  meta: { status: 'FAILED', fetchedAt: at, lastSuccessfulFetchAt: prev?.meta.lastSuccessfulFetchAt ?? null, error },
  data: prev?.data ?? null,
});

const isAuthError = (err: unknown) => (err as any)?.name === 'GBPAuthError';

export async function runGbpIntelligenceSync(input: SyncInput, deps: SyncDeps): Promise<SyncResult> {
  const now = deps.now();
  const at = now.toISOString();
  const prev = input.previous;
  const prevSections: GbpSnapshotSections = prev?.sections ? { ...emptySections(), ...prev.sections } : emptySections();
  const sections: GbpSnapshotSections = { ...prevSections, products: emptySections().products };
  const calls: Record<string, number> = {};
  const count = (k: string) => { calls[k] = (calls[k] || 0) + 1; };
  let authRevoked = false;

  // ── Token (one per run; reused by every call below) ────────────────────
  let token: string | null = null;
  try {
    token = await deps.getAccessToken();
  } catch (err) {
    authRevoked = isAuthError(err);
    const e = toSectionError(err);
    for (const key of ['location', 'attributes', 'verification', 'media', 'posts', 'googleUpdates'] as const) {
      (sections as any)[key] = failed((prevSections as any)[key], e, at);
    }
  }

  if (token) {
    // ── 1. Location (single read for all profile fields) ──────────────────
    let loc: GbpLocationData | null = null;
    try {
      count('locations.get');
      loc = normalizeLocation(await deps.api.getLocation(token, input.locationId));
      sections.location = success(loc, at);
    } catch (err) {
      // A 401 on the read is NOT proof the grant was revoked (only the
      // refresh endpoint's invalid_grant is) — it is recorded as a failure.
      if (isAuthError(err)) authRevoked = true;
      sections.location = failed(prevSections.location, toSectionError(err), at);
    }

    // ── 2. Independent reads, in parallel ───────────────────────────────
    const freshFor = (s: Section<unknown> | undefined | null) =>
      !input.force && input.reason === 'scheduled' && s?.meta.status === 'SUCCESS' && !!s.meta.lastSuccessfulFetchAt &&
      now.getTime() - new Date(s.meta.lastSuccessfulFetchAt).getTime() < MEDIA_POSTS_TTL_HOURS * 3_600_000;

    const tasks: Array<Promise<void>> = [];
    tasks.push((async () => {
      try {
        count('locations.getAttributes');
        sections.attributes = success<GbpAttribute[]>(normalizeAttributes(await deps.api.getAttributes(token!, input.locationId)), at);
      } catch (err) {
        sections.attributes = failed(prevSections.attributes, toSectionError(err), at);
      }
    })());
    tasks.push((async () => {
      try {
        count('verifications.getVoiceOfMerchantState');
        sections.verification = success<GbpVerificationState>(normalizeVoiceOfMerchant(await deps.api.getVoiceOfMerchantState(token!, input.locationId)), at);
      } catch (err) {
        sections.verification = failed(prevSections.verification, toSectionError(err), at);
      }
    })());
    if (!freshFor(prevSections.media)) {
      tasks.push((async () => {
        try {
          count('media.list');
          sections.media = success<GbpMediaSummary>(summarizeMedia(await deps.listMedia()), at);
        } catch (err) {
          sections.media = failed(prevSections.media, toSectionError(err), at);
        }
      })());
    }
    if (!freshFor(prevSections.posts)) {
      tasks.push((async () => {
        try {
          count('localPosts.list');
          const { posts, truncated } = await deps.api.listLocalPosts(token!, input.accountId, input.locationId);
          sections.posts = success<GbpPostsSummary>(summarizePosts(posts, truncated), at);
        } catch (err) {
          sections.posts = failed(prevSections.posts, toSectionError(err), at);
        }
      })());
    }
    // Google-suggested edits: only asked for when Google says there are some.
    if (loc) {
      if (loc.metadata.hasGoogleUpdated) {
        tasks.push((async () => {
          try {
            count('locations.getGoogleUpdated');
            const raw = await deps.api.getGoogleUpdated(token!, input.locationId);
            sections.googleUpdates = success<GbpGoogleUpdates>(normalizeGoogleUpdated(raw, (l) => canonicalizeLocation(l, at.slice(0, 10))), at);
          } catch (err) {
            sections.googleUpdates = failed(prevSections.googleUpdates, toSectionError(err), at);
          }
        })());
      } else {
        sections.googleUpdates = success<GbpGoogleUpdates>({ diffFields: [], pendingFields: [], googleValues: {} }, at);
      }
    }
    await Promise.all(tasks);
  }

  // ── 3. Reviews: summarize what the existing review sync stored ───────────
  try {
    sections.reviews = success<GbpReviewsSummary>(await deps.readReviewsSummary(), at);
  } catch (err) {
    sections.reviews = failed(prevSections.reviews, toSectionError(err), at);
  }

  // ── 4. Duplicates: Google's flag (free) + cached Places check ──────────
  const locData = sections.location.data;
  if (locData) {
    const prevDup = prevSections.duplicates.data;
    const base: GbpDuplicates = {
      googleFlaggedDuplicateOf: locData.metadata.duplicateLocation,
      candidates: prevDup?.candidates ?? [],
      placesCheckedAt: prevDup?.placesCheckedAt ?? null,
      napFingerprint: prevDup?.napFingerprint ?? null,
    };
    const freshLoc = sections.location.meta.status === 'SUCCESS';
    if (freshLoc && deps.searchPlaces && needsPlacesSearch(locData, prevDup, now, !!input.force && input.reason === 'manual')) {
      try {
        count('places.searchText');
        const found = await deps.searchPlaces(locData.title!, locData.latlng!, SEARCH_RADIUS_M);
        sections.duplicates = success<GbpDuplicates>({
          ...base,
          candidates: rankCandidates(locData, found),
          placesCheckedAt: at,
          napFingerprint: napFingerprint(locData),
        }, at);
      } catch (err) {
        sections.duplicates = { ...failed(prevSections.duplicates, toSectionError(err), at), data: base };
      }
    } else {
      sections.duplicates = {
        meta: freshLoc
          ? { status: 'SUCCESS', fetchedAt: at, lastSuccessfulFetchAt: at, error: null, note: base.placesCheckedAt ? 'Places result reused from cache.' : 'Places check skipped (no pin, no name or no API key).' }
          : prevSections.duplicates.meta,
        data: base,
      };
    }
  }

  // ── 5. Change detection (previous successful vs this run) ────────────────
  let edited: Set<string> | undefined;
  if (deps.growmaticsEditedFields && prev?.lastSuccessfulSyncAt) {
    try { edited = await deps.growmaticsEditedFields(new Date(prev.lastSuccessfulSyncAt)); } catch { edited = undefined; }
  }
  const newChanges = prev
    ? detectChanges({
        prev: { location: prevSections.location, attributes: prevSections.attributes, verification: prevSections.verification },
        next: { location: sections.location, attributes: sections.attributes, verification: sections.verification },
        growmaticsEditedFields: edited,
        googleUpdates: sections.googleUpdates.meta.status === 'SUCCESS' ? sections.googleUpdates.data : null,
        now,
      })
    : [];

  // ── 6. Health ────────────────────────────────────────────────────────────
  const health = computeHealth({
    authRevoked,
    location: sections.location,
    verification: sections.verification,
    duplicates: sections.duplicates,
    previous: prev?.health ?? null,
    now,
  });

  const attempted = Object.entries(sections).filter(([k, s]) => k !== 'products' && s.meta.fetchedAt === at);
  const anyFailed = attempted.some(([, s]) => s.meta.status === 'FAILED');
  const locOk = sections.location.meta.status === 'SUCCESS' && sections.location.meta.fetchedAt === at;
  const snapshot: GbpSnapshotCore = {
    businessId: input.businessId,
    accountId: input.accountId,
    locationId: input.locationId,
    placeId: sections.location.data?.metadata.placeId ?? prev?.placeId ?? null,
    source: 'GOOGLE_BUSINESS_PROFILE',
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    fetchedAt: at,
    lastSuccessfulSyncAt: locOk ? at : prev?.lastSuccessfulSyncAt ?? null,
    lastSyncReason: input.reason,
    lastSyncOutcome: !locOk ? 'FAILED' : anyFailed ? 'PARTIAL' : 'SUCCESS',
    sections,
    externalChanges: [...newChanges, ...(prev?.externalChanges || [])].slice(0, MAX_STORED_CHANGES),
    health,
  };

  const l = locOk ? sections.location.data! : null;
  return {
    snapshot,
    newChanges,
    newIssueCodes: newIssueCodes(prev?.health, health),
    calls,
    authRevoked,
    profileForBusiness: l
      ? {
          title: l.title || '',
          description: l.description || '',
          primaryPhone: l.primaryPhone || '',
          website: l.websiteUri || '',
          primaryCategory: l.primaryCategory?.displayName || '',
          address: l.address?.formatted || '',
        }
      : null,
  };
}
