/**
 * Defaults + helpers for the WhatsApp SALES AGENT (platform → lead nurture that
 * fires after a free audit). Client-safe (no server deps) so the super-admin UI
 * and the server both import from here.
 *
 * Everything the agent does is configurable by the super-admin (SalesAgentConfig):
 * enable/disable, the first-touch message, how long after the audit it's sent,
 * a follow-up drip with per-step delays, and the AI persona for live replies.
 */

// Relative + explicit .ts (not '@/') so this client-safe module also loads
// under Node's type-stripping test runner, matching the convention in
// services/nba/rules.ts. tsconfig has allowImportingTsExtensions.
import { ALL_FAQS } from './faqData.ts';

/** Variables available in every message template. */
export const SALES_TEMPLATE_VARS = [
  '{{name}}',        // lead first name
  '{{business}}',    // business name
  '{{rank}}',        // Google search rank
  '{{profile}}',     // profile completion %
  '{{seo}}',         // SEO score %
  '{{review}}',      // reviews & replies score %
  '{{competitor}}',  // top competitor name
  '{{keywords}}',    // missing keywords (comma list)
  '{{subscribeUrl}}',
  '{{shopUrl}}',
] as const;

export type SalesMessageMode = 'ai' | 'template';

/**
 * One structured use case the SHARE_USE_CASE / SHOW_VALUE / EDUCATE briefs
 * ground on. Every field optional so a half-filled entry is still usable.
 * `recommendedNextAction` is a free-text hint for the LLM ("move toward a
 * demo", "ask about their current follow-up process"), NOT an NBAAction enum
 * — the NBA engine still owns the actual decision.
 */
export interface SalesUseCase {
  name?: string;
  problem?: string;
  solution?: string;
  benefit?: string;
  idealCustomer?: string;
  recommendedNextAction?: string;
}

/**
 * Optional structured knowledge the NBA executor grounds ANSWER_QUESTION /
 * HANDLE_OBJECTION / SEND_PRICING / EDUCATE / SHARE_USE_CASE / SHOW_VALUE /
 * OFFER_SUBSCRIPTION / demo replies in — AND that the live persona
 * (composeAgentReply) and the lead-intelligence extractor get a compact
 * summary of (see buildKnowledgeContext / summariseKnowledge below).
 *
 * Every field is optional and empty by default — the executor NEVER invents
 * a fact. When a field the chosen action needs is empty, the executor falls
 * back safely (ask a qualification question, or hand to a human) rather than
 * hallucinating. Super-admins fill these in at /admin/sales-agent over time;
 * adding content here does not require any engine change.
 *
 * BACKWARD COMPATIBILITY: the original five fields (pricingResponse,
 * objectionResponses, useCases, faqs, educationPoints) keep their exact
 * shape and meaning. `useCases` additionally accepts the structured
 * SalesUseCase form — existing string[] configs still load and render.
 */
export interface SalesKnowledge {
  // --- Business context (new — grounds the persona + extractor) -------------
  /**
   * 2-4 sentence approved description of what GrowwMatics is, who it's for,
   * and the core problem it solves. Empty = the persona falls back to the
   * one-line generic description it uses today.
   */
  businessOverview?: string;
  /**
   * Who GrowwMatics is a good fit for — business type, size, buying signals,
   * and (optionally) poor-fit signals. Free text, a few lines.
   */
  idealCustomerProfile?: string;
  /** Short list of customer segments GrowwMatics serves (e.g. "Dental clinics", "Gyms"). */
  targetCustomers?: string[];
  /** Common business problems GrowwMatics addresses — one short phrase each. */
  customerProblems?: string[];
  /**
   * Approved service/offering summaries (name + what it does). Distinct from
   * useCases: this is the "what we offer" catalogue, useCases is the
   * "problem → solution → benefit" narrative.
   */
  services?: { name: string; description: string }[];
  /**
   * When and why a demo is offered, and what happens in one. Grounds the
   * demo-nudge brief. Empty = the generic "a real person will find a time"
   * nudge is used.
   */
  demoExplanation?: string;
  /**
   * How subscribing / getting started works (what unlocks, that payment
   * verification is the source of truth). Grounds OFFER_SUBSCRIPTION.
   */
  subscriptionExplanation?: string;
  /** Approved statements of what GrowwMatics does NOT do (honest scope limits). */
  limitations?: string[];
  /**
   * Free-text guidance on when the agent should hand a lead to a human
   * (beyond the deterministic triggers, which are unaffected). Advisory
   * context for the LLM only.
   */
  escalationRules?: string;

