# GMB Audit Score — How It Works, What Was Wrong, What Changed

This document is the deliverable for the "Audit and Improve GMB Audit Score Logic" task.
It covers all four problems in the brief. All changes are on the `dev` branch only.

---

## 1. Where the scoring logic actually lives

The score shown in the report (e.g. `58/100`) is computed once, server-side, in
**`src/services/audit/auditService.ts`** (function `processAuditJob`), using four
sub-scores computed in **`src/services/audit/seoAnalyzer.ts`**:

```
finalScore = round(min(100,
  profileCompletion.completionPercentage * 0.35 +   // 35% weight
  nativeSeoScore.score                  * 0.25 +   // 25% weight
  reviewQualityScore                    * 0.25 +   // 25% weight
  keywordCoverageScore                  * 0.15     // 15% weight
))
```

| Pillar | Weight | Computed by | Inputs |
|---|---|---|---|
| Profile Completeness | 35% | `calculateProfileCompletion()` | 16-item checklist of Business-profile fields |
| SEO Optimization | 25% | `calculateNativeSeoScore()` | description length, category, keywords, services, website, overall completion |
| Review Quality | 25% | `calculateReviewQualityScore()` | average rating (60%) + sentiment mix (40%) |
| Review Keyword Coverage | 15% | `analyzeReviewKeywords()` | % of your category/services/keywords actually mentioned in review text |

The frontend (`AuditReportGrexa.tsx`, used for every `V7` audit — see note below) and
the downloaded PDF (`src/lib/pdf/reportHtml.ts`) both render whatever is stored in
`audit.auditData`, so once the backend computes and stores the breakdown, both the
in-app report and the PDF automatically show it — no separate PDF-specific logic
was needed beyond mirroring the same HTML section.

> **Dead code note:** `src/components/audit/AuditReportV7.tsx` is not imported or
> rendered anywhere — `AuditResultsDashboard.tsx` renders `AuditReportGrexa.tsx` for
> `auditVersion === 'V7'` audits (which is 100% of current audits — `auditVersion`
> defaults to `'V7'`). All UI changes for this task were made in `AuditReportGrexa.tsx`,
> the component that is actually live. `AuditReportV7.tsx` was left untouched since
> it's unused and out of scope ("do not modify unrelated modules").

---

## 2. Problem 1 — Score was a black box → now fully explained

**What changed:** `seoAnalyzer.ts` gained a new function, `buildScoreBreakdown()`,
which is called once per audit in `auditService.ts` right after `finalScore` is
computed. It re-expresses the same four numbers that produced `finalScore` as a
`scoreBreakdown` object:

```ts
{
  finalScore: 58,
  formula: "Final Score = (Profile Completeness × 35%) + (SEO Optimization × 25%) + …",
  criteria: [
    {
      label: "Profile Completeness",
      weightPercent: 35, maxPoints: 35, earnedPoints: 30, rawScore: 86,
      reason: "Missing: Additional Keywords, Service Area. Cannot be verified without
               Google Business Profile API access (counted as half-credit, not a
               deduction): Videos, Logo / Cover Image, Attributes, Booking/Appointment Link.",
      dataSource: "Fields stored on your Business profile in Growwmatic AI …"
    },
    { label: "SEO Optimization", … },
    { label: "Review Quality", … },
    { label: "Review Keyword Coverage", … },
  ]
}
```

This is stored on `audit.auditData.scoreBreakdown` (added to `IAuditData` in
`src/models/Audit.ts`) and rendered:

- In-app: a new **"How Your Score Was Calculated"** card in `AuditReportGrexa.tsx`
  (right under the hero score cards), listing every criterion with max points,
  earned points, a plain-language reason, and the data source.
- PDF: the same section, mirrored in `reportHtml.ts`.
- Shared public report link (`/reports/[token]`): a condensed version of the same
  section was added to `src/app/reports/[token]/page.tsx`.

