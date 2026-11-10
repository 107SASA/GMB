# Keyword System — Implementation Plan

Status: **built on `dev`, all 7 phases** · Nov 2026

| Phase | As built |
|---|---|
| 1 Foundation | `seo/keywordTypes`, `keywordResearch`, `keywordScore`, `keywordSelect`, `keywordSet`; `SeoPlan.keywordSet`; 20-keyword cap |
| 2 Audit pipeline | `seo/keywordPipeline` in the full audit; ideas + competitor-site clients; volume chunking; Google Ads rate gate (11/min) |
| 3 Dashboard | `/dashboard/keywords` + `/api/keywords` (pin); Insights shows measured numbers only; SEO plan shows focus / monthly keywords |
| 4 Consumers | Weekly + manual posts, content keywords, description service order and the AI plan's lead keyword use the targets |
| 5 Onboarding | Real volume on suggestions and owner keywords (intake + Settings), 8 lookups / business / day |
| 6 Loop | Monthly budget (`lib/keywordBudget`, $1.20 default), essential work first; Monday in-app notice when targets change |
| 7 Migration | `scripts/migrate-keyword-set.ts` (dry run default): trims lists over 20 into `legacyKeywords`, seeds plans from the last report |

Not done (by design or later): the report's main 5-keyword grid still runs as before (§5 S4 note); review-request WhatsApp templates are Meta-approved text and were not changed; `/api/gbp/keyword-intelligence` (AI volumes) is no longer used by any page and can be removed.

## 1. Goal

One keyword system that the owner, the code and the AI all share:

1. Research every keyword that could matter for the business.
2. Measure each one with **real Google data**: search volume, our Google Maps rank, who ranks above us.
3. **Pick the month's target keywords automatically**, from data and fixed rules.
4. Use those keywords in every action all month (posts, profile, review replies, Q&A).
5. Re-measure next month, show progress, and keep or swap keywords automatically.

**The owner does nothing manually.** Pin, remove and add are optional, and the owner's choice always wins.

### Principles
- **Rules + Google data decide. AI only explains.** AI never makes up a volume or a rank.
- **Volume first, then rank.** One Google Ads request covers up to 700 keywords, so we get volume for everything, then rank-check only the best.
- **One list.** It lives on the active `SeoPlan`. The model's own rule is "only ONE brain; do not add a parallel store".
- **Stable core.** Core keywords stay at least 90 days, because Maps ranking takes 2–3 months to move.
- **Honest gaps.** "Google has too few searches to report" is shown as that, never as 0 and never as a guess.

## 2. What is wrong today (summary)

| # | Problem | Where |
|---|---|---|
| 1 | Only the owner's **first 1–2 keywords** enter the ranking check. Keywords 3–20 are never measured. | `seoAnalyzer.ts:633` `buildKeywords` |
| 2 | About half the main grid is "best X" / "top X" variants, which the post fact-check blocks anyway | `seoAnalyzer.ts:647` |
| 3 | Volume is fetched only for keywords that were already rank-checked (~15–20 phrases); the 700-keyword request is unused | `keywordTable.ts:50`, `auditService.ts:590` |
| 4 | No keyword discovery from Google | — |
| 5 | Onboarding suggestions have no volume | `api/onboarding/suggest-keywords` |
| 6 | The Insights page shows **AI-guessed** volume (`estMonthlyVolume`) | `services/ai.ts:263`, `insights/page.tsx:467` |
| 7 | Real volume appears only inside the report, never on the dashboard | `ConsultantSections.tsx:293` |
| 8 | Weekly posts don't read the owner's keywords | `content/weeklyBatch.ts:51` |
| 9 | Four keyword lists that don't match: `Business.keywords`, `SeoPlan.primaryKeywords`, `SeoPlan.trackedKeywords`, `GBPKeywordIntel` | — |
| 10 | No competitor keyword data | — |
| 11 | The intake fields `targetAudience`, `primaryGoal` and `competitorNames` are saved but never used | `onboarding/intake` |
| 12 | Volume is India-wide only; city-level demand is only a fallback | `keywordVolumeClient.ts` |