  // --- Original five fields (unchanged shape & semantics) ------------------
  /**
   * Exact, approved pricing text sent verbatim (after {{var}} rendering) for
   * a SEND_PRICING action. Empty = the executor does NOT state a price — it
   * asks a qualification question or routes to a human instead.
   */
  pricingResponse?: string;
  /**
   * Per-objection-type approved responses. Keys match Lead.objections[].type
   * (PRICE / DECISION_MAKER / TIMING / TRUST / FEATURE_GAP / OTHER). A
   * missing key for a detected objection = fall back to the generic persona
   * reply, never a made-up rebuttal.
   */
  objectionResponses?: Partial<Record<'PRICE' | 'DECISION_MAKER' | 'TIMING' | 'TRUST' | 'FEATURE_GAP' | 'OTHER', string>>;
  /**
   * Approved use cases for SHARE_USE_CASE / SHOW_VALUE grounding. Accepts
   * either the legacy plain-string form OR the structured SalesUseCase form
   * — normaliseUseCases() below flattens both to a consistent shape for the
   * briefs.
   */
  useCases?: (string | SalesUseCase)[];
  /** Approved Q&A pairs for ANSWER_QUESTION grounding (question hint + answer). */
  faqs?: { q: string; a: string }[];
  /** Approved feature/value explanations for EDUCATE. */
  educationPoints?: string[];
}

/** Flattens a mixed legacy/structured useCases array to structured entries. */
export function normaliseUseCases(useCases: (string | SalesUseCase)[] | undefined): SalesUseCase[] {
  if (!Array.isArray(useCases)) return [];
  return useCases
    .map((u): SalesUseCase | null => {
      if (typeof u === 'string') {
        const t = u.trim();
        return t ? { solution: t } : null;
      }
      if (u && typeof u === 'object') {
        const cleaned: SalesUseCase = {};
        for (const k of ['name', 'problem', 'solution', 'benefit', 'idealCustomer', 'recommendedNextAction'] as const) {
          const v = (u as any)[k];
          if (typeof v === 'string' && v.trim()) cleaned[k] = v.trim();
        }
        return Object.keys(cleaned).length ? cleaned : null;
      }
      return null;
    })
    .filter((u): u is SalesUseCase => u !== null);
}

/** One-line rendering of a use case for a compact grounding brief. */
export function useCaseLine(u: SalesUseCase): string {
  const bits = [
    u.name && `${u.name}:`,
    u.problem && `problem — ${u.problem}`,
    u.solution && `solution — ${u.solution}`,
    u.benefit && `benefit — ${u.benefit}`,
  ].filter(Boolean);
  return bits.join(' ');
}

/**
 * Compact, token-bounded plain-text summary of the configured knowledge —
 * fed to the live persona (composeAgentReply) and, in an even shorter form,
 * to the lead-intelligence extractor. Only non-empty fields appear. Caps
 * every list so a large config can't blow the prompt budget. Returns '' when
 * nothing is configured (callers then use their existing generic fallback).
 */
