import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { LEGAL_LAST_UPDATED } from "@/lib/companyInfo";

/**
 * Shared chrome + typography for the public legal pages (privacy, terms,
 * refund, contact). Keeps them visually consistent with the marketing site.
 */
export function LegalLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <main className="theme-marketing min-h-screen bg-[#f7faf8]">
      <Navbar />

      <section className="pt-32 pb-24 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-12 border-b border-[#e0e3e1] pb-8">
            <h1 className="font-heading text-4xl md:text-5xl font-extrabold tracking-tight text-[#181c1c] mb-4">
              {title}
            </h1>
            {intro && <p className="text-lg text-[#3d4a3d] leading-relaxed">{intro}</p>}
            <p className="text-sm text-[#9aa59c] mt-4">Last updated: {LEGAL_LAST_UPDATED}</p>
          </div>

          <div className="legal-prose space-y-8 text-[#3d4a3d] leading-relaxed">
            {children}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}

/** A titled section within a legal page. */
export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-heading text-xl md:text-2xl font-bold text-[#181c1c] mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