**What we keep:** the measurement and monthly history engine (`seo/measurements.ts`, `buildKeywordMovement`, `trackedKeywords.ts` stability rules), the volume cache, `areaDemand.ts`, `keywordPriority.ts`, GBP search-term sync and the audit autopilot trigger. They're well built; they just get the wrong inputs.

## 3. End-to-end flow

```
ONBOARDING (owner)
  info + up to 20 keywords
  every keyword shows real volume while choosing (1 cached request)
        │
        ▼
DASHBOARD → CONNECT GBP → MAIN AUDIT starts automatically (already exists)
        │
        ├─ S1  Build candidates      (300–700 keywords)
        ├─ S2  Volume for all        (1–3 Google Ads requests)
        ├─ S3  Score                 (pure rules)
        ├─ S4  Rank-check shortlist  (Maps grid; owner keywords always)
        ├─ S5  Competitors           (from the same Maps results, plus top-3 sites)
        ├─ S6  Select targets        (5 core + 5 rotating + owner verdicts)
        └─ S7  Save keywordSet on the new SeoPlan version
        │
        ▼
ALL MONTH: posts, profile, review replies, Q&A, review requests use the targets
        │
        ▼
NEXT MONTH AUDIT: re-measure → movement → auto keep/swap → repeat
```

## 4. Data model

### 4.1 `SeoPlan.keywordSet`: the single keyword list (new field)

```ts
interface PlanKeyword {
  id: string;                  // keywordId() from seo/ids.ts (stable across months)
  keyword: string;
  role: 'core' | 'rotating' | 'owner' | 'watch';   // watch = measured, not targeted
  sources: Array<'owner' | 'service' | 'gbp_search_term' | 'google_ideas'
               | 'competitor' | 'service_area' | 'category'>;
  serviceId: string | null;    // tie to a verified service (trackedKeywords.ts)
  service: string | null;

  // Demand (Google Ads only, never AI)
  volume: {
    country: number | null;    // India-wide monthly searches
    city: number | null;       // when the Ads location is the business's city
    area: AreaDemand | null;   // broad term in city/state (areaDemand.ts)
    status: 'measured' | 'too_few_searches' | 'not_measured';
    measuredAt: string;
  };
  gbpImpressions: number | null;   // latest month, GBP Performance API

  // Rank (Maps, this month)
  rank: { avg: number | null; best: number | null; foundPct: number;
          points: number; status: 'measured' | 'unavailable' | 'not_measured' };
  rankTrend: number | null;        // positions moved vs. last comparable month
  competitorsAbove: Array<{ name: string; rank: number; reviews: number | null; rating: number | null }>; // top 3

  // Decision
  score: number;
  verdict: 'strong' | 'quick_win' | 'defend' | 'low_demand' | 'hard' | 'not_relevant';
  reason: string;                  // built from the numbers (AI may rephrase, never add facts)
  coreSince?: string;              // for the 90-day lock
  pinned?: boolean;                // owner override: never swapped
}
```

Also on `SeoPlan`:
- `keywordResearch: { candidates: number; withVolume: number; checkedRank: number; ranAt: string }`, for transparency and debugging
- `competitorGaps: Array<{ keyword, volume, competitor, competitorRank }>`, keywords competitors rank for and we don't

### 4.2 Existing fields
- `Business.keywords` stays **the owner's own list** (cap 20). It's input only.
- `SeoPlan.primaryKeywords` / `secondaryKeywords` become **derived** from `keywordSet` (core / rotating), so existing readers keep working during the move.
- `SeoPlan.trackedKeywords` keeps its stability role; `buildTrackedKeywords` gets the owner, core and rotating keywords as inputs (see S4).
- `SeoPlan.ownerRemovedKeywords` is kept and respected by S1.
- `GBPKeywordIntel` (AI volumes) is **retired**.

