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
    <main className="min-h-screen bg-white">
      <Navbar />

      <section className="pt-32 pb-24 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="mb-12 border-b border-slate-200 pb-8">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 mb-4">
              {title}
            </h1>
            {intro && <p className="text-lg text-slate-500 leading-relaxed">{intro}</p>}
            <p className="text-sm text-slate-400 mt-4">Last updated: {LEGAL_LAST_UPDATED}</p>
          </div>

          <div className="legal-prose space-y-8 text-slate-600 leading-relaxed">
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
      <h2 className="text-xl md:text-2xl font-bold text-slate-900 mb-3">{heading}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
