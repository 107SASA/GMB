/**
 * Single source of truth for the "OnDemand Service" pages (/services and its
 * 5 children). Content here describes real, shipped GrowwMatics AI
 * capabilities under service-oriented names, per the Aug 2026 site
 * restructure — it does not claim capabilities the product doesn't have
 * (e.g. no paid-ads management is offered; "Performance Marketing" below is
 * scoped to what the platform actually measures/drives: GBP-sourced calls,
 * clicks, direction requests and WhatsApp-driven lead conversion).
 *
 * Each service page is rendered by ServicePageTemplate from one entry here —
 * add a new service by adding an entry + a 3-line page.tsx, nothing else.
 */

export interface ServiceFaq {
  question: string;
  answer: string;
}

export interface ServiceProcessStep {
  title: string;
  description: string;
}

export interface ServiceDefinition {
  slug: string;
  /** Nav label / hub card title. */
  name: string;
  /** One-line hub-card summary. */
  tagline: string;
  /** Material Symbols icon name. */
  icon: string;
  /** <title> — kept short, root layout appends " | GrowwMatics AI". */
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  /** Hero H1 on the service's own page — can be longer/richer than metaTitle. */
  heroTitle: string;
  heroDescription: string;
  /** "What's included" — grounded in real, shipped platform features. */
  includes: { title: string; description: string; icon: string }[];
  /** Why-it-matters benefit bullets. */
  benefits: { title: string; description: string }[];
  process: ServiceProcessStep[];
  faqs: ServiceFaq[];
}