## 5. Main audit pipeline (new stages)

New logic goes in **separate modules**, not into the 2,000-line `auditService.ts`, which only calls them:

| File | What | Pure? |
|---|---|---|
| `src/services/seo/keywordResearch.ts` | S1 candidate builder | yes |
| `src/services/seo/keywordScore.ts` | S3 scoring + verdict | yes |
| `src/services/seo/keywordSelect.ts` | S6 core/rotating selection, 90-day lock, swaps | yes |
| `src/services/audit/keywordIdeasClient.ts` | DataForSEO Google Ads `keywords_for_keywords` + `keywords_for_site` | I/O |
| `src/services/seo/keywordSet.ts` | Assemble `PlanKeyword[]` from the stages | yes |

### S1: Build candidates (300–700)
Sources, in priority order, deduped by `keywordId`:
1. **Owner keywords** (all, up to 20). Always kept, never filtered out.
2. **Verified services × city** and **services × the 3 nearest service areas** (`verifiedServices()`).
3. **GBP search terms** with impressions (`GBPKeyword`, last 3 months), real customer searches.
4. **Google keyword ideas**: `keywords_for_keywords` seeded with the category + top services + owner keywords (max 20 seeds), at the **city** Ads location when one exists (location lookup already in `areaDemand.ts`). This returns ideas **with volume in the same call**.
5. **Competitor keywords**: `keywords_for_site` for the top 3 competitors' websites (from the Maps results), plus the owner-entered `competitorNames`, resolved to their listings.
6. **Category + "near me"** variants for the top 2 services.

Filters: brand words (`brandWords`), claim words (`best|top|no 1…`, same as `trackedKeywords.ts` `CLAIM`), competitor names, `ownerRemovedKeywords`, `adsKeyword()` validity, and **relevance**: the keyword must match a verified service or category (`serviceForKeyword`), except owner keywords.

### S2: Volume for all
- One `fetchSearchVolumes` call (country) for every candidate that S1 didn't already get volume for. **Fix:** chunk beyond 700 instead of silently dropping the rest.
- City volume: comes from S1's `keywords_for_keywords` results, or a second `search_volume` call at the city location code.
- `areaDemandFor` only for owner, core or rotating keywords still without a number.
- Everything goes through the existing 45-day `KeywordVolumeCache`.

### S3: Score (pure, unit-tested)
```
score = demand × relevance × winnability

demand      = log10(1 + bestVolume)              // city, else country, else area-demand ×0.5
              or log10(1 + gbpImpressions)        // when Google Ads has nothing
              or 0.3                              // owner/service keyword, no data at all
relevance   = 1.0 GBP-listed service / category
              0.8 owner service / owner keyword
              0.6 website-only service
              0   no match → dropped (not for owner keywords)
winnability = 1.0 rank 4–10   (quick win)
              0.8 rank 11–20
              0.6 rank 1–3    (defend)
              0.4 not in top 20 / not measured yet
              × 0.7 if top-3 competitors average ≥ 5× our review count
```
Verdict rules: `quick_win` (rank 4–10 and has demand), `defend` (rank 1–3), `strong` (high score), `low_demand` (too few searches, no impressions), `hard` (winnability ≤ 0.3), `not_relevant` (owner keyword with no service match; still measured).

### S4: Rank-check the shortlist
**As built (Phase 2):** the report's main 5-keyword grid is kept for now, so headline report numbers stay comparable month to month. The keyword stage runs alongside it and **reuses** any keyword the grid or tracked searches already covered at enough points (never paid twice). Replacing the grid with the core keywords is a later step (with Phase 3, when the dashboard reads `keywordSet`).

Point counts per set:

