import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { FreeReportButton } from "@/components/shared/FreeReportButton";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "GrowwMatics AI builds AI-powered tools that help local businesses win on Google — audits, content, reviews, and lead conversion in one platform.",
  alternates: { canonical: "/about" },
};

const STATS = [
  { value: "2.3+ Cr", label: "Micro businesses in India" },
  { value: "32%+", label: "Contribution to India's GDP" },
  { value: "90%+", label: "Never tried digital marketing" },
] as const;

const PROBLEMS = [
  {
    title: "No marketing skills",
    description: "Owners are experts at their craft — not Google Ads, SEO, or content calendars.",
  },
  {
    title: "High agency costs",
    description: "Traditional agencies are priced for brands, not a single local shop.",
  },
  {
    title: "Unreliable budget options",
    description: "Cheap freelancers and DIY tools create uneven results and wasted spend.",
  },
  {
    title: "Tools not built for them",
    description: "Enterprise software assumes a marketing team — local owners don't have one.",
  },
] as const;

export default function AboutPage() {
  return (
    <main className="theme-marketing min-h-screen bg-white selection:bg-primary-fixed">
      <Navbar />

      {/* Hero */}
      <section className="pt-24 sm:pt-28 md:pt-32 pb-10 sm:pb-12 px-4 sm:px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto text-center">
          <h1 className="font-heading text-[1.75rem] sm:text-4xl md:text-5xl lg:text-6xl font-extrabold text-[#181c1c] leading-[1.15] mb-4 sm:mb-5 tracking-tight">
            Helping Local Business{" "}
            <span className="text-[#006e2c]">Grow Effortlessly</span>
          </h1>
          <p className="text-sm sm:text-base md:text-lg text-[#3d4a3d] max-w-3xl mx-auto leading-relaxed mb-8 sm:mb-10">
            Most local customers find a business through Google search or Maps before they ever
            visit a website. GrowwMatics AI makes sure that first impression — your Google Business
            Profile — works as hard as the rest of your business.
          </p>
          <div className="rounded-xl sm:rounded-2xl overflow-hidden border border-[#e0e3e1] shadow-md">
            <img
              src="/marketing/about/owners-collage.png"
              alt="Local business owners GrowwMatics AI serves"
              className="w-full h-auto object-cover max-h-[180px] sm:max-h-[240px] md:max-h-[280px]"
            />
          </div>
        </div>
      </section>

      {/* Stats / intro */}
      <section className="py-12 sm:py-16 md:py-24 px-4 sm:px-6 md:px-12 bg-[#f7faf8]">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center mb-12 md:mb-16">
            <h2 className="font-heading text-3xl md:text-4xl font-bold text-[#181c1c] mb-4 tracking-tight">
              We&apos;re Building for Small Business Owners
            </h2>
            <p className="text-[#3d4a3d] max-w-2xl mx-auto leading-relaxed">
              GrowwMatics AI audits your Google Business Profile, generates and schedules
              locally-optimized posts, replies to reviews, and turns enquiries into a real CRM
              pipeline — local marketing, automated.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-4xl md:text-5xl font-extrabold text-[#06b34c] mb-2">
                  {stat.value}
                </div>
                <div className="text-sm text-[#3d4a3d]">{stat.label}</div>
              </div>
            ))}
          </div>

          <div className="flex justify-center">
            <BookDemoButton
              origin="about-page"
              className="px-7 py-3 rounded-lg bg-[#006e2c] text-white font-semibold hover:bg-[#005a24] transition-colors"
            />
          </div>
        </div>
      </section>

      {/* Why we started */}
      <section className="py-16 md:py-24 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="rounded-3xl bg-[#06b34c] p-8 md:p-14 text-white overflow-hidden">
            <div className="text-center mb-10 md:mb-12">
              <h2 className="font-heading text-3xl md:text-4xl font-bold mb-3 tracking-tight">
                Why We Started
              </h2>
              <p className="text-white/90 max-w-xl mx-auto">
                We built GrowwMatics AI after seeing the same gaps hold local businesses back again
                and again.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-white/80 mb-6">
                  The problem we witnessed
                </p>
                <ul className="space-y-5">
                  {PROBLEMS.map((item, i) => (
                    <li key={item.title} className="flex gap-4 border-b border-white/20 pb-5 last:border-0 last:pb-0">
                      <span className="w-6 h-6 rounded-full bg-white text-[#06b34c] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <div>
                        <div className="font-bold text-white mb-0.5">{item.title}</div>
                        <div className="text-sm text-white/85 leading-relaxed">{item.description}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <img
                  src="/marketing/about/baker.png"
                  alt="Local bakery business"
                  className="w-full h-40 md:h-44 object-cover rounded-2xl"
                />
                <img
                  src="/marketing/about/handyman.png"
                  alt="Local service business"
                  className="w-full h-40 md:h-44 object-cover rounded-2xl"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="pb-20 md:pb-28 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="rounded-3xl bg-[#06b34c] p-8 md:p-12 flex flex-col lg:flex-row items-center gap-10 overflow-hidden">
            <div className="flex-1 text-white">
              <h2 className="font-heading text-3xl md:text-4xl font-bold mb-4 tracking-tight">
                Ready for Real Growth?
              </h2>
              <p className="text-white/90 leading-relaxed mb-8 max-w-md">
                Run a free audit of your Google Business Profile, or book a free demo and we&apos;ll
                walk you through it on WhatsApp.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <FreeReportButton className="px-6 py-3 rounded-lg bg-white text-[#006e2c] font-bold hover:bg-white/95 transition-colors" />
                <BookDemoButton
                  origin="about-page:final-cta"
                  className="px-6 py-3 rounded-lg bg-white/15 border border-white/40 text-white font-semibold hover:bg-white/25 transition-colors"
                />
              </div>
            </div>
            <div className="shrink-0 w-40 md:w-48">
              <img
                src="/marketing/about/cta-phone.jpg"
                alt="Growth analytics on phone"
                className="w-full h-auto drop-shadow-xl"
              />
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
