"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { FreeReportButton } from "@/components/shared/FreeReportButton";

/**
 * "Sticky Evolving Panel" home experience (Aug 2026 restructure) — replaces
 * the old Hero + HowItWorksFlow + AiTeam stack of independent full-width
 * sections. Structurally different, not just restyled: on lg+ the right
 * column is ONE sticky panel whose body morphs (via IntersectionObserver
 * driving `activePhase`) as the visitor scrolls the left column through
 * hero → how it works → each AI agent, instead of six separate blocks each
 * carrying their own visual. Below lg, sticky scroll-driven panels don't
 * translate well to touch scrolling, so each phase renders its own inline
 * (non-shared) copy of the same panel body — same content, no JS-driven
 * cross-fade choreography to fight with.
 *
 * All copy, images, CTA `origin` tracking strings, and bullet content are
 * carried over unchanged from the previous Hero/HowItWorksFlow/AiTeam
 * components (now deleted — this file is their sole replacement).
 */

// ── Shared bits ──────────────────────────────────────────────────────────

function AiSparkle({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `ai-sparkle-${uid}`;
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} className={className} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#A142F4" />
        </linearGradient>
      </defs>
      <path fill={`url(#${gradId})`} d="M12 2.5l1.7 5.2L19 9.4l-5.3 1.7L12 16.5l-1.7-5.4L5 9.4l5.3-1.7L12 2.5z" />
      <path
        fill={`url(#${gradId})`}
        d="M18.5 14.5l.85 2.6 2.65.85-2.65.85-.85 2.6-.85-2.6-2.65-.85 2.65-.85.85-2.6z"
        opacity="0.9"
      />
    </svg>
  );
}

function GoogleWord() {
  const letters = [
    { ch: "G", color: "#4285F4" },
    { ch: "o", color: "#EA4335" },
    { ch: "o", color: "#FBBC05" },
    { ch: "g", color: "#4285F4" },
    { ch: "l", color: "#34A853" },
    { ch: "e", color: "#EA4335" },
  ];
  return (
    <span className="inline-flex font-bold tracking-tight">
      {letters.map((l, i) => (
        <span key={`${l.ch}-${i}`} style={{ color: l.color }}>
          {l.ch}
        </span>
      ))}
    </span>
  );
}

type AgentBrand = "gbp" | "whatsapp-chat" | "whatsapp-marketing" | "data";

