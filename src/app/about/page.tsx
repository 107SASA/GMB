import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { SectionHeading, Accent } from "@/components/ui/SectionHeading";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "GrowwMatics AI builds AI-powered tools that help local businesses win on Google — audits, content, reviews, and lead conversion in one platform.",
  alternates: { canonical: "/about" },
};

const VALUES = [
  {
    icon: "bolt",
    title: "Built for busy owners",
    description:
      "You're running a business, not a marketing agency. Every feature is designed to take work off your plate, not add another dashboard to check.",
  },
  {
    icon: "verified",
    title: "Real data, honest numbers",
    description:
      "Every score and recommendation in your report comes from your actual Google Business Profile — no invented stats, no vague claims.",
  },
  {
    icon: "diversity_3",
    title: "Local business, always",
    description:
      "We're built specifically for local — salons, clinics, restaurants, repair shops — not repurposed enterprise software with the edges filed down.",
  },
];

export default function AboutPage() {
  return (
    <main className="theme-marketing min-h-screen bg-background selection:bg-primary-fixed">
      <Navbar />

      <div className="pt-24 md:pt-28 px-6">
        <nav aria-label="Breadcrumb" className="max-w-5xl mx-auto text-sm text-on-surface-variant flex items-center gap-2">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <MaterialIcon name="chevron_right" size={16} className="text-outline" />
          <span className="text-on-surface font-medium">About Us</span>
        </nav>
      </div>

      <section className="pt-10 pb-20 px-6 max-w-4xl mx-auto text-center">
        <h1 className="font-heading text-3xl md:text-5xl font-bold text-on-surface mb-6 leading-[1.15]">
          Helping local businesses <Accent>win where customers are looking</Accent>
        </h1>
        <p className="text-lg text-on-surface-variant max-w-2xl mx-auto leading-relaxed">
          Most local customers find a business through a Google search or a Google Maps pin before
          they ever visit a website. GrowwMatics AI exists to make sure that first impression —
          your Google Business Profile — is working as hard as the rest of your business.
        </p>
      </section>

      <section className="py-20 px-6 bg-surface-container-lowest">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <SectionHeading
              align="left"
              eyebrow="What we do"
              title={<>An AI team for your <Accent>local visibility</Accent></>}
              className="mb-6"
            />
            <p className="text-on-surface-variant leading-relaxed mb-4">
              GrowwMatics AI audits your Google Business Profile, generates and schedules
              locally-optimized posts, replies to reviews, and turns enquiries into a real CRM
              pipeline — the day-to-day work of local marketing, automated.
            </p>
            <p className="text-on-surface-variant leading-relaxed">
              It's one platform instead of five disconnected tools, priced for a single local
              business rather than a marketing department.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { icon: "search", label: "GBP Audits" },
              { icon: "edit", label: "AI Content" },
              { icon: "chat", label: "Review Replies" },
              { icon: "group", label: "Lead CRM" },
            ].map((item) => (
              <div
                key={item.label}
                className="p-6 rounded-xl bg-surface-container-lowest border border-outline-variant card-shadow text-center"
              >
                <div className="w-11 h-11 rounded-xl bg-linear-to-br from-primary-fixed to-primary-fixed-dim/60 border border-primary-fixed-dim text-primary flex items-center justify-center mx-auto mb-3">
                  <MaterialIcon name={item.icon} size={20} />
                </div>
                <div className="text-sm font-bold text-on-surface">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6 max-w-6xl mx-auto">
        <SectionHeading
          eyebrow="Who it's for"
          title={<>What we <Accent>believe</Accent></>}
          className="mb-16"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {VALUES.map((value) => (
            <div
              key={value.title}
              className="p-8 rounded-xl bg-surface-container-lowest border border-outline-variant card-shadow"
            >
              <div className="w-12 h-12 rounded-xl bg-linear-to-br from-primary-fixed to-primary-fixed-dim/60 border border-primary-fixed-dim text-primary flex items-center justify-center mb-6">
                <MaterialIcon name={value.icon} size={22} />
              </div>
              <h3 className="font-heading text-lg font-bold text-on-surface mb-3">{value.title}</h3>
              <p className="text-on-surface-variant text-sm leading-relaxed">{value.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="py-24 px-6">
        <div className="max-w-5xl mx-auto p-12 md:p-20 rounded-xl bg-[#141a12] relative overflow-hidden text-center card-shadow">
          <div className="absolute -top-20 -right-20 w-64 h-64 bg-primary/20 blur-[100px] rounded-full pointer-events-none" />
          <div className="relative z-10">
            <h2 className="font-heading text-3xl md:text-5xl font-extrabold text-white mb-6">
              Want to see it on your own profile?
            </h2>
            <p className="text-white/70 text-lg max-w-2xl mx-auto mb-10">
              Run a free audit, or book a free consultant and we'll walk you through it on WhatsApp.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/free-report"
                className="w-full sm:w-auto px-10 py-5 bg-white text-on-surface rounded-lg font-bold hover:bg-white/90 transition-all card-shadow"
              >
                Get My Free Report
              </Link>
              <BookDemoButton
                origin="about-page"
                className="w-full sm:w-auto px-10 py-5 bg-whatsapp text-white rounded-lg font-bold hover:opacity-90 transition-all card-shadow"
              >
                Book a Free Consultant
              </BookDemoButton>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