export function summariseKnowledge(
  k: SalesKnowledge | undefined,
  opts: { maxItems?: number; includeFaqs?: boolean } = {}
): string {
  if (!k) return '';
  const max = opts.maxItems ?? 6;
  const lines: string[] = [];
  const list = (label: string, items: (string | undefined)[] | undefined, n = max) => {
    const clean = (items || []).filter((s): s is string => !!s && !!s.trim()).slice(0, n);
    if (clean.length) lines.push(`${label}: ${clean.map((s) => s.trim()).join(' | ')}`);
  };

  if (k.businessOverview?.trim()) lines.push(`What GrowwMatics is: ${k.businessOverview.trim()}`);
  if (k.idealCustomerProfile?.trim()) lines.push(`Ideal customer: ${k.idealCustomerProfile.trim()}`);
  list('Serves', k.targetCustomers);
  list('Problems it solves', k.customerProblems);
  if (k.services?.length) {
    list('Services', k.services.slice(0, max).map((s) => (s?.name ? `${s.name} — ${s.description || ''}`.trim() : '')));
  }
  const ucs = normaliseUseCases(k.useCases);
  if (ucs.length) list('Use cases', ucs.slice(0, max).map(useCaseLine));
  list('Key points', k.educationPoints);
  if (k.demoExplanation?.trim()) lines.push(`Demo: ${k.demoExplanation.trim()}`);
  if (k.subscriptionExplanation?.trim()) lines.push(`Subscribing: ${k.subscriptionExplanation.trim()}`);
  list('Does NOT do', k.limitations);
  if (opts.includeFaqs && k.faqs?.length) {
    lines.push(
      `FAQs: ${k.faqs.slice(0, max).map((f) => `Q:${f.q} A:${f.a}`).join(' || ')}`
    );
  }
  if (k.pricingResponse?.trim()) {
    lines.push('Pricing: an approved pricing statement IS configured — the pricing action will send it verbatim; do not paraphrase or invent a number.');
  } else {
    lines.push('Pricing: NO approved price is configured — never state a price; say you will confirm exact pricing.');
  }
  return lines.join('\n');
}

export interface SalesFollowUp {
  /** Hours to wait (since the previous agent message) before sending this. */
  delayHours: number;
  mode: SalesMessageMode;
  template: string;
  aiSystemPrompt?: string;
  /** Only send if the lead hasn't replied since the last agent message. */
  onlyIfNoReply: boolean;
}

export interface SalesAgentConfigShape {
  enabled: boolean;
  firstMessage: {
    mode: SalesMessageMode;
    /** Minutes to wait after the audit completes before the first message. */
    delayMinutes: number;
    template: string;
    aiSystemPrompt: string;
  };
  followUps: SalesFollowUp[];
  /** Persona/instructions for live inbound replies (Phase 2 conversation). */
  agentSystemPrompt: string;
  subscribeUrl: string;
  shopUrl: string;
  /**
   * Optional grounded knowledge for the NBA executor. Empty object by
   * default — see SalesKnowledge. Absent on existing configs; the loader
   * fills in an empty object so callers can always read config.knowledge.*
   * without a null check.
   */
  knowledge: SalesKnowledge;
}

export const DEFAULT_FIRST_TEMPLATE =
`{{name}}, your business is currently at rank {{rank}}. 📉

That's like being on page 3 of Google—most customers never scroll that far.

Here's why your visibility is low:

1. *Profile ({{profile}}%)*: An incomplete profile is like a shop with half a board. Google ranks 100% complete profiles higher.
2. *SEO ({{seo}}%)*: You're missing key words like {{keywords}}. Without these, Google doesn't know what you sell.
3. *Reviews & Replies ({{review}}%)*: No recent activity makes the business look closed. Replying to reviews tells Google you are active.

Want to see how we can fix this and get you ahead of competitors like {{competitor}}?`;

export const DEFAULT_FIRST_AI_PROMPT =
`You are a friendly, sharp WhatsApp sales assistant for GrowwMatics AI, which grows local businesses on Google. You message a lead right after their free Google Business Profile audit. Goal: make them feel the problem and want to fix it with us — never pushy, always helpful.

Write ONE WhatsApp message. Rules:
- Start with the lead's first name.
- State their Google rank with a vivid, simple analogy (e.g. "page 3 of Google — most customers never scroll that far").
- Give EXACTLY 3 numbered reasons visibility is low, tied to the real numbers: Profile %, SEO %, Reviews & Replies %. One short sentence each with a relatable analogy. Name the missing keywords if given.
- End with a warm question offering to fix it and get ahead of a named competitor (if provided).
- WhatsApp formatting: *bold* with single asterisks, a few tasteful emojis. Tight. No markdown headers, no links.`;