// Only ever rendered inside the dark "AI engine" zone now (phases 2-5),
// so this is styled for a dark background permanently — not a light/dark
// variant switch.
function AgentBrandLabel({ brand }: { brand: AgentBrand }) {
  if (brand === "gbp") {
    return (
      <div className="inline-flex items-center flex-wrap gap-x-2 gap-y-1 text-sm sm:text-base md:text-lg">
        <span className="inline-flex items-baseline gap-1 sm:gap-1.5">
          <GoogleWord />
          <span className="font-semibold text-[#5B9DFA]">Business Profile</span>
        </span>
        <span className="text-white/25 font-light select-none" aria-hidden>|</span>
        <span className="inline-flex items-center gap-1.5 text-white">
          <AiSparkle />
          <span className="font-medium">AI Agent</span>
        </span>
      </div>
    );
  }
  if (brand === "whatsapp-chat" || brand === "whatsapp-marketing") {
    const second = brand === "whatsapp-chat" ? "Chat" : "Marketing";
    return (
      <div className="inline-flex items-center flex-wrap gap-x-2.5 gap-y-1 text-sm sm:text-base md:text-lg">
        <span className="inline-flex items-center gap-1.5 sm:gap-2">
          <WhatsAppIcon size={20} className="text-[#25D366]" />
          <span className="font-bold">
            <span className="text-[#25D366]">WhatsApp</span> <span className="text-white">{second}</span>
          </span>
        </span>
        <span className="text-white/25 font-light select-none" aria-hidden>|</span>
        <span className="inline-flex items-center gap-1.5 text-white">
          <AiSparkle />
          <span className="font-medium">AI Agent</span>
        </span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center flex-wrap gap-x-2.5 gap-y-1 text-base md:text-lg">
      <span className="inline-flex items-center gap-2 font-bold text-white">
        <MaterialIcon name="psychology" size={22} className="text-[#4ade80]" />
        Data Intelligence
      </span>
      <span className="text-white/25 font-light select-none" aria-hidden>|</span>
      <span className="inline-flex items-center gap-1.5 text-white">
        <AiSparkle />
        <span className="font-medium">AI Engine</span>
      </span>
    </div>
  );
}

/** Small "● Active" status pill — the product-interface touch the dark
    AI-agent zone calls for, right in the marketing copy, not just inside
    the sticky panel. */
function ActiveStatusPill() {
  return (
    <span className="mkt-label inline-flex items-center gap-1.5 text-[#4ade80]">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#4ade80] opacity-75 animate-ping" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#4ade80]" />
      </span>
      Active
    </span>
  );
}

const AGENTS: { brand: AgentBrand; title: string; image: string; bullets: string[]; ctaOrigin: string }[] = [
  {
    brand: "gbp",
    title: "AI Agent to Get You More Leads from Google",
    image: "/marketing/home/agent-gbp.png",
    ctaOrigin: "ai-team-0",
    bullets: [
      "Instant analysis of your Google Business Profile with prioritized optimization steps",
      "Generate hyper-local posts and updates that rank higher on Google Maps",
      "7-day auto scheduler — AI handles your content calendar",
      "Intelligent, personalized responses to reviews within minutes",
      "Real-time visibility into local growth, calls, and conversions",
    ],
  },
  {
    brand: "whatsapp-chat",
    title: "Your Personal Assistant Who Chats with Customers 24/7",
    image: "/marketing/home/agent-whatsapp-chat.png",
    ctaOrigin: "ai-team-1",
    bullets: [
      "Answer customer questions instantly on WhatsApp",
      "Qualify leads and book demos without you lifting a finger",
      "Track every lead from first contact to conversion in CRM",
      "Never miss a late-night or weekend enquiry again",
      "Works in your brand voice with full conversation history",
    ],
  },
  {
    brand: "whatsapp-marketing",
    title: "AI Agent to Increase Repeat Sales & Google Reviews",
    image: "/marketing/home/agent-whatsapp-mkt.png",
    ctaOrigin: "ai-team-2",
    bullets: [
      "Automated WhatsApp reminders to get more 5-star reviews",
      "Review request campaigns that convert happy customers",
      "Follow-ups that bring customers back for repeat business",
      "Personalized messages at the right time",
      "Built-in CRM pipeline to manage every campaign outcome",
    ],
  },
  {
    brand: "data",
    title: "Shared Brain of All Your AI Agents",
    image: "/marketing/home/agent-data.png",
    ctaOrigin: "ai-team-3",
    bullets: [
      "One shared brain across GBP, chat, and marketing agents",
      "Analytics dashboard for growth, calls, and conversions",
      "Learns your business category, services, and customers",
      "Turns every interaction into smarter next actions",
      "Keeps your local SEO and lead funnel aligned",
    ],
  },
];

const HOW_IT_WORKS_STEPS = [
  { step: "01", icon: "link", title: "Connect your profile", description: "Link your Google Business Profile and WhatsApp number in one short call." },
  { step: "02", icon: "search_check", title: "AI audits & plans", description: "The engine scores your profile and builds a posting, review, and reply plan." },
  { step: "03", icon: "bolt", title: "Agents run daily", description: "Posts go out, reviews get replies, and WhatsApp leads get qualified — automatically." },
  { step: "04", icon: "monitoring", title: "You track it in one place", description: "Every action, lead, and score change lands in your Growwmatics dashboard." },
] as const;

// ── Panel row primitives (shared visual language across every body) ───────

function PanelRow({ icon, title, detail, delay = 0 }: { icon: string; title: string; detail: string; delay?: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay }}
      className="flex items-center gap-3 rounded-lg bg-(--mkt-ink-elevated) border border-(--mkt-ink-border) px-3 py-2.5"
    >
      <MaterialIcon name={icon} size={18} className="text-[#4ade80] shrink-0" />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-(--mkt-ink-text) truncate">{title}</p>
        <p className="text-xs text-(--mkt-ink-text-dim) truncate">{detail}</p>
      </div>
    </motion.li>
  );
}

function PanelEyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mkt-label text-[#4ade80] mb-1">{children}</p>;
}

