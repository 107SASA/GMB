import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { FreeReportButton } from "@/components/shared/FreeReportButton";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";

export const metadata: Metadata = {
  title: "GBP Booster",
  description:
    "Rank higher on Google with GrowwMatics AI — profile analysis, review automation, and local SEO tips that get you more leads and customers.",
  alternates: { canonical: "/gbp-booster" },
  openGraph: {
    title: "GBP Booster | GrowwMatics AI",
    description:
      "AI-powered Google Business Profile growth — audits, reviews, and ranking tips for local businesses.",
    url: "/gbp-booster",
    type: "website",
  },
};

const FEATURES = [
  {
    title: "Analyse Your Profile — SEO Report",
    description:
      "Instant analysis of your Google Business Profile with prioritized optimization steps so you know exactly what to fix first.",
    image: "/marketing/gbp-booster/feature-seo.jpg",
    imageAlt: "SEO report card dashboard",
  },
  {
    title: "AI Posts, Auto-Scheduled to Google",
    // TODO(design): swap this image for a real screenshot of the content
    // calendar / scheduler UI — feature-website.jpg is a placeholder left
    // over from the old "website builder" claim and doesn't match this copy.
    description:
      "AI writes and schedules hyper-local Google posts every week — your profile stays active without you lifting a finger.",
    image: "/marketing/gbp-booster/feature-website.jpg",
    imageAlt: "AI-generated Google Business Profile post calendar",
  },
  {
    title: "More 5-Star Reviews, Effortlessly",
    description:
      "Automated review request campaigns that convert happy customers into 5-star reviews — without chasing them yourself.",
    image: "/marketing/gbp-booster/feature-reviews-qr.jpg",
    imageAlt: "QR code review request stand",
  },
  {
    title: "Reply to Customer Reviews — Instantly",
    description:
      "Intelligent, personalized responses to reviews within minutes so you show you care and build stronger trust.",
    image: "/marketing/gbp-booster/feature-reply.jpg",
    imageAlt: "Review reply management screen",
  },
  {
    title: "Tips to Rank Higher on Google",
    description:
      "Ongoing local SEO tips and updates delivered where you already work — so your profile keeps improving week after week.",
    image: "/marketing/gbp-booster/feature-tips.jpg",
    imageAlt: "WhatsApp ranking tips conversation",
  },
] as const;

export default function GbpBoosterPage() {
  const boostHref = boostProfileLink();

  return (
    <main className="theme-marketing min-h-screen bg-white selection:bg-primary-fixed">
      <Navbar />

      {/* Hero */}
      <section className="mkt-ink-panel relative pt-20 sm:pt-24 md:pt-28 overflow-hidden">
        <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6 md:px-12 py-12 sm:py-16 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            <div className="lg:col-span-7 text-white text-center lg:text-left">
              <div className="mkt-label inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-(--mkt-ink-border) mb-5 sm:mb-6">
                <MaterialIcon name="chat" size={14} className="text-[#4ade80]" />
                <span className="text-[#4ade80]">Google Business Profile WhatsApp AI</span>
              </div>
              <h1 className="font-mkt-display text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-semibold leading-[1.1] tracking-tight mb-6 sm:mb-8">
                Rank #1 on Google.
                <br />
                Get more leads &amp; customers.
              </h1>
              <a
                href={boostHref}
                {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-3.5 rounded-lg bg-[#4ade80] text-[#0a120e] font-bold hover:bg-[#6ee89b] transition-colors shadow-md min-h-[48px]"
              >
                <WhatsAppIcon size={18} />
                Boost My Business, For Free
              </a>
            </div>

            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div className="relative w-[200px] sm:w-[260px] md:w-[300px] lg:w-[340px] rounded-[2rem] sm:rounded-[2.5rem] border-8 sm:border-[10px] border-(--mkt-ink-border) bg-(--mkt-ink-elevated) shadow-2xl overflow-hidden">
                <img
                  src="/marketing/gbp-booster/phone-hero.jpg"
                  alt="GrowwMatics AI GBP Booster on WhatsApp"
                  className="w-full h-auto block"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature timeline */}
      <section className="relative py-14 sm:py-20 md:py-28 px-4 sm:px-6 md:px-12 bg-(--mkt-surface)">
        <div className="max-w-[1280px] mx-auto">
          <p className="mkt-label text-[#006e2c] text-center mb-2">Capabilities</p>
          <h2 className="font-mkt-display text-2xl sm:text-3xl md:text-5xl font-semibold text-center text-[#101613] mb-10 sm:mb-16 md:mb-20 tracking-tight">
            Ways AI boosts your visibility on{" "}
            <span className="text-[#006e2c]">Google</span>
          </h2>

          <div className="relative">
            <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-(--mkt-line) -translate-x-1/2" />

            <div className="flex flex-col gap-12 sm:gap-16 md:gap-24">
              {FEATURES.map((feature, i) => {
                const imageRight = i % 2 === 0;
                return (
                  <div key={feature.title} className="relative grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8 md:gap-16 items-center">
                    <div
                      className="hidden md:flex items-center justify-center absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-md bg-[#006e2c] border-4 border-(--mkt-surface) shadow z-10 font-mkt-mono text-[10px] font-bold text-white"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </div>

                    <div className={imageRight ? "md:order-1 md:pr-10" : "md:order-2 md:pl-10"}>
                      <h3 className="font-mkt-display text-xl sm:text-2xl md:text-3xl font-semibold text-[#101613] mb-2 sm:mb-3">
                        {feature.title}
                      </h3>
                      <p className="text-sm sm:text-base text-[#3d4a3d] leading-relaxed max-w-md">
                        {feature.description}
                      </p>
                    </div>

                    <div className={imageRight ? "md:order-2" : "md:order-1"}>
                      <div className="rounded-xl overflow-hidden border border-(--mkt-line) bg-white shadow-card">
                        <img
                          src={feature.image}
                          alt={feature.imageAlt}
                          className="w-full h-auto object-cover aspect-[4/3]"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-12 sm:mt-16 md:mt-20 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-4">
            <FreeReportButton className="w-full sm:w-auto px-8 py-3.5 sm:py-4 rounded-lg bg-[#006e2c] text-white font-semibold hover:bg-[#005a24] transition-colors min-h-[48px]" />
            <BookDemoButton
              origin="gbp-booster"
              className="w-full sm:w-auto px-8 py-3.5 sm:py-4 rounded-lg border border-(--mkt-line) text-[#101613] font-semibold hover:border-[#006e2c] hover:text-[#006e2c] transition-colors min-h-[48px]"
            />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