export const DEFAULT_AGENT_PROMPT =
`You are the GrowwMatics AI WhatsApp sales assistant, continuing a chat with a local-business owner who just got a free Google audit. Be warm, concise, and genuinely helpful — like a knowledgeable friend, not a pushy salesperson.

Your goal: guide them to subscribe so we can fix their Google visibility (profile, SEO, reviews, ranking) and help them beat competitors.

Guidelines:
- Answer their questions using the audit context you're given (their rank, scores, competitors, missing keywords).
- Handle objections honestly; focus on outcomes (more calls, customers, higher ranking).
- When they show interest, share the subscribe link and offer to help them get started.
- Keep replies short and WhatsApp-friendly (*bold*, a few emojis). One question at a time.
- Never invent data. If unsure, say you'll help them check it in the dashboard.`;

export const DEFAULT_FOLLOWUPS: SalesFollowUp[] = [
  {
    delayHours: 24,
    mode: 'template',
    onlyIfNoReply: true,
    template:
`Hi {{name}} 👋 Just checking in on your {{business}} Google audit. Your profile is at {{profile}}% and rank {{rank}} — a few quick fixes can change that fast.

Want me to show you how? You can also see the full platform here: {{shopUrl}}`,
  },
  {
    delayHours: 72,
    mode: 'template',
    onlyIfNoReply: true,
    template:
`{{name}}, your competitors like {{competitor}} are already using tools like this to stay ahead 🏃

Whenever you're ready, you can get started here: {{subscribeUrl}} — happy to answer any questions!`,
  },
];

/**
 * Default Sales Agent business knowledge.
 *
 * Every statement here is drawn from authoritative, already-approved content
 * that ships in this repo — NOT invented:
 *   - businessOverview / ICP / problems  → src/app/about/page.tsx,
 *     src/components/sections/BusinessNiches.tsx, homepage SoftwareApplication
 *     schema in src/app/page.tsx
 *   - services / useCases / educationPoints / limitations → src/lib/servicesData.ts
 *     (which itself documents "does not claim capabilities the product doesn't
 *     have")
 *   - faqs → src/lib/faqData.ts (ALL_FAQS)
 *   - demoExplanation / subscriptionExplanation → src/lib/faqData.ts +
 *     src/services/billing/customerActivation.ts behaviour
 *   - targetCustomers → the niches marquee in BusinessNiches.tsx
 *
 * DELIBERATELY EMPTY (no authoritative source — owner must approve):
 *   - pricingResponse: the price is super-admin-editable (BillingPlan) and
 *     there is no approved sales-message pricing statement in the repo. Left
 *     empty so SEND_PRICING stays safe (asks a qualification question).
 *   - objectionResponses: no approved per-objection scripts exist yet.
 *
 * A super-admin can edit every field at /admin/sales-agent. The loader
 * (getSalesAgentConfig) shallow-merges a stored knowledge block over this,
 * so once an admin saves, their values win.
 */