Nothing about *what* is scored was invented for this — every number displayed is
the exact number that already fed into `finalScore`. No new "fake" per-criterion
numbers (like a fabricated "Photos: 8/15") were added, because the current
codebase does not score photos, hours, or posts individually — it scores them as
part of the Profile Completeness checklist (see below) or not at all (Posts
aren't part of the score at all today — see Problem 2).

### Why did a "100% complete" profile score 58/100?

The breakdown above surfaces the real reason, which was previously invisible:
**Review Quality and Review Keyword Coverage are worth 40% of the score combined,
and both are hard-coded to 0 when a business has zero reviews on file** — regardless
of how complete its profile is. A business with a perfect profile and zero reviews
tops out at `35 + 25 = 60` points. Add a couple of missing "nice to have" SEO
fields and it lands right around the 58 example in the brief. This is expected
business logic (Google does weight reviews heavily), but it was never disclosed —
which is exactly what the new breakdown now fixes.

---

## 3. Problem 2 — Is the current scoring logic correct? (Analysis + 1 real bug fixed)

### 3.1 Confirmed bug — fixed

**Bug: profile-completeness scoring included an unrelated in-app feature
("WhatsApp Connected"), penalizing genuinely complete Google Business Profiles.**

`calculateProfileCompletion()` in `seoAnalyzer.ts` previously had:

```ts
add('WhatsApp Connected', !!(business.whatsappConfig?.isConnected));
```

`WhatsApp Connected` is **not a Google Business Profile field at all** — it's
whether the business owner has connected WhatsApp inside Growwmatic AI's own WhatsApp
AI Agent feature. Scoring it as part of "Profile Completeness" meant a business
could have a literally 100%-complete Google Business Profile and still lose a
full checklist point (1/16 → ~6% of the Profile Completeness pillar, ~2% of the
final score) purely for not having opted into an unrelated CRM feature. This is
precisely the "business owner says 100% complete but audit shows 58/100" scenario
described in the brief.

**Fix:** removed that line entirely from the scored checklist. Profile
Completeness now only scores fields that are actually part of a Google Business
Profile.

### 3.2 Design choice that looks like a bug but isn't (left unchanged)

Six checklist items — `Business Photos`, `Business Hours`, `Videos`,
`Logo / Cover Image`, `Attributes`, `Booking / Appointment Link` — require Google
Business Profile OAuth (the Google Business Profile Management API), which this
codebase does not have access to. Two of them (`Photos`, `Hours`) *can* resolve to
`Complete`/`Missing` once SerpApi's place-details response is cached on the
business; the other four are **always** `Unknown` and always scored at half credit
(0.5 of 1 point), by design (see the code comment above
`calculateProfileCompletion`).

This means a business can never mathematically reach 100% Profile Completeness in
this tool, even with a perfect real GBP profile — at minimum, 4 checklist items
are capped at 0.5/1. This was **not changed**, per the brief's instruction not to
change scoring unless it is clearly incorrect: silently marking these fields
"Complete" without ever verifying them would be fabricating data (the opposite of
what a previous audit-accuracy pass in this codebase already fixed — see the
"no fabricated metrics" history). The honest fix is to add real OAuth-based GBP
verification for those four fields, which is a feature addition, not a scoring
bug fix, and is out of scope for "minimum necessary changes."
**Recommendation for a future task:** implement Google Business Profile OAuth
verification for Videos / Logo / Attributes / Booking link so these can score
`Complete` (or genuinely `Missing`) instead of a permanent `Unknown` half-credit.

### 3.3 Other observations (not changed — not "clearly incorrect")

- **SEO Optimization (25%) partially overlaps with Profile Completeness (35%).**
  A missing website, missing description, or missing category/keywords reduces
  *both* pillars. This is defensible (these fields matter for SEO independent of
  "is the profile filled in"), and is common in real-world scoring rubrics, so it
  was left as-is — but it is called out here for transparency, and the new
  breakdown UI makes the overlap visible instead of hidden.
- **Review Keyword Coverage (15%) depends on customers happening to type specific
  words in their review text.** This is a reasonable proxy for "are customers
  describing you the way you describe yourself," but it's a noisy signal for
  businesses with very few reviews. Not changed (not incorrect, just a design
  trade-off), but now explained per-audit in the breakdown ("X of Y target
  keywords mentioned").
- **Formula weights sum to exactly 100% (35+25+25+15)** — verified, no rounding or
  weighting bug there.

---

## 4. Problem 3 — Review count / "marked unanswered" investigation

### 4.1 Confirmed bug — fixed

**Bug: reviews were shown as unanswered even when they had a real owner reply,
because of a field-name mismatch.**

In `auditService.ts`, reviews fetched from MongoDB were mapped like this:

```ts
ownerReply: r.replyText,   // ← r.replyText does not exist on the Review schema
```

The `Review` model (`src/models/Review.ts`) stores the owner's reply in a field
called **`response`**, not `replyText`. `replyText` is `undefined` on every
`Review` document, so `ownerReply` was always falsy, and
`calculateReviewMetrics()`'s `respondedCount = reviews.filter(r => r.ownerReply).length`
always evaluated to `0` — **every review was reported as unanswered, regardless
of whether it had actually been replied to.** This is exactly the "some reviews
are marked as unanswered even though that may not be true" symptom in the brief.

**Fix:** `ownerReply: r.response` — one line, matches the actual schema field
(and matches what `syncReviewsForBusiness()` in `src/services/reviews/syncReviews.ts`
already correctly uses: `allReviews.filter(r => !r.response)`).

> **Related, out-of-scope finding (flagged, not fixed):** two *other*, unrelated
> API routes — `src/app/api/n8n/sync-reviews/route.ts` and
> `src/app/api/dashboard/stats/route.ts` — also reference a `replyText` field on
> the `Review` model that doesn't exist in the schema. These are n8n-automation
> and dashboard-stats endpoints, not the audit-scoring code path this task asked
> us to fix, so per "do not modify unrelated modules" they were left alone. They
> should be corrected in a follow-up pass since they will silently return
> "always empty reply" data the same way the audit code did.

### 4.2 Review count mismatch (74 on website vs. 78 in report) — root causes

There is no single line of code that "adds 4 fake reviews." The count difference
comes from how the review pipeline works:

1. **Reviews are a locally cached copy, not a live query.** `Review` documents are
   fetched from Google via SerpApi and upserted into MongoDB
   (`syncReviewsForBusiness()` in `src/services/reviews/syncReviews.ts`). The sync
   is `findOneAndUpdate(..., { upsert: true })` — it **adds and updates** reviews,
   but it **never deletes** a `Review` document if that review was later removed
   or hidden on Google (e.g., the reviewer deleted their review, or Google removed
   it for policy reasons). Over time, the local cache can retain reviews that no
   longer exist on the live profile, making the audit's count drift *higher* than
   the live website widget.
2. **The audit caps analysis at `MAX_REVIEWS_PER_AUDIT` (default 100).** If a
   business has more than 100 reviews, only the most recent 100 (by `createdAt`)
   are analyzed. This caps the audit count *lower* than reality for high-volume
   businesses — the opposite direction, but worth knowing.
3. **Website review widgets and Google's own SerpApi-scraped review list are two
   independently-cached views of the same underlying Google data.** Google's own
   aggregate "review count" badge (shown on Maps/Search) updates on a different
   cache cycle than the enumerable list of individual reviews SerpApi can scrape
   page by page. A few reviews' worth of lag between the two is a known,
   external (Google/SerpApi-side) behavior, not a bug in this codebase.
4. **Fallback provider ID for reviews without a stable `review_id`.** When SerpApi
   doesn't return a `review_id`, `SerpApiGoogleProvider` builds a fallback ID from
   `data_id + iso_date`. Two different reviews posted on the same calendar day by
   different reviewers, with no `review_id`, would collide onto the same
   composite key and overwrite each other on upsert — this would *undercount*,
   not overcount, but is a real edge case worth flagging.
5. **Duplicate detection is not possible today.** Nothing in the codebase
   currently checks for reviewer + text near-duplicates (e.g. a reviewer's
   comment resubmitted/edited and picked up twice with different metadata by
   SerpApi). This wasn't found to be actively happening in the code, but there is
   no explicit guard against it either.

**Why this wasn't "fixed" outright:** the only genuinely safe fix — reconciling
the local cache against the live Google list — would require fetching the *full*
review list (not capped at 100) and deleting any local `Review` documents no
longer present upstream. Doing that with the existing 100-review cap in place
would incorrectly delete legitimate reviews beyond the cap for any business with
more than 100 reviews, which is a worse bug than the one it would "fix." That is
a bigger, separate change (fetch-all + reconcile) and was intentionally **not**
implemented here to respect "do not redesign, minimum necessary changes." It's
called out above as a recommendation.

---

## 5. Problem 4 — Review Date Filters (implemented)

A new **Review Analysis Period** filter was added, with the four options from the
brief: **Last 7 Days, Last 15 Days, Last 30 Days, All Reviews (default)**.

### How it works end-to-end

1. **Selection:** `AuditForm.tsx` now has a "Review Analysis Period" dropdown
   (defaults to "All Reviews", so existing behavior is unchanged unless a user
   explicitly picks a shorter window).
2. **Request:** the selected value is sent as `reviewPeriod` in the
   `POST /api/audit` body. The API (`src/app/api/audit/route.ts`) validates it
   (`'7' | '15' | '30' | 'all'`) and stores it on the new `Audit.reviewPeriod`
   field (`src/models/Audit.ts`).
3. **Single filter point:** in `auditService.ts`, right after reviews are loaded
   and formatted, `filterReviewsByPeriod()` (new, in `seoAnalyzer.ts`) trims the
   review list down to the selected window **before** anything else runs:

   ```ts
   const reviewPeriod = normalizeReviewPeriod(audit.reviewPeriod);
   const formattedReviews = filterReviewsByPeriod(allFormattedReviews, reviewPeriod);
   ```

   Because every downstream calculation — `calculateReviewMetrics` (review count,
   average rating, response rate, sentiment %), `calculateReviewQualityScore`,
   `analyzeReviewKeywords`, `generateNativePriorityFixes`,
   `calculateBusinessIntelligence`, and the final score formula itself — takes
   `formattedReviews` as input, **the filter automatically applies to report
   generation, unanswered-review calculation, sentiment calculation, and the
   final score**, with no need to touch each of those functions individually.
4. **Display:** the selected range and analyzed count are stored as
   `audit.auditData.reviewAnalysisPeriod` and shown as a banner —
   `"Review Analysis Period: Last 7 Days · Total Reviews Analyzed: 12"` — in:
   - the in-app report (`AuditReportGrexa.tsx`)
   - the downloaded PDF (`reportHtml.ts`)
   - the public shared-report page (`src/app/reports/[token]/page.tsx`)
5. **"All Reviews" is a true no-op.** `filterReviewsByPeriod(reviews, 'all')`
   returns the input array unchanged, and `Audit.reviewPeriod` defaults to
   `'all'`, so any audit that doesn't explicitly opt into a shorter window behaves
   exactly as before this change.

### What was intentionally *not* built

- **Changing the period on an already-completed audit / re-running with a new
  filter** was not added as a UI affordance (e.g. no "change period" control on
  the results page). The brief's requirements ("must affect report generation,
  downloaded formats, review analysis, unanswered-review calc, sentiment calc")
  are all about a single audit run, and the selector at audit-creation time
  satisfies that without adding new re-run/edit UI, which would have been a
  larger, non-minimal change. Running a new audit with a different period is
  fully supported (just pick a different option and click "Generate Audit"
  again).

---

## 6. Files modified and why

| File | Reason |
|---|---|
| `src/services/audit/seoAnalyzer.ts` | Removed the non-GBP "WhatsApp Connected" scoring bug; added `buildScoreBreakdown()`, `filterReviewsByPeriod()`, `normalizeReviewPeriod()`, `REVIEW_PERIOD_LABELS`; added `totalTargetKeywords`/`totalMentionedKeywords` to `analyzeReviewKeywords()`'s return so the breakdown can report accurate keyword counts. |
| `src/services/audit/auditService.ts` | Fixed the `replyText` → `response` bug (unanswered-review miscalculation); added the review-period filter as the single point all review-based calculations flow through; computed and attached `scoreBreakdown` and `reviewAnalysisPeriod` to the stored audit result. |
| `src/models/Audit.ts` | Added `IScoreCriterion`, `IScoreBreakdown`, `IReviewAnalysisPeriod`, `ReviewPeriod` types; added `scoreBreakdown` / `reviewAnalysisPeriod` to `IAuditData`; added `reviewPeriod` field to the `Audit` schema (default `'all'`). |
| `src/app/api/audit/route.ts` | Accept and validate an optional `reviewPeriod` field on audit creation; persist it on the new `Audit` document. |
| `src/components/audit/AuditForm.tsx` | Added the "Review Analysis Period" dropdown (7/15/30/All) to the audit-creation form. |
| `src/components/audit/AuditReportGrexa.tsx` | Added the "Review Analysis Period" banner and the "How Your Score Was Calculated" transparent breakdown section (the live V7 report component). Replaced the vague "Based on 25+ parameters" copy with the real, accurate weight formula. |
| `src/lib/pdf/reportHtml.ts` | Mirrored the same two additions (review-period banner + score breakdown) into the server-rendered HTML used for the downloadable PDF, so the PDF matches the in-app report. |
| `src/app/reports/[token]/page.tsx` | Added a condensed review-period banner + score breakdown section to the public shared-report page for consistency across all report surfaces. |
| `docs/AUDIT_SCORING.md` | This document. |

**Not modified (explicitly out of scope):**
- `src/components/audit/AuditReportV7.tsx` — dead code, not rendered anywhere.
- `src/app/api/n8n/sync-reviews/route.ts`, `src/app/api/dashboard/stats/route.ts` —
  have a similar `replyText` field-name issue but are unrelated automation/stats
  modules, not the audit scoring path.
- The 4-field permanent-`Unknown` GBP-OAuth limitation in Profile Completeness —
  documented above as a recommendation, not a "clearly incorrect" bug to silently
  patch by fabricating data.
- Full duplicate/stale-review reconciliation for Problem 3 — would require
  removing the 100-review cap first; flagged as a follow-up, not implemented.

---

## 7. Manual testing steps

**Setup**
1. `npm install --legacy-peer-deps` (the repo's `next-auth`/`nodemailer` versions
   need `--legacy-peer-deps` to resolve; this is pre-existing and unrelated to
   this change).
2. Populate `.env.local` with at least `MONGODB_URI`, `JWT_SECRET`,
   `NEXTAUTH_SECRET`, `SESSION_SECRET`. `SERPAPI_KEY` is optional — without it,
   review sync falls back to `MockGoogleProvider`, and geo-grid ranking falls back
   to a fixed placeholder rank, which is fine for testing the scoring/UI changes.
3. `npm run dev`, plus `npx inngest-cli@latest dev` in a second terminal (the
   audit job runs through Inngest).

**Test 1 — Score breakdown is no longer a black box**
1. Create/select a business, go to Audits → Run New Audit → Generate Audit.
2. Once the audit completes, confirm a new **"How Your Score Was Calculated"**
   card appears with 4 rows (Profile Completeness, SEO Optimization, Review
   Quality, Review Keyword Coverage), each showing `earned/max points`, a
   progress bar, a plain-language reason, and a data source line.
3. Confirm the 4 `earnedPoints` values sum to the overall score shown at the top
   of the report (rounding may cause a ±1 difference, which is expected and
   called out in the formula string).
4. Click "Download PDF" and confirm the same section appears in the PDF.
5. Click "Share", open the generated link in a new/incognito tab, and confirm a
   condensed version of the same breakdown appears there too.

**Test 2 — WhatsApp bug fix**
1. On a Business profile with WhatsApp *not* connected but every other real GBP
   field filled in, run an audit.
2. Confirm the Profile Completion checklist no longer contains a "WhatsApp
   Connected" row, and that Profile Completeness is no longer penalized for it.

**Test 3 — Unanswered-review bug fix**
1. In MongoDB, find a `Review` document for a test business and set its
   `response` field to a non-empty string (or use the in-app "Reply" flow on a
   review in Reviews → reply → approve/post).
2. Re-run an audit for that business (or trigger `POST /api/reviews/fetch` then a
   new audit).
3. Confirm `Response Rate` in the report reflects that reply (previously it would
   always show `0%` regardless of real replies).

**Test 4 — Review date filters**
1. In MongoDB, seed a test business with reviews spread across various dates:
   some within the last 7 days, some 10–20 days old, some 40+ days old.
2. Run an audit with "Last 7 Days" selected. Confirm:
   - The "Review Analysis Period: Last 7 Days · Total Reviews Analyzed: N" banner
     shows only the reviews within that window.
   - `Total Reviews`, `Avg Rating`, `Response Rate`, sentiment percentages, and
     the Review Quality / Review Keyword Coverage score-breakdown rows all
     reflect only the filtered set (compare against manually filtering the same
     reviews in MongoDB).
3. Repeat with "Last 15 Days" and "Last 30 Days" and confirm the counts change
   accordingly and match expectations.
4. Run an audit with "All Reviews" (the default) and confirm the numbers exactly
   match what the same business would have produced *before* this change (i.e.
   no regression for the default path).

**Test 5 — Regression check**
1. Run `npx tsc --noEmit` from the repo root — should show no new errors beyond
   the pre-existing, unrelated `src/lib/pdf/browser.ts` Chromium type errors
   (present before this change too).
2. Spot-check an existing audit created before this change still renders
   correctly (it won't have `scoreBreakdown`/`reviewAnalysisPeriod` yet — the UI
   is written to simply omit those sections when the fields are absent, so old
   audits degrade gracefully rather than erroring).

---

## 8. Known limitations / assumptions

- The score breakdown reflects the **current** scoring formula/weights exactly;
  it does not change what is scored beyond the one confirmed bug fix (WhatsApp).
- The four permanently-`Unknown` GBP-OAuth-only checklist fields still cap
  Profile Completeness below 100% for every business, by design — see §3.2.
- Review count mismatches against a business's own website widget cannot be
  fully eliminated without (a) removing the 100-review analysis cap and (b)
  adding a "delete local reviews not present in the latest full sync" reconcile
  step — both are follow-up work, not part of this change (see §4.2).
- The Review Analysis Period filter is set once, at audit-creation time; there is
  no "change filter and reprocess this audit" control on an existing completed
  audit — the user re-runs a new audit with a different selection instead.
- Testing above assumes a local MongoDB and Inngest dev server; SerpApi-dependent
  behavior (live review sync, geo-grid ranking) was not live-tested against the
  real SerpApi service in this environment (no API key configured here), but the
  code paths exercised by the fixes above (`ownerReply`, `WhatsApp Connected`,
  review-period filter, score breakdown) do not depend on SerpApi and were
  verified via TypeScript compilation and code review.
