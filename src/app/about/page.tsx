import type { Metadata } from "next";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { BookDemoButton } from "@/components/shared/BookDemoButton";
import { FreeReportButton } from "@/components/shared/FreeReportButton";
import { InkCtaPanel } from "@/components/shared/InkCtaPanel";

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

/**
 * "Editorial Feature Story" redesign (Aug 2026) — About is a narrative page,
 * not a product page, so it deliberately doesn't reuse Home's sticky-panel
 * product-dashboard device. Asymmetric hero, a large pull-quote moment, and
 * alternating image/text rows instead of the previous centered-hero +
 * boxed-stat-cards + single dark-panel-grid template. Same copy, images,
 * stats, and CTA origins as before.
 */
export default function AboutPage() {
  return (
    <main className="theme-marketing min-h-screen bg-white selection:bg-primary-fixed">
      <Navbar />

      {/* Hero — asymmetric, not centered */}
      <section className="relative pt-28 sm:pt-32 md:pt-40 pb-14 sm:pb-20 px-4 sm:px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-start">
            <div className="lg:col-span-7">
              <p className="mkt-label inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-(--mkt-line) bg-white text-[#006e2c] mb-6">
                About Growwmatics
              </p>
              <h1 className="font-mkt-display text-[2rem] sm:text-5xl md:text-6xl font-semibold text-[#101613] leading-[1.08] tracking-tight mb-6">
                Helping local business grow{" "}
                <span className="text-[#006e2c]">effortlessly.</span>
              </h1>
              <p className="text-base sm:text-lg text-[#3d4a3d] max-w-xl leading-relaxed">
                Most local customers find a business through Google search or Maps before they
                ever visit a website. Growwmatics makes sure that first impression — your Google
                Business Profile — works as hard as the rest of your business.
              </p>
            </div>

            <div className="lg:col-span-5 lg:mt-16">
              <div className="rounded-2xl overflow-hidden border border-(--mkt-line) shadow-card">
                <img
                  src="/marketing/about/owners-collage.png"
                  alt="Local business owners GrowwMatics AI serves"
                  className="w-full h-auto object-cover max-h-[220px] sm:max-h-[260px] lg:max-h-[320px]"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pull quote */}
      <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 md:px-12 bg-(--mkt-surface)">
        <div className="max-w-3xl mx-auto text-center">
          <span className="font-mkt-display text-6xl sm:text-7xl text-[#006e2c]/25 leading-none block mb-2" aria-hidden>
            &ldquo;
          </span>
          <p className="font-mkt-display text-2xl sm:text-3xl md:text-4xl font-medium text-[#101613] leading-snug tracking-tight">
            We built Growwmatics after seeing the same gaps hold local businesses back —
            again and again.
          </p>
        </div>
      </section>

      {/* Alternating problem rows */}
      <section className="py-16 sm:py-20 md:py-24 px-4 sm:px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <p className="mkt-label text-[#006e2c] mb-3">The problem we witnessed</p>
          <h2 className="font-mkt-display text-2xl sm:text-3xl md:text-4xl font-semibold text-[#101613] tracking-tight mb-14 sm:mb-20 max-w-2xl">
            Four gaps that hold local businesses back
          </h2>

          <div className="flex flex-col gap-16 sm:gap-20">
            {/* Row 1 — image left */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">
              <div className="lg:col-span-5">
                <img
                  src="/marketing/about/baker.png"
                  alt="Local bakery business"
                  className="w-full h-56 sm:h-64 object-cover rounded-2xl border border-(--mkt-line) shadow-card"
                />
              </div>
              <div className="lg:col-span-7 flex flex-col gap-8">
                {PROBLEMS.slice(0, 2).map((item, i) => (
                  <div key={item.title} className="flex gap-4">
                    <span className="font-mkt-mono text-xs text-[#9aa59c] shrink-0 mt-1.5">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="font-mkt-display text-lg sm:text-xl font-semibold text-[#101613] mb-1.5">
                        {item.title}
                      </h3>
                      <p className="text-[#3d4a3d] leading-relaxed max-w-md">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Row 2 — image right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-center">
              <div className="lg:col-span-7 flex flex-col gap-8 lg:order-1 order-2">
                {PROBLEMS.slice(2, 4).map((item, i) => (
                  <div key={item.title} className="flex gap-4">
                    <span className="font-mkt-mono text-xs text-[#9aa59c] shrink-0 mt-1.5">
                      {String(i + 3).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="font-mkt-display text-lg sm:text-xl font-semibold text-[#101613] mb-1.5">
                        {item.title}
                      </h3>
                      <p className="text-[#3d4a3d] leading-relaxed max-w-md">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="lg:col-span-5 lg:order-2 order-1">
                <img
                  src="/marketing/about/handyman.png"
                  alt="Local service business"
                  className="w-full h-56 sm:h-64 object-cover rounded-2xl border border-(--mkt-line) shadow-card"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats — inline, rule-separated, typographic rather than boxed cards */}
      <section className="relative py-14 sm:py-16 px-4 sm:px-6 md:px-12 bg-(--mkt-surface)">
        <div className="max-w-[1280px] mx-auto">
          <div className="flex flex-col sm:flex-row items-center justify-center divide-y sm:divide-y-0 sm:divide-x divide-(--mkt-line)">
            {STATS.map((stat) => (
              <div key={stat.label} className="text-center px-8 py-4 sm:py-0">
                <div className="font-mkt-mono text-3xl md:text-4xl font-semibold text-[#006e2c] mb-1.5">
                  {stat.value}
                </div>
                <div className="mkt-label text-[#6b756f]">{stat.label}</div>
              </div>
            ))}
          </div>
          <div className="flex justify-center mt-10">
            <BookDemoButton
              origin="about-page"
              className="px-7 py-3 rounded-lg bg-[#006e2c] text-white font-semibold hover:bg-[#005a24] transition-colors"
            />
          </div>
        </div>
      </section>

      <InkCtaPanel
        heading="Ready for real growth?"
        description="Run a free audit of your Google Business Profile, or book a free demo and we'll walk you through it on WhatsApp."
      >
        <FreeReportButton className="w-full sm:w-auto px-8 py-3.5 bg-[#4ade80] text-[#0a120e] rounded-lg font-bold hover:bg-[#6ee89b] transition-all shadow-md" />
        <BookDemoButton
          origin="about-page:final-cta"
          className="w-full sm:w-auto px-8 py-3.5 bg-transparent border border-(--mkt-ink-border) text-white rounded-lg font-bold hover:bg-white/5 transition-all"
        />
      </InkCtaPanel>

      <Footer />
    </main>
  );
}