export const DEFAULT_SALES_KNOWLEDGE: SalesKnowledge = {
  businessOverview:
    'GrowwMatics AI is an AI-powered Google Business Profile growth platform for local businesses. ' +
    'Most local customers find a business on Google Search or Maps before they ever visit a website, ' +
    'so GrowwMatics makes that first impression work harder: it audits the profile, generates local ' +
    'SEO content and Google Posts, automates review requests and replies, tracks local ranking, and ' +
    'runs WhatsApp AI agents that follow up with leads. It is a product of Desun Technology Pvt. Ltd.',
  idealCustomerProfile:
    'Owner-operated local and service businesses that rely on Google Maps / "near me" search to get ' +
    'found — typically without a dedicated marketing team. Good-fit signals: has an existing verified ' +
    'Google Business Profile, gets (or wants) calls and walk-ins from Google, is frustrated with slow ' +
    'or inconsistent follow-up, finds agencies too expensive, or has tried DIY tools with uneven ' +
    'results. Poor fit: businesses with no local/Maps presence at all, or that need paid-ads campaign ' +
    'management (GrowwMatics does not run ads).',
  targetCustomers: [
    'Gyms & fitness centres',
    'Doctors & health clinics',
    'Dental clinics',
    'Salons & beauty',
    'Restaurants & bars',
    'Bakers & cake shops',
    'Coaching institutes',
    'Car garages & mechanics',
    'Pest control businesses',
    'Home & handyman services',
    'Tours & travel',
    'Yoga & wellness',
  ],
  customerProblems: [
    'Business ranks low on Google Maps / local search, so customers never find it',
    'Incomplete or unoptimised Google Business Profile',
    'No time to post consistently or reply to reviews',
    'Few recent reviews; the profile looks inactive',
    'Inbound WhatsApp / call leads go cold because follow-up is slow or manual',
    'Repeating the same sales answers over and over',
    'Agencies are priced for big brands, not a single local shop',
    'Enterprise marketing tools assume a marketing team the owner does not have',
  ],
  services: [
    { name: 'SEO', description: 'Local SEO built around the Google Business Profile — AI GMB audit engine, keyword-aware Google Posts, geo-grid rank tracking, and local competitor analysis. Not website/on-page SEO.' },
    { name: 'Performance Marketing', description: 'Turns profile visibility into measurable leads — real-time analytics (calls, direction requests, clicks, views), a built-in CRM pipeline, the WhatsApp Sales Agent, and conversion-linked reporting. Not paid-ads management.' },
    { name: 'Marketing Automation', description: 'Content, reviews and follow-up on autopilot — 7-day auto scheduler for Google Posts, review request campaigns over WhatsApp, review reply automation, and the WhatsApp booking agent. Every automation can run in draft mode or autopilot.' },
    { name: 'Process Implementation', description: 'Hands-on setup — Google Business Profile connection (incl. multi-location), CRM pipeline configured to the real sales process, review/posting automation tuned before go-live, and team access & handoff.' },
    { name: 'Business Consultation', description: 'Strategy grounded in the business’s own audit data and real nearby competitors — audit-based strategy session, competitive gap analysis, a prioritised 30/45/90-day fix roadmap, and ongoing advisory check-ins.' },
  ],
  useCases: [
    {
      name: 'Leads come in but nobody follows them up properly',
      problem: 'Inbound WhatsApp and call leads sit unanswered; most local leads go cold within the first hour.',
      solution: 'The WhatsApp Sales Agent replies within seconds at any hour, qualifies the lead, and keeps a follow-up drip going until a human takes over or the lead is ready to book.',
      benefit: 'Interest is captured while it is still warm, without the owner having to be available.',
      idealCustomer: 'Any local business getting inbound enquiries on WhatsApp or phone.',
      recommendedNextAction: 'Ask how they currently handle inbound leads, then offer a demo of the WhatsApp agent.',
    },
    {
      name: 'Profile is invisible on Google Maps',
      problem: 'The business ranks low in the local pack; the profile is incomplete and rarely updated.',
      solution: 'The AI GMB audit engine scores the profile against what actually ranks nearby, then keyword-aware Google Posts and profile updates keep sending fresh local signals; geo-grid tracking shows the ranking moving.',
      benefit: 'The business shows up when nearby customers search, driving more calls and walk-ins.',
      idealCustomer: 'A local business with a verified profile that is not showing in Maps results.',
      recommendedNextAction: 'Offer to walk them through their own audit results on a demo.',
    },
    {
      name: 'No time for reviews and posting',
      problem: 'The owner cannot keep up with posting content or replying to reviews, and consistency is exactly what Google rewards.',
      solution: 'The 7-day auto scheduler plans and publishes Google Posts, review request campaigns ask recent customers for reviews over WhatsApp, and review reply automation drafts or posts a personalised reply within minutes.',
      benefit: 'The profile stays active and responsive with no daily manual work.',
      idealCustomer: 'A busy owner-operator with a steady flow of customers but no marketing help.',
      recommendedNextAction: 'Ask how they handle reviews today, then show the automation in a demo.',
    },
  ],
  educationPoints: [
    'A 100% complete Google Business Profile ranks higher than an incomplete one — Google favours complete profiles.',
    'Replying to reviews and posting regularly signals to Google that the business is active, which helps local ranking.',
    'Local SEO for a website homepage does not move Google Maps rankings — the profile signals are what count for the local pack.',
    'Geo-grid rank tracking checks ranking across a grid of points in the service area, not one spot, so you see where you actually rank street by street.',
    'Every automation (posting, review replies, WhatsApp messages) can run in draft mode for approval, or on autopilot once it learns the brand voice.',
    'The WhatsApp agents run on the business’s existing connected WhatsApp Business number — no separate line needed.',
  ],
  demoExplanation:
    'A demo is a short live walkthrough (booked for a specific time by a real person) where the team ' +
    'shows GrowwMatics running on the lead’s own Google Business Profile — their real audit score, ' +
    'nearby competitors, and how the automation and WhatsApp agent would work for their business. ' +
    'Offer a demo when a lead wants to see how it works or has a clear business problem to solve. The ' +
    'Sales Agent never proposes a time or sends a calendar link — it hands the lead to booking, where ' +
    'a real available slot is offered.',
  subscriptionExplanation:
    'There is one plan — everything included, on both the web dashboard and the mobile app, cancel ' +
    'anytime from the billing page. Every new business also gets one free Google Business Profile ' +
    'audit/report first, no card required. Subscribing unlocks full automation: posting, review ' +
    'management, CRM, and the WhatsApp agents for that business workspace. Payment is processed ' +
    'securely by Razorpay, and a verified successful payment is what actually activates the account ' +
    '— saying "I want to buy" does not; the customer gets an invoice and welcome message once ' +
    'payment is confirmed.',
  limitations: [
    'Does not run or manage Google Ads or Meta / paid-ads campaigns.',
    'Does not do website or on-page SEO — it is built around the Google Business Profile and Maps.',
    'Requires an existing, verified Google Business Profile to connect.',
    'Review requests, review reminders and the WhatsApp agents need a connected WhatsApp Business number.',
  ],
  escalationRules:
    'Hand the lead to a human when: they explicitly ask for a person; they raise a billing, contract, ' +
    'legal, refund or account-specific dispute; they ask something factual that is not covered by this ' +
    'knowledge and getting it wrong would matter; or the conversation is going in circles. Prefer ' +
    '"I’ll get that confirmed for you" over a guess.',
  // No authoritative source — left empty on purpose. See this block's doc comment.
  pricingResponse: '',
  objectionResponses: {},
  faqs: ALL_FAQS.map((f) => ({ q: f.question, a: f.answer })),
};

