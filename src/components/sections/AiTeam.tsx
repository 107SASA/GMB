"use client";

import { useId } from "react";
import { motion } from "framer-motion";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";

function AiSparkle({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `ai-sparkle-${uid}`;
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#A142F4" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradId})`}
        d="M12 2.5l1.7 5.2L19 9.4l-5.3 1.7L12 16.5l-1.7-5.4L5 9.4l5.3-1.7L12 2.5z"
      />
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

type AgentBrand =
  | "gbp"
  | "whatsapp-chat"
  | "whatsapp-marketing"
  | "data";

function AgentBrandLabel({ brand }: { brand: AgentBrand }) {
  if (brand === "gbp") {
    return (
      <div className="inline-flex items-center flex-wrap gap-x-2 gap-y-1 text-sm sm:text-base md:text-lg">
        <span className="inline-flex items-baseline gap-1 sm:gap-1.5">
          <GoogleWord />
          <span className="font-semibold text-[#1A73E8]">Business Profile</span>
        </span>
        <span className="text-[#C5CAE9] font-light select-none" aria-hidden>
          |
        </span>
        <span className="inline-flex items-center gap-1.5 text-[#181c1c]">
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
            <span className="text-[#25D366]">WhatsApp</span>{" "}
            <span className="text-[#181c1c]">{second}</span>
          </span>
        </span>
        <span className="text-[#B3B9F0] font-light select-none" aria-hidden>
          |
        </span>
        <span className="inline-flex items-center gap-1.5 text-[#181c1c]">
          <AiSparkle />
          <span className="font-medium">AI Agent</span>
        </span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center flex-wrap gap-x-2.5 gap-y-1 text-base md:text-lg">
      <span className="inline-flex items-center gap-2 font-bold text-[#181c1c]">
        <MaterialIcon name="psychology" size={22} className="text-[#006e2c]" />
        Data Intelligence
      </span>
      <span className="text-[#B3B9F0] font-light select-none" aria-hidden>
        |
      </span>
      <span className="inline-flex items-center gap-1.5 text-[#181c1c]">
        <AiSparkle />
        <span className="font-medium">AI Engine</span>
      </span>
    </div>
  );
}

const AGENTS: {
  brand: AgentBrand;
  title: string;
  image: string;
  bullets: string[];
}[] = [
  {
    brand: "gbp",
    title: "AI Agent to Get You More Leads from Google",
    image: "/marketing/home/agent-gbp.png",
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
    bullets: [
      "One shared brain across GBP, chat, and marketing agents",
      "Analytics dashboard for growth, calls, and conversions",
      "Learns your business category, services, and customers",
      "Turns every interaction into smarter next actions",
      "Keeps your local SEO and lead funnel aligned",
    ],
  },
];

export function AiTeam() {
  return (
    <section id="features" className="py-14 sm:py-20 md:py-28 px-4 sm:px-6 md:px-12 bg-white">
      <div className="max-w-[1280px] mx-auto">
        <div className="text-center mb-10 sm:mb-14 md:mb-20">
          <h2 className="font-heading text-2xl sm:text-3xl md:text-5xl font-bold text-[#181c1c] tracking-tight">
            Meet Your Digital Marketing{" "}
            <span className="text-[#006e2c]">AI Team</span>
          </h2>
        </div>

        <div className="flex flex-col gap-12 sm:gap-16 md:gap-24">
          {AGENTS.map((agent, i) => (
            <motion.div
              key={agent.brand}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.45 }}
              className="flex flex-col gap-4 sm:gap-5"
            >
              <AgentBrandLabel brand={agent.brand} />

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-12 items-start">
                <div className="lg:col-span-5 bg-[#f2f9f6] border border-[#e0e3e1] rounded-2xl p-4 sm:p-5 md:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
                  <img
                    src={agent.image}
                    alt=""
                    className="w-20 h-20 sm:w-24 sm:h-24 md:w-28 md:h-28 rounded-2xl object-cover shadow-md border-4 border-white shrink-0 mx-auto sm:mx-0"
                  />
                  <div className="flex flex-col items-stretch sm:items-start gap-3 sm:gap-4 min-w-0 text-center sm:text-left">
                    <h3 className="font-heading text-lg sm:text-xl md:text-2xl font-bold text-[#181c1c] leading-snug">
                      {agent.title}
                    </h3>
                    <BookDemoButton
                      origin={`ai-team-${i}`}
                      className="w-full sm:w-auto justify-center px-5 py-2.5 rounded-lg bg-[#25D366] text-white font-semibold hover:bg-[#1ebe57] transition-colors shadow-sm min-h-[44px]"
                    />
                  </div>
                </div>

                <ul className="lg:col-span-7 flex flex-col gap-3 sm:gap-4 pt-1">
                  {agent.bullets.map((bullet) => (
                    <li
                      key={bullet}
                      className="flex items-start gap-3 text-[#3d4a3d] text-sm sm:text-base md:text-lg leading-relaxed"
                    >
                      <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-[rgba(7,176,76,0.15)] flex items-center justify-center">
                        <MaterialIcon name="check" size={14} className="text-[#006e2c]" />
                      </span>
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