export const SERVICES: ServiceDefinition[] = [
  {
    slug: "seo",
    name: "SEO",
    tagline: "Rank higher on Google Maps and local search.",
    icon: "search",
    metaTitle: "Local SEO for Google Business Profile",
    metaDescription:
      "AI-driven local SEO: profile audits, keyword-optimized content, and geo-grid rank tracking so your business shows up higher on Google Maps and local search.",
    keywords: [
      "local SEO",
      "Google Business Profile SEO",
      "Google Maps ranking",
      "local search optimization",
      "GBP audit",
    ],
    heroTitle: "SEO built around your Google Business Profile",
    heroDescription:
      "Most local customers find you on Google Maps before they ever visit your website. Our SEO service is built entirely around that reality — auditing, optimizing, and tracking the one profile that decides whether you show up in the local pack.",
    includes: [
      {
        title: "AI GMB Audit Engine",
        description:
          "A full audit of your profile — category accuracy, completion score, description quality, service listings — benchmarked against what actually ranks in your area.",
        icon: "fact_check",
      },
      {
        title: "AI SEO content generation",
        description:
          "Keyword-aware Google Posts and profile updates generated for your business and city, so your profile keeps showing fresh, locally-relevant signals to Google.",
        icon: "edit_note",
      },
      {
        title: "Geo-grid rank tracking",
        description:
          "Your ranking is checked across a grid of points around your service area, not just one spot — so you see where you actually rank for customers a few km away, not just next door.",
        icon: "grid_on",
      },
      {
        title: "Local competitor analysis",
        description:
          "Side-by-side comparison against nearby businesses ranking above you — what categories, review volume, and profile completeness they have that you don't yet.",
        icon: "insights",
      },
    ],
    benefits: [
      {
        title: "Built for Maps, not just web search",
        description:
          "Local SEO tools built for a website homepage don't move the needle on Google Maps rankings. Every part of this service targets the profile signals Google actually uses for the local pack.",
      },
      {
        title: "See your real position",
        description:
          "Grid-based rank tracking instead of a single guessed number — know exactly which neighborhoods you're winning and which you're not.",
      },
      {
        title: "No manual audits",
        description:
          "The audit engine re-checks your profile continuously instead of a one-time PDF report that's stale a month later.",
      },
    ],
    process: [
      { title: "Connect your profile", description: "Link your Google Business Profile — takes under two minutes, no technical setup." },
      { title: "Get your audit", description: "Instant scoring across profile completeness, category accuracy, and content gaps." },
      { title: "Fix what's flagged", description: "Priority fixes are ranked by impact so you know what to do first, not a 40-item checklist." },
      { title: "Track the movement", description: "Geo-grid rank checks show your position shifting as fixes take effect." },
    ],
    faqs: [
      {
        question: "Is this SEO for my website, or my Google Business Profile?",
        answer:
          "This service is specifically built around your Google Business Profile and Maps ranking — the channel most local customers actually use to find you. It doesn't include website/on-page SEO.",
      },
      {
        question: "How is rank tracked?",
        answer:
          "We check your ranking across a grid of points spread through your service area (not one single search), so you can see how your visibility changes street by street, not just at your exact pin.",
      },
      {
        question: "Do I need technical SEO knowledge to use this?",
        answer:
          "No. The audit engine explains findings in plain language and ranks fixes by priority, so you know what to act on first without needing an SEO background.",
      },
    ],
  },
  {
    slug: "performance-marketing",
    name: "Performance Marketing",
    tagline: "Turn profile visibility into measurable leads.",
    icon: "trending_up",
    metaTitle: "Performance Marketing for Local Businesses",
    metaDescription:
      "Measure and improve what your Google Business Profile actually drives — calls, direction requests, clicks and WhatsApp leads — with real conversion tracking, not vanity metrics.",
    keywords: [
      "performance marketing",
      "local lead generation",
      "Google Business Profile analytics",
      "lead conversion tracking",
      "WhatsApp lead generation",
    ],
    heroTitle: "Performance marketing measured in calls and leads, not impressions",
    heroDescription:
      "Your Google Business Profile is often the highest-intent, lowest-cost channel a local business has — someone searching \"near me\" is already close to a decision. This service is about proving and improving what that channel actually converts into: calls, direction requests, and leads you can follow up on.",
    includes: [
      {
        title: "Real-time analytics dashboard",
        description:
          "Calls, direction requests, website clicks and profile views tracked over time — the actual demand signals your profile is generating, in one view.",
        icon: "bar_chart",
      },
      {
        title: "Built-in CRM pipeline",
        description:
          "Every lead your profile and WhatsApp line generate lands in a pipeline you can move from first contact to won, instead of getting lost in a phone log.",
        icon: "group",
      },
      {
        title: "WhatsApp Sales Agent",
        description:
          "An AI agent that replies to inbound WhatsApp leads instantly, qualifies them, and keeps a drip follow-up going — so interest doesn't go cold waiting on a callback.",
        icon: "smart_toy",
      },
      {
        title: "Conversion-linked reporting",
        description:
          "Because leads, CRM stage, and profile activity live in the same platform, you can see which profile changes actually correlated with more converted leads.",
        icon: "query_stats",
      },
    ],
    benefits: [
      {
        title: "No wasted ad spend to manage",
        description:
          "This isn't paid-ads management — it's making the free, high-intent channel you already have (your GBP listing) convert better before you spend on anything else.",
      },
      {
        title: "Follow-up that doesn't depend on you being available",
        description:
          "The WhatsApp Sales Agent responds within seconds, at any hour — most local leads go cold within the first hour of no response.",
      },
      {
        title: "One pipeline, not five spreadsheets",
        description:
          "Leads from calls, WhatsApp, and profile actions all land in the same CRM view.",
      },
    ],
    process: [
      { title: "Connect your channels", description: "Google Business Profile and WhatsApp Business number connected to the platform." },
      { title: "Leads start flowing into one pipeline", description: "Every inbound call/click/message is tracked as a lead automatically." },
      { title: "AI qualifies and follows up", description: "The WhatsApp Sales Agent responds instantly and keeps nurturing until you take over." },
      { title: "Review the numbers", description: "Weekly view of what's converting, so you know where to focus." },
    ],
    faqs: [
      {
        question: "Do you run my Google or Meta ads?",
        answer:
          "No — this service doesn't include paid ad campaign management. It focuses on converting the organic demand your Google Business Profile already generates into tracked, followed-up leads.",
      },
      {
        question: "How fast does the WhatsApp Sales Agent respond?",
        answer:
          "Within seconds of an inbound message, any time of day — it qualifies the lead and keeps the conversation going until a human takes over or the lead is ready to book.",
      },
      {
        question: "Can I see which leads actually converted?",
        answer:
          "Yes — leads move through CRM pipeline stages you define, from first contact to won/lost, so you can see real conversion, not just raw lead count.",
      },
    ],
  },
  {
    slug: "marketing-automation",
    name: "Marketing Automation",
    tagline: "Content, reviews and follow-up on autopilot.",
    icon: "bolt",
    metaTitle: "Marketing Automation for Google Business Profile",
    metaDescription:
      "Automate Google Business Profile posting, review requests, review replies, and WhatsApp lead follow-up — built for local businesses that don't have a marketing team.",
    keywords: [
      "marketing automation",
      "Google Business Profile automation",
      "review automation",
      "WhatsApp automation",
      "automated posting",
    ],
    heroTitle: "Automation that runs your profile so you don't have to",
    heroDescription:
      "Consistent posting and fast review responses are two of the strongest signals for local ranking and trust — and the two things busiest local business owners have the least time for. This service automates both, plus the WhatsApp follow-up in between.",
    includes: [
      {
        title: "7-Day Auto Scheduler",
        description:
          "AI plans and publishes your Google Posts calendar across the week automatically, tuned to your business and city — set once, or review each draft before it goes out.",
        icon: "calendar_month",
      },
      {
        title: "Review Request Campaigns",
        description:
          "Automated WhatsApp reminders sent to recent customers asking for a review, with owner-configurable delay and message — turns satisfied customers into public reviews without manual follow-up.",
        icon: "mail",
      },
      {
        title: "Review Reply Automation",
        description:
          "AI drafts (or auto-posts, your choice) a personalized reply to every new review within minutes of it landing, in your brand's tone.",
        icon: "chat",
      },
      {
        title: "WhatsApp Booking Agent",
        description:
          "A conversational AI on your WhatsApp line that can take a demo/appointment booking end-to-end and log it, without a web form or manual back-and-forth.",
        icon: "event_available",
      },
    ],
    benefits: [
      {
        title: "Draft mode or autopilot — your call",
        description:
          "Every automated action can be set to wait for your approval, or run fully automatically once it understands your brand voice. You choose the level of control per feature.",
      },
      {
        title: "No marketing team required",
        description:
          "The scheduler, review automation, and WhatsApp agents replace tasks that would otherwise need a dedicated person checking in daily.",
      },
      {
        title: "Consistency Google actually rewards",
        description:
          "Profiles that post and respond regularly outperform ones that go quiet for weeks — automation is what makes that consistency realistic to maintain.",
      },
    ],
    process: [
      { title: "Set your preferences", description: "Choose draft mode or autopilot for each automation, and your brand tone." },
      { title: "Connect Google + WhatsApp", description: "The scheduler, review tools, and WhatsApp agents activate on your connected accounts." },
      { title: "Automations run on schedule", description: "Posts publish weekly, review requests and replies fire as reviews come in." },
      { title: "Adjust anytime", description: "Change cadence, messages, or pause any single automation without affecting the others." },
    ],
    faqs: [
      {
        question: "Will it post or reply without my approval?",
        answer:
          "Only if you choose autopilot for that specific feature. Every automation — posting, review replies, WhatsApp messages — can instead be set to draft mode, where it waits for you to approve before anything goes live.",
      },
      {
        question: "Can I control how often review requests are sent?",
        answer:
          "Yes — the delay after a customer interaction and the message template are both owner-configurable per business.",
      },
      {
        question: "Does the WhatsApp Booking Agent need a separate number?",
        answer:
          "It runs on your existing connected WhatsApp Business number — no separate line needed.",
      },
    ],
  },
  {
    slug: "process-implementation",
    name: "Process Implementation",
    tagline: "Get set up right the first time.",
    icon: "settings",
    metaTitle: "Process Implementation & Onboarding",
    metaDescription:
      "Hands-on setup of your Google Business Profile connection, CRM pipeline, review automations and WhatsApp agents — configured correctly from day one.",
    keywords: [
      "GBP onboarding",
      "CRM setup",
      "workflow implementation",
      "business process setup",
      "Google Business Profile integration",
    ],
    heroTitle: "Implementation, not just software",
    heroDescription:
      "A platform is only as useful as its setup. This service is the hands-on work of getting your Google Business Profile connection, CRM pipeline, and automations configured correctly around how your business actually runs — not a generic default.",
    includes: [
      {
        title: "Google Business Profile connection",
        description:
          "Guided OAuth connection to your real, verified listing — including sorting out multi-location or multi-manager access where that applies.",
        icon: "link",
      },
      {
        title: "CRM pipeline configuration",
        description:
          "Lead stages set up to match your actual sales process (e.g. Enquiry → Site Visit → Quoted → Won), instead of a one-size-fits-all default.",
        icon: "view_kanban",
      },
      {
        title: "Review & posting automation setup",
        description:
          "Review request delays, reply tone, and the post scheduler configured for your business before you go live — not left on defaults.",
        icon: "tune",
      },
      {
        title: "Team access & handoff",
        description:
          "The right team members given access to the right workspace sections, with a walkthrough so the handoff actually sticks.",
        icon: "groups",
      },
    ],
    benefits: [
      {
        title: "Configured for your business, not a template",
        description:
          "Default settings work for nobody in particular. This service tailors pipeline stages, automation cadence, and access to how you actually operate.",
      },
      {
        title: "Avoid the setup mistakes that quietly cost you data",
        description:
          "A miswired Google connection or an empty CRM stage silently loses leads for weeks before anyone notices — implementation catches that upfront.",
      },
      {
        title: "Live faster",
        description:
          "Skip the trial-and-error of figuring out the platform alone — go from signup to a fully working setup in one guided session.",
      },
    ],
    process: [
      { title: "Discovery", description: "A short session to understand your current sales process, team structure, and what \"done right\" looks like for you." },
      { title: "Configuration", description: "Google connection, CRM stages, and automations set up to match." },
      { title: "Walkthrough", description: "Your team is walked through the finished setup, live." },
      { title: "Check-in", description: "A follow-up check after go-live to catch anything that needs adjusting once real data is flowing." },
    ],
    faqs: [
      {
        question: "Is this a one-time service or ongoing?",
        answer:
          "The core implementation is a one-time setup, with a follow-up check-in after go-live. Ongoing changes to your configuration can always be made directly in the dashboard afterward.",
      },
      {
        question: "Do I need to already have a Google Business Profile?",
        answer:
          "Yes — an existing, verified Google Business Profile is required to connect. If you don't have one yet, Business Consultation can help you get one set up correctly first.",
      },
      {
        question: "Can this handle multiple locations?",
        answer:
          "Yes — multi-location and multi-manager setups are supported as part of the connection process.",
      },
    ],
  },
  {
    slug: "business-consultation",
    name: "Business Consultation",
    tagline: "Strategy grounded in your actual audit data.",
    icon: "psychology",
    metaTitle: "Business Growth Consultation",
    metaDescription:
      "Strategic guidance based on your real Google Business Profile audit, competitor comparison and business-intelligence data — not generic advice.",
    keywords: [
      "business consultation",
      "local business growth strategy",
      "Google Business Profile consulting",
      "competitor analysis",
      "growth strategy",
    ],
    heroTitle: "Consultation grounded in your own data, not generic advice",
    heroDescription:
      "Most \"marketing consultations\" run on general best practices. Ours starts from your actual audit score, your real nearby competitors, and the specific gaps between you and the businesses outranking you — so the advice is about your business, not a template.",
    includes: [
      {
        title: "Audit-based strategy session",
        description:
          "A walkthrough of your AI GMB Audit results — profile completeness, SEO score, and review quality — translated into a prioritized plan.",
        icon: "assignment",
      },
      {
        title: "Competitive gap analysis",
        description:
          "A direct comparison against the specific nearby competitors ranking above you — what they have (reviews, categories, completeness) that's driving the gap.",
        icon: "compare_arrows",
      },
      {
        title: "Priority fix roadmap",
        description:
          "Findings ranked by expected impact and effort, so a 30/45/90-day plan focuses on what actually moves your score, not everything at once.",
        icon: "route",
      },
      {
        title: "Ongoing advisory check-ins",
        description:
          "Periodic sessions to revisit the plan as your audit score and competitive position change.",
        icon: "event_repeat",
      },
    ],
    benefits: [
      {
        title: "Advice tied to evidence",
        description:
          "Every recommendation traces back to a specific finding in your audit or a specific competitor gap — not a generic \"post more often\" checklist.",
      },
      {
        title: "Prioritized, not overwhelming",
        description:
          "A ranked plan means you know what to do first instead of a 40-item list with no order.",
      },
      {
        title: "Revisited as things change",
        description:
          "Your competitive position shifts as competitors improve too — check-ins keep the plan current instead of a one-time PDF.",
      },
    ],
    process: [
      { title: "Run your audit", description: "The AI GMB Audit Engine scores your profile and identifies nearby competitors." },
      { title: "Strategy session", description: "Findings and competitor gaps are walked through together, in plain language." },
      { title: "Get your roadmap", description: "A prioritized 30/45/90-day plan, ranked by impact." },
      { title: "Check in and adjust", description: "Revisit the plan as your score and competitive position move." },
    ],
    faqs: [
      {
        question: "Do I need to already be a customer to get a consultation?",
        answer:
          "You need a completed profile audit first — the free report gives you that starting point, and the consultation builds directly on its findings.",
      },
      {
        question: "How is this different from just reading the audit myself?",
        answer:
          "The audit gives you the data; the consultation is a guided, prioritized walkthrough of what it means for your specific business and what to act on first.",
      },
      {
        question: "How often are check-ins?",
        answer:
          "Check-ins are scheduled around your plan's duration (30/45/90 days) so the roadmap gets revisited as your position actually changes.",
      },
    ],
  },
];

export function getServiceBySlug(slug: string): ServiceDefinition | undefined {
  return SERVICES.find((s) => s.slug === slug);
}