export function defaultSalesAgentConfig(subscribeUrl = '', shopUrl = ''): SalesAgentConfigShape {
  return {
    enabled: false,
    firstMessage: {
      mode: 'ai',
      delayMinutes: 2,
      template: DEFAULT_FIRST_TEMPLATE,
      aiSystemPrompt: DEFAULT_FIRST_AI_PROMPT,
    },
    followUps: DEFAULT_FOLLOWUPS,
    agentSystemPrompt: DEFAULT_AGENT_PROMPT,
    subscribeUrl,
    shopUrl,
    // Grounded from authoritative repo content (see DEFAULT_SALES_KNOWLEDGE).
    // pricingResponse / objectionResponses are intentionally empty — no
    // approved source — so those actions stay safe until an admin fills them.
    knowledge: { ...DEFAULT_SALES_KNOWLEDGE },
  };
}

/**
 * Fills {{var}} placeholders. A missing, empty, or unrecognised placeholder
 * is dropped to '' rather than left as literal "{{var}}" text — matching the
 * guarantee the review-campaign template builder (fillTemplate() in
 * services/inngest/functions.ts) gives its callers, that templating syntax
 * never reaches the customer. That builder gets this for free because its
 * four vars are always pre-filled with a real fallback string by its caller;
 * this function's vars are optional by design (super-admin-edited templates
 * can reference any subset), so the same guarantee has to live here instead.
 */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
    const v = vars[key];
    return v === undefined || v === null || v === '' ? '' : String(v);
  });
}
