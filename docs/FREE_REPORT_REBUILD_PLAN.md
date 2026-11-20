# Free Report Rebuild

Status (20 Nov 2026): **phases 0–4 built and tested on `dev`, not yet committed or live.** Next: commit (only the files in §A.3 — see §A.6 item 7), push to `dev`, run ~10 real free reports on `dev` and check them by hand (incl. `facts.timings`), then PR to `main`.

This file has two parts:
- **Part A — what was built** (start here next time): flow, files, settings, versions, test results, open items, how to check a report.
- **Part B — the original plan** (§1–9): the evidence and reasoning behind it.

---

# Part A — What was built

## A.1 History in short
| Date | What happened |
|---|---|
| 16 Nov | Commit `5b77207` made free-report keywords come from website services. Competitors went wrong (searches like "follow us bengaluru", "p1 25 near me"). |
| 18 Nov | Fix 1 `9d6b681` (competitors from the Google category) went live. |
| 19 Nov | Customers complained (food and cashew businesses shown factories). Both commits were reverted on `dev` (`597d959`, `1412181`, not pushed). |
| 19–20 Nov | 22 real free reports (Nov 18–19) exported from production and checked one by one — Part B §1. This rebuild was designed from them. |

## A.2 The flow now (free report = `audit.fastMode`)
| Step | What it does | Falls back to |
|---|---|---|
| **S0 Real listing** | One Maps search for the business's own name at its pin; trusted **only on a Place ID match**. Gives the real primary + extra categories, description, hours, photos, booking link. Saved on the business 30 days. | Sign-up data |
| **Category** | Owner's own choice (`business.userDefinedCategory`, set in intake / settings) → real listing → type saved at sign-up → Google place types → "Local Business" | — |
| **S1 Understanding (AI)** | Groq reads listing, name, description, website (if any) → industry (Google's 19 groups), served how (storefront / service-area / hybrid / online), offered (services / products / both / made-to-order), trade, offerings, customer search terms. **Code checks every answer against the evidence** (drops invented offerings, "best/near me", brand name, kind-only words like "manufacturer"; a hidden address is never a storefront). Saved per business (same inputs → same answer, 30 days). | Low confidence / failure → category rules |
| **S2/S3 Keywords** | From the terms: city, "near me", "shop" (products), "manufacturer / wholesaler" (makers), max 2 clean nearby areas. **One volume lookup** for all; the 6 most-searched rank-checked, one per term first. Main ranking phrase = most-searched of the 3 core terms. | Old category keywords (`buildFreeReportKeywords`) |
| **Ranking** | Main phrase from 3 points (pin, 1.5 km E, 1.5 km S) + picked phrases from the pin. | "Not measured", never "not found" |
| **Competitor search** | All searches + 2 trade-phrase searches; widens to service areas / rings when too few found — counting only businesses whose Google category the AI named as same trade (exact names). | Word rules |
| **S5 Competitor judge (AI)** | One Groq call judges up to 25 businesses above + 10 below: same trade yes / no / unsure + reason. Only "yes" shown. The target's own specific category is never "no". | Option A rules; no trade known → **no competitors shown, never everyone** |
| **Like yours nearby** | When fewer than 3 confirmed competitors rank above, AI-confirmed same-trade businesses ranked **below** are shown in their own section (never counted as "ahead"). | Section hidden |
| **Reviews** | Gap only from confirmed competitors; no gap from fewer than 2. | No comparison |
| **Write-up (AI)** | Unchanged; told volumes are nationwide. | Facts-only report |
| **Reuse** | A finished free report is reused for 30 days only if made by the current `REPORT_LOGIC_VERSION`. | Fresh report |

## A.3 Files
New:
- `src/services/audit/ownListing.ts` — S0 (pure helpers + fetch).
- `src/services/audit/businessUnderstanding.ts` — S1 prompt, checks, cache, Groq call.
- `src/services/audit/understoodKeywords.ts` — S2/S3 candidates + pick.
- `src/services/audit/competitorJudge.ts` — S5 prompt, checks, cache, Groq call.
- `src/services/audit/reportLogicVersion.ts` — `REPORT_LOGIC_VERSION` (cache + reuse).
- Tests: `tests/workflow/audit-own-listing.test.ts`, `audit-business-understanding.test.ts`, `audit-competitor-judge.test.ts`, `audit-report-honesty.test.ts` (+ cases added to `audit-competitor-relevance.test.ts`).

Changed:
- `src/services/audit/auditService.ts` — wiring of every step, `facts.category / understanding / competitorJudge / similarNearby / timings`, website read in parallel, finding texts.
- `src/services/audit/competitorRelevance.ts` — backup rules: strict category mode, `tradeFromText`, trade groups (dental, salon, food/tiffin, cashew, dry fruits…), business-type words are not a trade.
- `src/services/audit/seoAnalyzer.ts` — business-type categories are weak (product from the name: "Shree Cashew Industries" → "Cashew Manufacturer"); review gap needs ≥ 2 competitors.
- `src/services/audit/facts.ts` — businesses ranked below keep category / listing text / rating / reviews.
- `src/services/intel/websiteExtract.ts` — `isBookingLink` (Facebook / WhatsApp are not booking pages).
- `src/services/intel/websiteIntelligence.ts` — `WEBSITE_INTEL_LOGIC_VERSION` 8.
- `src/services/leads/freeReport.ts` — 30-day reuse only for the current logic version.
- `src/models/Business.ts` — new fields `googleListing`, `businessUnderstanding`, `competitorJudgement` (only these 3; other changes in that file are not part of this work).
- `src/components/audit/FreeReportView.tsx` — "Other businesses like yours nearby"; score tile "X of Y fields we could check".
- `src/components/audit/ConsultantSections.tsx` — "Searches / mo (nationwide)" + explanation.
- Not changed on purpose: the connected monthly report.

## A.4 Settings and versions
| Name | Where | Meaning |
|---|---|---|
| `GROQ_API_KEY` | env | All Groq calls (33 places). Changing account = change this, `pm2 restart growwmatics --update-env`. |
| `FREE_REPORT_AI_MODEL` | env (optional) | Model for S1 + S5 only; default = `GROQ_MODEL` (`openai/gpt-oss-120b`). |
| `REPORT_LOGIC_VERSION` | `reportLogicVersion.ts` = 15 | Bump when report logic changes → rank cache and 30-day reuse rebuild. |
| `UNDERSTANDING_VERSION` / `JUDGE_VERSION` | their modules = 1 | Bump when a prompt or its checks change → saved AI answers rebuild. |
| `WEBSITE_INTEL_LOGIC_VERSION` | `websiteIntelligence.ts` = 8 | Bump when website extraction changes. |
| Limits | modules | 6 rank checks, 2 areas, 35 businesses judged (25 above + 10 below), AI call 15 s + one 5 s retry, caches 30 days (listing, understanding, judge), rank cache 7 days. |

## A.5 Results on the 21 real businesses (Nov 18–19 reports)
| Check | Result |
|---|---|
| Real listing found (Place ID) | 21 / 21; category changed for 20 / 21 |
| Understood by AI | 19 / 21 (2 with no website + no description → rules) |
| Rank checks with real search volume | 95 / 95 (before: 48 / 222 keywords) |
| Competitors, full new flow with real pins | every one shown was same trade |
| Speed, all new steps | 5.8 s when Groq is not rate-limited |

| Business | Before (category / main search / competitors) | Now |
|---|---|---|
| Inspiron Psychological | Medical Clinic / "medical clinic" / medical clinics, gastro surgeon | Mental health service / "psychologist bengaluru" / Cadabam's Mindtalk, The Mind Research Foundation |
| VP Brokerskart | Banking and Finance / banks | Property investment company / Property Share, Silverline Realty, MN Realtors, Abrars Estates |
| iPlanet Care (Apple) | Services / "care company" / home nursing | Mobile phone repair shop / "mobile phone repair bengaluru" |
| Dabba Central | Breakfast Restaurant / 71 cafés | Tiffin center / Desi Tiffin Box + nearby: Mealdudes, Tiffin Centre, Rasoi 24×7 |
| Zuper LED | Manufacturer / "manufacturer", "p1 25 near me" / steel, wire factories | "led screens bengaluru"; #1 → nearby: Auro LED, Pixelspot LED Video Wall |
| Pooja Enterprises | Manufacturer / 59 random factories | Cleaning products supplier; #1 → nearby: Cityvac, Rentokil, Abhi Aquatek, Ashreyan, Ecodia |
| Sanctum Technologies | Services / "services mps" / computer stores | Computer Rental Agency / "laptop rental bengaluru" / All Time Support, Techvity |

## A.6 Known limits and open items
1. **Groq is on the free plan (blocking quality at volume).** Production key: 8,000 tokens/min, ~200,000 tokens/day, 1,000 requests/day. One report ≈ 15,000 tokens → about **13 reports/day get full AI**; the rest use the rules (still far better than before) or a facts-only write-up. The Developer upgrade said "temporarily unavailable due to high demand" (20 Nov). Decision: keep Groq, upgrade the same account when it opens — no code change. Parked alternatives: gpt-oss-120b on Cerebras / OpenRouter (~$0.007/report); Gemini 2.5 Flash-Lite was shut down 16 Oct 2026, 3.5 Flash-Lite ~$0.015/report; Chinese APIs rejected (data stored in China).
2. **Search volumes are nationwide** (Google Ads country level), now labelled so. City-level volume + Google keyword ideas were proposed (+$0.18/report) and declined for now.
3. **The AI judge is slightly strict** (rejected "Household chemicals supplier" for a cleaning-products supplier, "Bangalore Home Tiffin Services" listed as a Kerala restaurant). Better than wrong ones; recheck in the `dev` test.
4. **Thin businesses** (vague category, no website, no description) and businesses entered **without picking the Google listing** (no Place ID / pin) get weaker reports.
5. **Backup word lists** (`competitorRelevance.ts`, `seoAnalyzer.ts`) still exist — used only when the AI fails or is unsure.
6. **Connected monthly report** does not use S0–S5 (on purpose, for now).
7. **Committing:** another session edited ~35 other files in the same working copy (auth, admin, partners, WhatsApp, `shadowAccount.ts`, `tests/workflow/admin-crm.test.ts`, part of `Business.ts`). Commit only the files in §A.3, and in `Business.ts` only the 3 new fields.
8. Pre-existing, unrelated: integration test "every model has a purge decision" fails; `scripts/backfill-messaging-suppression.ts` fails typecheck (other session).

## A.7 How to check a customer's report
Every free report saves, under `auditData.facts`:
- `category` — `{ used, source, signup, googleListing }`: which category was searched and why.
- `understanding` — trade, offerings, search terms, confidence, keywords picked, main term (or why it was not used).
- `competitorJudge` — `'ai'`, `'reused'` or `'rules (…reason)'`.
- `similarNearby` — the "like yours nearby" businesses.
- `timings` — ms for listing lookup, website wait, understanding, keyword volume, judge.
- `otherBusinessesAhead` — every business not counted as a competitor, with the reason.

The business itself keeps `googleListing`, `businessUnderstanding` and `competitorJudgement` (reused for 30 days while inputs are the same).

How the 22 reports were exported (read-only, for a future check): run the export script on the droplet, upload privately to Spaces, download with the local Spaces keys, delete from Spaces — commands are in this session's history; the export file lives only in `~/Downloads/free-reports-export/` and should be deleted after use (customer data).

---

# Part B — The original plan

## 1. Why

On Nov 18–19, 22 free reports were checked one by one against their saved data (searches, every business Google returned, keywords, reviews, profile score, issues, cost):

| Result | Reports |
|---|---|
| Competitors right | 6 |
| Partly right | 6 |
| Wrong | 9 |
| Empty | 1 |

The causes, with the number of reports each one hit:

| # | Problem | Reports | Example |
|---|---|---|---|
| 1 | **We search with the wrong category.** The form saves Google Places' rough type ("Services", "Manufacturer", "Medical Clinic"), not the category the owner chose on the profile. | 15 of 21 | Psychology centre searched as "medical clinic" (real: "Mental health service"); property investor as "banking and finance" (real: "Property investment company") |
| 2 | **Half the keywords measure nothing.** 114 of 222 are micro-area phrases; 109 of those have no search volume. | all | "Banking and Finance Vannerpet Officers Colony", "Print company Totadaguddadahalli" |
| 3 | **Broken and junk phrases.** | 8 | "Banking and near me", "Best Banking and Bengaluru", "follow us bengaluru", "p1 25 near me" |
| 4 | **A business-type category is treated as a trade.** "Manufacturer" matches every factory. | 3 | LED maker and food processor shown steel, furniture and tailoring firms |
| 5 | **Word matching leaks.** "health" lets in a women's clinic for a psychologist; "hotel" shows hotels for a houseboat. | 6 | |
| 6 | **Review gap from the wrong competitors**, plus a bug. | all wrong-competitor reports | Tiffin service "538 reviews behind" big restaurants; Hula Global shows gap 171 while saying "not enough data" |
| 7 | **"100% complete" while 8–10 of 16 fields are Unknown.** | 14 of 22 | |
| 8 | **Two issues look wrong.** | 10 and 8 | "Website has a booking page; listing has no booking link"; "List the 25 services your website describes" (the "services" are menu text) |
| 9 | **A finished report is reused for 30 days**, so a customer who asks again gets the same wrong report. | all | |

Cost today: $4.86 for 22 reports, about $0.22 each. Most of it is search-volume lookups ($0.09 each); Maps searches are $0.002 each.

**Websites: 10 of the 22 businesses had no usable website** (7 none, 3 did not load). Surveys put Indian small businesses without a website at roughly 30–65%. So the report must work fully from the Google profile alone; the website is extra evidence when it exists, never required.

## 2. Goal

A free report that is right for **every kind of business**: the right trade, the phrases its customers really search, real competitors, and honest numbers. Same flow for all; what changes per business is decided from the business's own data, not from word lists.

### Principles
- **Google's data decides the numbers.** Category, rank, search volume and review counts come only from Google. The AI never makes up a number.
- **The AI decides the meaning.** What the business does, what customers search for, and whether a business found is the same trade. That is the change from `KEYWORD_SYSTEM_PLAN.md` ("AI only explains"): word lists cannot cover every trade.
- **Every AI answer is checked.** It must come from the business's own data, it is saved per Google listing, and the rules built so far are the backup when the AI fails.
- **No guess is shown as a fact.** Unknown stays unknown; an estimate is labelled as one; no confirmed competitor means none shown.
- **No website needed.** Every step works from the Google profile; the website only adds evidence.
- **No category list in the code.** Google has about 4,000 business categories, changes them often, and they differ by country. The code never lists them; it reads the business's own category and Google's own groups, and the AI understands the rest.

## 3. Every kind of business

### 3.1 What Google itself defines
- **4,044 Business Profile categories as of 1 Nov 2026** (daltonluka.com list; one alphabetical list, no groups, two added since May). Google changes them often and they vary by country; many are India-specific ("Aadhaar center", "CBSE school", "Bangle shop", "Chettinad restaurant"). A profile has **1 primary + up to 9 additional** categories.
- **Business-type categories come in many forms:** "Exporter", "Cotton exporter", "Clothing wholesaler", "Agricultural machinery manufacturer" — the product is often in the category, sometimes only in the name or description.
- **Official list for checking, not for deciding:** the Business Profile API returns Google's own category list per country (India). It is saved as data, refreshed monthly, and used only to (a) check that every category the AI names as "same trade" is a real Google category, and (b) map a category to one of the 19 groups below. No category is ever written into the code.
- **3 profile types** (Google's guidelines): **storefront** (customers come to the address, needs permanent signage), **service-area** (the business goes to customers; address hidden; up to 20 areas, by city / PIN, not a radius), **hybrid** (both).
- **19 groups of place types** (Google Places API, about 500 types): Automotive, Business, Culture, Education, Entertainment and Recreation, Facilities, Finance, Food and Drink, Geographical Areas, Government, Health and Wellness, Housing, Lodging, Natural Features, Places of Worship, Services, Shopping, Sports, Transportation. Plus generic types ("establishment", "food", "health", "point_of_interest") that say nothing about the trade.

### 3.2 How the report describes a business: 3 answers, not a list
Instead of a fixed list of kinds, every business is described by three answers. Each comes from Google's data first; the AI fills a gap only from the business's own evidence.

| Answer | Values | Comes from | Changes |
|---|---|---|---|
| **1. Industry** | one of Google's 19 groups | the place types on the listing (already saved at sign-up); AI only when they are all generic | which words and synonyms mean the same trade |
| **2. How customers are served** | storefront / service-area / hybrid / online-remote | the Google profile: address shown or hidden, service areas set; AI for online-only businesses (software, agencies, exporters) | **where** competitors and rankings are checked |
| **3. What is offered** | services / products / both / made-to-order (maker, trader) | category, description, website; AI decides | **how** the keywords are phrased |

What each answer does to the report:

| Served how | Rank check | Competitors looked for in |
|---|---|---|
| Storefront | 3 points around the address | nearby (grid + 1–2 nearest areas with searches) |
| Service-area | the business's service areas (from Google), else its city | those areas / city |
| Hybrid | both of the above | both |
| Online-remote | city-level search | city, then state |

| Offered | Keyword shapes |
|---|---|
| Services | "<service> <city>", "<service> near me", "<service> in <area>" |
| Products (shop) | "<product> shop <city>", "<product> store near me", "buy <product> <city>" |
| Both | the two above, one per main offering |
| Made-to-order (maker / trader) | "<product> manufacturer <city>", "<product> supplier <state>", "<product> wholesaler <city>" |

### 3.3 The 22 real reports in this model

| Business | Industry | Served | Offered | Was searched as | Should be searched as |
|---|---|---|---|---|---|
| Inspiron Psychological | Health and Wellness | storefront | services | medical clinic | psychologist / counselling indiranagar |
| VP Brokerskart | Finance | online-remote | services | banking and finance | property investment bengaluru |
| Sri Annapurna … Industries | Food and Drink | storefront | made-to-order | manufacturer | food processing / its product + manufacturer |
| Zuper LED | Business | online-remote | made-to-order | manufacturer, "p1 25 near me" | LED display manufacturer bengaluru |
| Spark Clean | Services | service-area | services | clean cleaning services | deep cleaning / house cleaning mira bhayandar |
| Dabba Central | Food and Drink | storefront | products | breakfast restaurant | tiffin service btm layout |
| Coco Houseboats | Lodging | storefront | services | hotel | houseboat alleppey |
| Genius Infoway | Shopping | storefront | products | electronics store | computer store / laptop shop bengaluru |
| iPlanet Care | Services | storefront | services | care company | apple service center bengaluru |
| Hula Global | Business | online-remote | made-to-order | qc agency, "search near me" | garment exporter bengaluru |
| Grow itech | Education | storefront | services | itech company | training institute coimbatore |
| CHAIR WORLD | Shopping | storefront | products | furniture store | office chairs / office furniture surat |

This table becomes the hand-checked answer key for the tests (§7).

## 4. New flow

### S0. Read the real Google profile (new)
- One Maps search for the business's own name at its pin, matched by Place ID: the real primary category, extra categories, Google's description, hours, photos, booking link, rating and review count.
- Fallback: the Google Places details already fetched by the form.
- These fields also fill the profile checklist (§S7), so far fewer fields are Unknown.
- Also read: whether the address is shown or hidden and which service areas are set (answer 2 in §3.2), and up to 5 Google review texts from the Places details call (customers name what they bought: "the kaju quality is great", "counselling for my son").
- Cost: one Maps search, $0.002; review texts come with the Places details call already made.

### S1. Understand the business (AI, new)
Input, strongest first — every item is optional except the Google profile:
1. Google profile: primary + extra categories, place types, description, served how;
2. the business name;
3. up to 5 Google review texts;
4. the website, when there is one and it loads (title, description, pages read);
5. city and area.

With no website, steps 1–3 and 5 decide. A business with only a name and a vague category gets a **low-confidence** answer: the report then uses the category as searched by today's rules and says competitors could not be confirmed, rather than guessing.

Output (strict JSON):
- **industry / served how / offered** — the 3 answers in §3.2 (industry and served-how taken from Google when Google states them; the AI may not override Google);
- **trade** — one line, e.g. "cashew processing and wholesale";
- **offerings** — the real products / services, each with where it came from (Google category, description, website page), at most 8. Menu text such as "Follow Us" or "P1.25" is never an offering;
- **search phrases** — up to 12, phrased the way customers search;
- **same-trade categories** — Google categories that count as competitors;
- **confidence** — high / medium / low.

Checks:
- Every offering must appear in, or follow directly from, the input data. A word that is nowhere in the input is dropped.
- Saved per Google listing for 30 days; the same business always gets the same answer.
- If the AI fails or answers badly → today's rules (Google category → place types → description → name → website), as built in option A.

### S2. Build the keywords
From S1's phrases plus the keyword shapes for what the business offers (§3.2):
- offering + city ("deep cleaning mira bhayandar");
- offering + "near me";
- for a few offerings, offering + one nearby area — only areas Google reports searches for, at most 2;
- for maker / trader: offering + manufacturer / supplier / wholesaler + city or state.

Never: "best / top …", a cut-off phrase ("Banking and near me"), the business's own name, website menu text, or an area with no searches. Every phrase is checked to be a complete phrase.

### S3. Search volume
- One volume lookup for every candidate (country and city), as now.
- Pick **5–6 phrases** by volume × relevance, one per offering first.
- A phrase with no measured volume is used only when nothing else exists, and shown as "Google reports too few searches".
- A state-level estimate is never shown as the phrase's own volume; it is labelled "estimate for <state>" or left out.

### S4. Ranking
- The main phrase from 3 points (as now); the other picked phrases from the business's pin.
- The 1–2 nearby areas with real searches, instead of 7 empty ones.
- A vague phrase never becomes a headline win. "#1 for manufacturer near me" searched at their own door is not shown as a result.

### S5. Competitors (AI judge, new)
- Collect every business found in S4, plus 2 searches on the trade phrase. Where to look follows how the business serves customers (§3.2): nearby for a storefront, its service areas for a service-area business, city then state for online-remote.
- One AI call with each business's name, Google category, extra categories and listing text → **same trade: yes / no / unsure**, with a short reason.
- Shown: "yes" only, ordered by how often they rank above the business. "Unsure" and "no" go under "other businesses shown above you".
- The rules from option A run as the backup when the AI fails. When no trade is known at all, no competitors are shown, never everyone.

### S6. Reviews
- Compared only with confirmed competitors.
- Fix: when there is no comparison, there is no gap (the Hula bug).

### S7. Profile completion
- Fields come from S0 where Google shows them.
- The headline shows what was checked: "86% — 6 of 7 fields we could check". Never "100%" alone while most fields are unknown.

### S8. Issues list
- Booking-link issue: check the detection on the 10 reports that showed it; show the issue only when a booking page is really found.
- "List your website's services" uses S1's offerings, not raw website menu text.

### S9. AI write-up
Unchanged. It now gets correct competitors and keywords, so its advice follows.

### S10. Reuse
- A free report is reused within 30 days only if the same version of these rules made it (built in option A).
- Customers who got a wrong report get a fresh one when they ask again.

## 5. Fallbacks, all in one place

| Step | Normal | If it fails |
|---|---|---|
| S0 Google profile | own-listing Maps search | form's Places details → saved category |
| S1 Understanding | AI | rules: category → place types → description → name → website |
| S2 Keywords | S1 phrases + kind shapes | category + city / near me |
| S3 Volume | Google Ads volume | phrases kept, shown "volume unavailable"; never a guess |
| S4 Ranking | DataForSEO Maps | "not measured", never "not found" |
| S5 Competitors | AI judge | rules from option A → none shown |
| S6 Reviews | confirmed competitors only | no comparison shown |
| S9 Write-up | AI | facts-only report (as now) |

## 6. Cost per report

| Item | Today | After |
|---|---|---|
| Own-profile search (S0) | — | $0.002 |
| AI understanding + competitor judge (S1, S5) | — | under $0.01 |
| Maps searches | ~13 × $0.002 | ~10–12 × $0.002 |
| Volume lookups | 1–2 × $0.09 | 1–2 × $0.09 (unchanged) |
| **Total** | **~$0.22** | **~$0.23** |

The volume lookups stay the main cost and are not changed.

## 7. How it is tested
1. **The 22 real reports** become the test set, with names and personal details removed. For each one we write down the right trade and 3–5 real competitors by hand. The new flow re-runs on their saved data and must match.
2. **One test per combination that occurs** in §3.2 (industry × served how × offered), with fixed AI answers, so the rules and fallbacks are tested without paying for AI. Each combination is tested twice: with a website and **without one**.
3. **AI-failure tests:** AI down, AI returns rubbish, AI names an offering not in the data → the backup runs and nothing invented is shown.
4. **A live run on `dev`** for 10 real businesses, at least one per "served how" and per "offered" value, at least 4 with no website, checked by hand before merging to `main`.

## 8. Build order
| Phase | What | Result |
|---|---|---|
| 0 | Ship option A (the safety net already built, uncommitted on `dev`) | no more random factory lists; wrong reports regenerate on request |
| 1 | S0 real profile + use the real category | fixes cause 1 (15 of 21 reports) |
| 2 | S1 AI understanding + S2/S3 keywords | right phrases, real volume, no junk |
| 3 | S5 AI competitor judge | right competitors for every kind |
| 4 | S6, S7, S8 fixes | honest reviews, score and issues |
| 5 | Tests in §7, live check, PR to `main` | |

Each phase is its own commit, tested, and shown to you before the next one.

## 9. Decisions (as of 20 Nov 2026)
1. Phase 0 (option A): built as the backup for phases 1–3; ships together with them.
2. The 3-answer model (§3.2): built.
3. Competitors: only AI "yes" shown; "unsure" / "no" listed as other businesses. Built.
4. One-tap "We understood you as … — Yes / Change" on the form: **not built** (open).
5. Connected monthly audit: **not changed**, by the owner's decision for now.
6. City-level volume + Google keyword ideas (+$0.18/report): **declined for now**.
7. AI provider: **stay on Groq**, upgrade to the paid plan when it opens (§A.6 item 1).