| Set | Points per keyword | Count |
|---|---|---|
| Core 5 | 9 (full 3×3 grid) | 5 |
| Rotating 5 | 3 (reduced grid) | 5 |
| Owner keywords not already above | 3 | up to 20 |
| Next-best 20 candidates (to find quick wins) | 1 (centre) | 20 |
| Services × service areas | 1 per area | ≤ 9 |

On the first audit there's no core set yet, so the top 5 by pre-rank score take the 9-point grid. All of this reuses `fetchGeoGridRankings`, `fetchTrackedObservations` and `fetchAreaObservations`, plus `measurementRows` so monthly history keeps working.

**History note:** replacing the best/top grid keywords breaks comparison **once** for those phrases. The measurement code already shows "not comparable" instead of a fake change, so nothing will show wrong numbers.

### S5: Competitors
- **Free:** every Maps search already returns the top 20. For each keyword we store the top 3 above us (`competitorsAbove`).
- **Gaps:** keywords from S1 source 5 where a competitor is in the top 3 and we're not in the top 20 → `competitorGaps` (with volume).

### S6: Select targets (pure, unit-tested)
- **Core (5):**
  - First plan: top 5 by score, including **at least 2 owner keywords** if any owner keyword scores ≥ the 10th candidate.
  - Locked for **90 days** (`coreSince`).
  - After 90 days, a core keyword is swapped only if: no rank gain of ≥ 3 positions **and** not in the top 3, **or** demand went to `too_few_searches` with no impressions, **or** its service is no longer listed.
  - **Max 2 core swaps per month.** `pinned` keywords are never swapped.
- **Rotating (5):** re-picked monthly from the best non-core candidates. Prefer `quick_win`, then GBP search terms, then competitor gaps. Max 1 per service, so they don't all cover the same service.
- **Owner keywords:** always `role: 'owner'` (or core/rotating if selected). They get a verdict and reason, and are measured every month.
- **Watch:** the rest of the shortlist, stored for next month's selection.
- Every decision writes a `keywordChanges` entry with the reason (the existing format).

### S7: Save
New `SeoPlan` version (existing `upsertSeoPlanFromAudit` path) with `keywordSet`, derived `primaryKeywords`/`secondaryKeywords`, `competitorGaps` and `keywordResearch`. The `ownerEdited` rules are kept as they are.

## 6. Where the targets are used (all month)

| Action | Change | File |
|---|---|---|
| Weekly posts | `loadContentContext` reads core + rotating from `keywordSet`; `keywordPriorities` already ranks by measured volume and rank | `content/weeklyBatch.ts`, `content/keywordPriority.ts` |
| Manual post | Default keyword list = core + rotating (not `Business.keywords`) | `api/content/generate/route.ts` |
| GBP description / services | Built around the core keywords, via the existing approval flow | `api/gbp/optimize/route.ts`, `seoPlan/applyPlan.ts` |
| Review replies | `reviewReplyMustInclude` = core service + city phrases | `reviews/replyPipeline.ts` |
| Q&A | `suggestedQas` cover core services | `ai/seoPlanEngine.ts` |
| Review requests | The message gently asks to mention the service received | `review-requests` templates |
| AI prompts | Get `targetAudience` from intake (tone only, never facts) | `ai/contentEngine.ts` |

## 7. Monthly loop (no weekly check)

- **Monthly only:** the existing `auditAutopilotCron` → full S1–S7. Maps ranks move over weeks to months, and all keep/swap decisions are monthly, so a weekly check would mostly show noise. Leaving it out saves ~₹30 per business per month and a cron job.
- **Owner edits** (Settings: add/remove/pin) → new plan version via the existing `applyOwnerProfileEdit` path. New keywords get volume immediately (one cached call) and rank at the next monthly run.
- **Later, optional:** a "Re-check now" button (core 5 only, once per month) if owners ask for movement between reports.

## 7a. Limits and cost guard