// ── Panel bodies (one per phase) ───────────────────────────────────────────

function HeroBody() {
  // Initial state must be identical on server and client — branching this on
  // useReducedMotion() (which reads window.matchMedia and so resolves
  // differently server- vs client-side) caused a hydration mismatch for any
  // visitor whose OS/browser prefers reduced motion. Always start at the
  // final value; the effect below (client-only, post-hydration) is what
  // decides whether to animate away from it.
  const [score, setScore] = useState(84);
  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;
    setScore(0);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setScore(Math.round(84 * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const circumference = 2 * Math.PI * 22;
  const dashOffset = circumference * (1 - score / 100);

  return (
    <div className="flex flex-col gap-4">
      <PanelEyebrow>Overview</PanelEyebrow>
      <div className="flex items-center gap-4">
        <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0 -rotate-90">
          <circle cx="28" cy="28" r="22" fill="none" stroke="var(--mkt-ink-border)" strokeWidth="4" />
          <circle
            cx="28" cy="28" r="22" fill="none" stroke="#4ade80" strokeWidth="4" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.2s linear" }}
          />
        </svg>
        <div>
          <p className="mkt-label text-(--mkt-ink-text-dim) mb-1">Profile Score</p>
          <p className="font-mkt-mono text-2xl font-semibold text-(--mkt-ink-text) leading-none">
            {score}<span className="text-sm text-(--mkt-ink-text-dim)">/100</span>
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-2.5">
        <PanelRow icon="storefront" title="Google Business Profile" detail="Auto-posted weekend hours update" delay={0.1} />
        <PanelRow icon="rate_review" title="Reviews" detail="2 replies sent · avg. 4m response" delay={0.18} />
        <PanelRow icon="chat" title="WhatsApp Agent" detail="3 leads qualified, handed to CRM" delay={0.26} />
      </ul>
    </div>
  );
}

function HowItWorksBody() {
  const statuses = ["Done", "Done", "Active", "Pending"] as const;
  return (
    <div className="flex flex-col gap-4">
      <PanelEyebrow>Workflow</PanelEyebrow>
      <ul className="flex flex-col gap-2.5">
        {HOW_IT_WORKS_STEPS.map((s, i) => (
          <motion.li
            key={s.step}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.08 }}
            className="flex items-center gap-3 rounded-lg bg-(--mkt-ink-elevated) border border-(--mkt-ink-border) px-3 py-2.5"
          >
            <span className="font-mkt-mono text-[10px] text-(--mkt-ink-text-dim) shrink-0 w-4">{s.step}</span>
            <MaterialIcon name={s.icon} size={16} className="text-[#4ade80] shrink-0" />
            <p className="flex-1 min-w-0 text-xs font-semibold text-(--mkt-ink-text) truncate">{s.title}</p>
            <span
              className={`mkt-label shrink-0 px-1.5 py-0.5 rounded ${
                statuses[i] === "Active"
                  ? "text-[#4ade80] bg-[#4ade80]/10"
                  : statuses[i] === "Done"
                  ? "text-(--mkt-ink-text-dim)"
                  : "text-(--mkt-ink-text-dim) opacity-60"
              }`}
            >
              {statuses[i]}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function GbpAgentBody() {
  return (
    <div className="flex flex-col gap-4">
      <PanelEyebrow>Google Business Profile</PanelEyebrow>
      <ul className="flex flex-col gap-2.5">
        <PanelRow icon="post_add" title="New post published" detail="Weekend Hours Update · Auto" />
        <PanelRow icon="calendar_month" title="7-day content calendar" detail="Next post scheduled in 2 days" delay={0.08} />
        <PanelRow icon="forum" title="Reviews" detail="3 replied today · avg. 4m response" delay={0.16} />
      </ul>
    </div>
  );
}

function WhatsAppChatBody() {
  return (
    <div className="flex flex-col gap-4">
      <PanelEyebrow>WhatsApp Chat Agent</PanelEyebrow>
      <div className="flex flex-col gap-2">
        <div className="self-start max-w-[85%] rounded-lg rounded-bl-sm bg-(--mkt-ink-elevated) border border-(--mkt-ink-border) px-3 py-2 text-xs text-(--mkt-ink-text)">
          Do you have parking?
        </div>
        <div className="self-end max-w-[85%] rounded-lg rounded-br-sm bg-[#4ade80] px-3 py-2 text-xs font-medium text-[#0a120e]">
          Yes! Free parking right behind the shop 🅿️
        </div>
      </div>
      <PanelRow icon="bolt" title="Replied in 8 seconds" detail="Lead qualified → sent to CRM" />
    </div>
  );
}

function WhatsAppMarketingBody() {
  return (
    <div className="flex flex-col gap-4">
      <PanelEyebrow>WhatsApp Marketing Agent</PanelEyebrow>
      <ul className="flex flex-col gap-2.5">
        <PanelRow icon="campaign" title="Review requests sent" detail="12 recent customers this week" />
        <PanelRow icon="event_repeat" title="Follow-up reminders" detail="Scheduled for repeat customers" delay={0.08} />
        <PanelRow icon="view_kanban" title="CRM pipeline" detail="Every response tracked automatically" delay={0.16} />
      </ul>
    </div>
  );
}

function DataBody() {
  const nodes = [
    { icon: "storefront", label: "GBP" },
    { icon: "chat", label: "Chat" },
    { icon: "campaign", label: "Marketing" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PanelEyebrow>Data Intelligence</PanelEyebrow>
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center justify-center gap-3">
          {nodes.map((n) => (
            <div key={n.label} className="flex flex-col items-center gap-1.5">
              <span className="w-9 h-9 rounded-lg bg-(--mkt-ink-elevated) border border-(--mkt-ink-border) flex items-center justify-center">
                <MaterialIcon name={n.icon} size={16} className="text-[#4ade80]" />
              </span>
              <span className="mkt-label text-(--mkt-ink-text-dim) text-[9px]">{n.label}</span>
            </div>
          ))}
        </div>
        <svg width="100%" height="28" viewBox="0 0 200 28" className="text-(--mkt-ink-border)" aria-hidden>
          <path d="M28 0 L100 24 L172 0" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
        <div className="flex flex-col items-center gap-1.5">
          <span className="w-11 h-11 rounded-lg bg-[#4ade80] flex items-center justify-center">
            <MaterialIcon name="psychology" size={20} className="text-[#0a120e]" />
          </span>
          <span className="mkt-label text-[#4ade80] text-[9px]">Unified Insights</span>
        </div>
      </div>
      <p className="text-xs text-(--mkt-ink-text-dim) text-center leading-relaxed">
        Learns your business and turns every interaction into a smarter next action.
      </p>
    </div>
  );
}

type PhaseId = "hero" | "how-it-works" | AgentBrand;

const PHASES: { id: PhaseId; body: React.ReactNode }[] = [
  { id: "hero", body: <HeroBody /> },
  { id: "how-it-works", body: <HowItWorksBody /> },
  { id: "gbp", body: <GbpAgentBody /> },
  { id: "whatsapp-chat", body: <WhatsAppChatBody /> },
  { id: "whatsapp-marketing", body: <WhatsAppMarketingBody /> },
  { id: "data", body: <DataBody /> },
];

function InkPanelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt-ink-panel rounded-2xl border border-(--mkt-ink-border) shadow-[0_20px_60px_-15px_rgba(6,179,76,0.35)] overflow-hidden">
      <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-(--mkt-ink-border)">
        <div className="flex items-center gap-2 min-w-0">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#4ade80] opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#4ade80]" />
          </span>
          <span className="mkt-label text-(--mkt-ink-text-dim) truncate">Growwmatics AI Engine</span>
        </div>
        <span className="mkt-label text-[#4ade80]">Live</span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

// ── Left-column phase content ──────────────────────────────────────────────

function HeroCopy() {
  return (
    <>
      <div className="mkt-label inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-(--mkt-line) bg-white text-[#006e2c] mb-5 sm:mb-6">
        <MaterialIcon name="auto_awesome" size={13} className="text-[#006e2c]" />
        AI Growth Platform for Local Business
      </div>
      <h1 className="font-mkt-display text-[2rem] leading-[1.1] sm:text-5xl lg:text-[3.25rem] font-semibold tracking-tight text-[#101613] mb-5 sm:mb-6">
        Your Google Business Profile,{" "}
        <span className="text-[#006e2c]">run by AI.</span>
      </h1>
      <p className="text-base sm:text-lg text-[#3d4a3d] max-w-xl leading-relaxed mb-8">
        One AI engine posts to your Google Business Profile, replies to reviews, and qualifies
        leads on WhatsApp — so your local visibility keeps working after hours close.
      </p>
      <div className="flex flex-col xs:flex-row sm:flex-row flex-wrap gap-3 sm:gap-4 mb-8">
        <FreeReportButton className="w-full sm:w-auto px-6 sm:px-7 py-3.5 sm:py-4 rounded-lg bg-[#006e2c] text-white font-semibold hover:bg-[#005a24] transition-colors shadow-md min-h-[48px] text-sm sm:text-base" />
        <BookDemoButton
          origin="hero"
          className="w-full sm:w-auto px-6 sm:px-7 py-3.5 sm:py-4 rounded-lg bg-white border border-(--mkt-line) text-[#101613] font-semibold hover:border-[#006e2c] hover:text-[#006e2c] transition-colors min-h-[48px] text-sm sm:text-base"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mkt-label text-[#6b756f]">
        <span className="inline-flex items-center gap-1.5">
          <MaterialIcon name="bolt" size={14} className="text-[#006e2c]" />
          Setup in one call
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MaterialIcon name="credit_card_off" size={14} className="text-[#006e2c]" />
          No card for the free report
        </span>
      </div>
    </>
  );
}

function HowItWorksCopy() {
  return (
    <>
      <p className="mkt-label text-[#006e2c] mb-2">How it works</p>
      <h2 className="font-mkt-display text-2xl sm:text-3xl font-semibold text-[#101613] tracking-tight mb-6">
        From connected profile to running AI agents, in four steps.
      </h2>
      <ul className="flex flex-col gap-5 mb-8">
        {HOW_IT_WORKS_STEPS.map((s) => (
          <li key={s.step} className="flex items-start gap-4">
            <span className="font-mkt-mono text-xs text-[#9aa59c] shrink-0 mt-0.5">{s.step}</span>
            <div>
              <h3 className="font-mkt-display text-base font-semibold text-[#101613] mb-1">{s.title}</h3>
              <p className="text-sm text-[#3d4a3d] leading-relaxed">{s.description}</p>
            </div>
          </li>
        ))}
      </ul>
      <BookDemoButton
        origin="how-it-works"
        className="w-full sm:w-auto justify-center px-6 py-3 rounded-lg bg-[#101613] text-white font-semibold hover:bg-[#1c2620] transition-colors min-h-[48px]"
      />
    </>
  );
}

// Only ever rendered inside the dark "AI engine" zone — styled for that
// background permanently, matching AgentBrandLabel above.
function AgentCopy({ agent }: { agent: (typeof AGENTS)[number] }) {
  return (
    <>
      <div className="flex items-center gap-3 mb-4">
        <AgentBrandLabel brand={agent.brand} />
        <ActiveStatusPill />
      </div>
      <h2 className="font-mkt-display text-xl sm:text-2xl font-semibold text-white mb-5 leading-snug">
        {agent.title}
      </h2>
      <ul className="flex flex-col gap-3 mb-8">
        {agent.bullets.map((bullet) => (
          <li key={bullet} className="flex items-start gap-3 text-sm sm:text-base text-white/70 leading-relaxed">
            <span className="mt-0.5 shrink-0 w-5 h-5 rounded-md bg-[#4ade80]/15 flex items-center justify-center">
              <MaterialIcon name="check" size={14} className="text-[#4ade80]" />
            </span>
            {bullet}
          </li>
        ))}
      </ul>
      <BookDemoButton
        origin={agent.ctaOrigin}
        className="w-full sm:w-auto justify-center px-5 py-2.5 rounded-md bg-[#25D366] text-white font-semibold hover:bg-[#1ebe57] transition-colors shadow-sm min-h-[44px]"
      />
    </>
  );
}

function phaseCopy(id: PhaseId) {
  if (id === "hero") return <HeroCopy />;
  if (id === "how-it-works") return <HowItWorksCopy />;
  const agent = AGENTS.find((a) => a.brand === id)!;
  return <AgentCopy agent={agent} />;
}

// ── Main component ─────────────────────────────────────────────────────────

// Home's visual environment changes twice down the scroll: hero and "how it
// works" stay on the light canvas (per the brief, the interaction itself —
// not decoration — should carry "how it works"); the four AI agents render
// inside a dark "you've entered the engine" zone (index 2 onward). No
// repeating decorative pattern anywhere — just light/dark contrast, real
// product UI, and one soft one-off glow behind the hero panel.
const ENGINE_ZONE_START = 2; // PHASES[2] = "gbp", the first agent

export function HomeSplitExperience() {
  const [activePhase, setActivePhase] = useState(0);
  const sectionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const engineZoneRef = useRef<HTMLDivElement | null>(null);
  const [engineZoneRect, setEngineZoneRect] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = Number(entry.target.getAttribute("data-phase-index"));
            if (!Number.isNaN(idx)) setActivePhase(idx);
          }
        });
      },
      { rootMargin: "-40% 0px -40% 0px", threshold: 0 }
    );
    sectionRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // The dark "engine zone" band needs to span the FULL section width
  // (behind both the copy column and the sticky panel), but it only knows
  // its own vertical bounds from measuring the (left-column-only) wrapper
  // around the agent phases — so it's rendered at the section root and
  // positioned via measured top/height rather than nested inside that
  // narrower column.
  useEffect(() => {
    const el = engineZoneRef.current;
    if (!el) return;
    const update = () => setEngineZoneRect({ top: el.offsetTop, height: el.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <section className="relative bg-(--mkt-surface)">
      {/* Soft one-off glow behind the hero panel — product-photography
          lighting, not a repeating decorative element (used nowhere else). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] sm:h-[680px]"
        style={{ background: "radial-gradient(ellipse 50% 55% at 68% 20%, rgba(10,138,62,0.14), transparent 70%)" }}
      />

      {/* Dark "AI engine" band — full section width, height matched to the
          agent phases only (measured from engineZoneRef below). Plain flat
          edge, straight boundary between the light and dark zones. */}
      {engineZoneRect && (
        <div
          aria-hidden
          className="absolute inset-x-0"
          style={{
            top: engineZoneRect.top,
            height: engineZoneRect.height,
            background: "var(--mkt-ink)",
          }}
        />
      )}

      <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6 md:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
          {/* Left: scrolling copy, one block per phase */}
          <div className="lg:col-span-7">
            {PHASES.slice(0, ENGINE_ZONE_START).map((phase, i) => (
              <div
                key={phase.id}
                id={phase.id === "how-it-works" ? "features" : undefined}
                ref={(el) => { sectionRefs.current[i] = el; }}
                data-phase-index={i}
                className={`flex flex-col justify-center ${
                  i === 0 ? "pt-28 sm:pt-32 pb-12 lg:pt-40 lg:pb-24" : "py-12 lg:py-24"
                } ${phase.id === "how-it-works" ? "scroll-mt-20" : ""}`}
              >
                {phaseCopy(phase.id)}
                <div className="lg:hidden mt-8 max-w-md mx-auto w-full">
                  <InkPanelShell>{phase.body}</InkPanelShell>
                </div>
              </div>
            ))}

            {/* Engine zone — the 4 AI agents, dark background (see above) */}
            <div ref={engineZoneRef}>
              {PHASES.slice(ENGINE_ZONE_START).map((phase, j) => {
                const i = ENGINE_ZONE_START + j;
                return (
                  <div
                    key={phase.id}
                    ref={(el) => { sectionRefs.current[i] = el; }}
                    data-phase-index={i}
                    className="flex flex-col justify-center py-12 lg:py-24"
                  >
                    {phaseCopy(phase.id)}
                    <div className="lg:hidden mt-8 max-w-md mx-auto w-full">
                      <InkPanelShell>{phase.body}</InkPanelShell>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: single sticky panel, body cross-fades with activePhase (lg+ only) */}
          <div className="hidden lg:block lg:col-span-5">
            <div className="lg:sticky lg:top-24">
              <InkPanelShell>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={activePhase}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25 }}
                  >
                    {PHASES[activePhase].body}
                  </motion.div>
                </AnimatePresence>
              </InkPanelShell>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
