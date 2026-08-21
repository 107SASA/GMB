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
      <section className="relative pt-20 sm:pt-24 md:pt-28 overflow-hidden bg-[#06b34c]">
        <div className="pointer-events-none absolute -top-20 -right-16 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-10 left-10 w-64 h-64 rounded-full bg-black/10 blur-3xl" />

        <div className="relative max-w-[1280px] mx-auto px-4 sm:px-6 md:px-12 py-12 sm:py-16 md:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            <div className="lg:col-span-7 text-white text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full bg-white/15 border border-white/25 text-xs sm:text-sm font-semibold mb-5 sm:mb-6 backdrop-blur-sm">
                <MaterialIcon name="chat" size={16} className="text-white" />
                Google Business Profile WhatsApp AI
              </div>
              <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold leading-[1.1] tracking-tight mb-6 sm:mb-8">
                Rank #1 on Google.
                <br />
                Get More Leads &amp; Customers.
              </h1>
              <a
                href={boostHref}
                {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto px-7 py-3.5 rounded-lg bg-white text-[#006e2c] font-bold hover:bg-white/95 transition-colors shadow-md min-h-[48px]"
              >
                <WhatsAppIcon size={18} />
                Boost My Business, For Free
              </a>
            </div>

            <div className="lg:col-span-5 flex justify-center lg:justify-end">
              <div className="relative w-[200px] sm:w-[260px] md:w-[300px] lg:w-[340px] rounded-[2rem] sm:rounded-[2.5rem] border-8 sm:border-[10px] border-[#e6e9e7] bg-white shadow-2xl overflow-hidden">
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
      <section className="py-14 sm:py-20 md:py-28 px-4 sm:px-6 md:px-12 bg-[#f7faf8]">
        <div className="max-w-[1280px] mx-auto">
          <h2 className="font-heading text-2xl sm:text-3xl md:text-5xl font-bold text-center text-[#181c1c] mb-10 sm:mb-16 md:mb-20 tracking-tight">
            Ways AI Boosts Your Visibility on{" "}
            <span className="text-[#006e2c]">Google</span>
          </h2>

          <div className="relative">
            <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-[#d0d7d1] -translate-x-1/2" />

            <div className="flex flex-col gap-12 sm:gap-16 md:gap-24">
              {FEATURES.map((feature, i) => {
                const imageRight = i % 2 === 0;
                return (
                  <div key={feature.title} className="relative grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8 md:gap-16 items-center">
                    <div
                      className="hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#06b34c] border-4 border-white shadow z-10"
                    />

                    <div className={imageRight ? "md:order-1 md:pr-10" : "md:order-2 md:pl-10"}>
                      <h3 className="font-heading text-xl sm:text-2xl md:text-3xl font-bold text-[#181c1c] mb-2 sm:mb-3">
                        {feature.title}
                      </h3>
                      <p className="text-sm sm:text-base text-[#3d4a3d] leading-relaxed max-w-md">
                        {feature.description}
                      </p>
                    </div>

                    <div className={imageRight ? "md:order-2" : "md:order-1"}>
                      <div className="rounded-xl sm:rounded-2xl overflow-hidden border border-[#e0e3e1] bg-white shadow-lg">
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
              className="w-full sm:w-auto px-8 py-3.5 sm:py-4 rounded-lg border-2 border-[#006e2c] text-[#006e2c] font-semibold hover:bg-white transition-colors min-h-[48px]"
            />
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