- **Owner keywords: max 20**, enforced in the API (`/api/onboarding/intake` and `/api/business/[id]`, which today saves any number with no cap), not just in the form. Form copy: "Up to 20. We research hundreds more for you automatically."
- **System caps per audit:** ≤ 700 research candidates, ≤ 50 rank-checked keywords, 9-point grid only for the 5 core.
- **Hard ceiling per business per month: ~₹100.** Each paid stage checks the month's metered spend (`providerMeter`) first; if a stage would cross the ceiling it is skipped and logged, never silently retried.

## 8. Onboarding changes

- The owner can add **up to 20 keywords**. Today intake allows 30 and Settings 20, so both become 20.
- `suggest-keywords` adds **real volume** to every suggestion (one `fetchSearchVolumes` call per batch, cached) and sorts by volume. The chip shows "320/mo" or "few searches".
- Keywords the owner types: volume is fetched in a batched, debounced call (rate limit: 10 calls per user per day, mostly cache hits).
- Copy: "Add the services people search for. We'll research the rest and pick the best ones every month."
- Fields: `competitorNames` → used in S1/S5; `targetAudience` → AI tone; **`primaryGoal` removed** (the goal is always more customers from Google).

## 9. Dashboard

### 9.1 New page: `/dashboard/keywords`
API: `GET /api/keywords` → the active plan's `keywordSet`, `competitorGaps` and the last 6 months of rank per keyword (from stored measurements).

Owner keywords are **never removed** from the system. Every one is shown with real numbers and an honest verdict, and a good one becomes a target ("Core · yours").

The page has four sections:
1. **Your keywords**: everything the owner entered, with volume, rank, trend, #1 on Google and a verdict
2. **Keywords we found for you**: this month's core and rotating targets, each with "why we picked this"
3. **Competitors**: per keyword, #1–#3 (rating, reviews) next to our rank, plus "competitors rank, you don't"
4. **What customers searched**: GBP search terms with impressions

Example row:

| Keyword | Type | Searches / month | Your rank | Trend | #1 on Google | Why |
|---|---|---|---|---|---|---|
| root canal treatment kolkata | Core · yours | 320 | #9 | ↑5 | ABC Dental | Quick win: you're close to the top 3 |

- Type badges: Core, This month, Yours, Watching. Searches show the city number if available, else India, else "Few searches (dentist in Kolkata: 2,400)".
- Optional actions per row: pin, remove, add keyword.



### 9.2 Existing pages
- **Insights:** remove the "AI estimate of demand" card and the AI growth keywords. Real volume comes from `keywordSet`; "Keywords to grow" becomes `competitorGaps` + top watch candidates.
- **SEO plan:** the target keyword chips show volume and rank, linking to `/dashboard/keywords`.
- **Report:** the keyword table reads from `keywordSet` (all targets + owner keywords, not just the grid).

## 10. Cost per business per month (DataForSEO list prices in `costModel.ts`)

| Item | Calls | Cost |
|---|---|---|
| Volume, country (≤ 700 per task) | 1–2 | $0.09–0.18 |
| Keyword ideas, city (`keywords_for_keywords`) | 1 | ~$0.09* |
| Competitor sites (`keywords_for_site`) ×3 | 3 | ~$0.27* |
| Area demand fallback | 1 | $0.09 |
| Monthly Maps: 45 + 15 + ≤60 + 20 + ≤9 ≈ 150 searches | 150 | $0.30 |
| **Total (monthly only)** | | **≈ $0.85–0.95 ≈ ₹70–85** |

\* Google Ads-tier task price. **Verify on dataforseo.com/pricing** and that the endpoints are enabled on our account before Phase 2. Add both to `UNIT_PRICES` and `meter()` so `/admin` cost tracking stays correct. The cache makes month 2 onwards cheaper.

## 11. Existing customers (migration)

`scripts/migrate-keyword-set.ts` (dry-run by default):
- `Business.keywords` > 20 → keep the first 20 as the owner's. The rest aren't deleted; they move into the candidate pool (`Business.legacyKeywords`), so S1 still considers them.
- Seed `keywordSet` from the current `trackedKeywords` + `keywordTable` + owner keywords, marked `rank.status: 'not_measured'` where there's no data.
- No paid calls. The next monthly audit fills in real numbers. An admin can trigger an early re-audit per business.

## 12. Build phases

| Phase | Scope | Main files | Done when |
|---|---|---|---|
| **1. Foundation** | `PlanKeyword` types, `SeoPlan.keywordSet`, pure `keywordResearch` / `keywordScore` / `keywordSelect` / `keywordSet` | `models/SeoPlan.ts`, `services/seo/*` | Unit tests cover scoring, verdicts, 90-day lock, swap limits, owner priority |
| **2. Audit pipeline** | S1–S7 wired in; new grid; owner keywords measured; ideas + site clients; volume chunking; cost meter | `audit/auditService.ts`, `audit/seoAnalyzer.ts`, `audit/keywordIdeasClient.ts`, `audit/keywordVolumeClient.ts`, `seoPlan/seoPlanService.ts`, `audit/costModel.ts` | A test audit on dev produces a full `keywordSet` with real volume and ranks |
| **3. Dashboard** | `/api/keywords`, `/dashboard/keywords`, Insights cleanup, SEO plan page | `app/api/keywords`, `app/dashboard/keywords`, `insights/page.tsx`, `seo-plan/page.tsx` | No AI-guessed number anywhere on the dashboard |
| **4. Consumers** | Posts, manual post, profile, replies, Q&A, review requests read `keywordSet` | §6 files | Every generated post records which target keyword it served |
| **5. Onboarding** | 20 cap, volume on suggestions, field changes | `onboarding/intake`, `api/onboarding/*`, `settings/page.tsx`, `api/business/[id]` | Owner sees volume while choosing |
| **6. Loop** | Auto-swap after 90 days, cost ceiling, change notes in the Monday summary | `keywordSelect.ts`, `lib/providerMeter.ts`, `inngest/functions.ts` | Swaps happen only by rule, each with a stored reason; no business exceeds the ceiling |
| **7. Migration** | Script + backfill on dev, then prod | `scripts/migrate-keyword-set.ts` | Dry run reviewed, then applied |

Order: **1 → 2 → 3** first (one list, measured properly, shown honestly), then 4, 5, 6, 7. Each phase is its own PR, dev → main (see deploy flow).

## 13. Risks and how we handle them

| Risk | Handling |
|---|---|
| Google Ads has no volume for most local phrases (399 of 446 cached phrases empty, Nov 2026) | City-level ideas + area demand + GBP impressions; shown honestly as "few searches" |
| One bad phrase makes Google Ads reject the whole request | Existing `adsKeyword()` cleaning + rejected-keyword retry |
| New grid breaks history once | Measurements already mark "not comparable"; the dashboard explains "new keyword, tracking from this month" |
| Keyword churn hurts ranking | 90-day core lock, max 2 swaps per month, pins |
| Cost creep | Fixed caps per stage, 45-day cache, `meter()` on every call, admin cost view |
| DataForSEO endpoints not enabled | Check before Phase 2; S1 works without ideas/site sources, only with less discovery |
| `auditService.ts` gets bigger | New logic lives in pure modules; the audit only calls them |

## 14. Decisions taken (defaults; change any of them)

- Owner keywords: up to **20** (server-enforced), all measured monthly.
- Targets: **5 core** (90-day lock) + **5 rotating** (monthly).
- Rank checks: **monthly only**, no weekly check.
- Cost ceiling: **~₹100 per business per month**.
- Competitor website keywords: **all plans**, top 3 competitors, monthly.
- `primaryGoal` field: **removed**. `targetAudience` → AI tone. `competitorNames` → competitor research.
- The AI-estimated volume feature: **removed**.
