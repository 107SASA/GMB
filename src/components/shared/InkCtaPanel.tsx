import { MaterialIcon } from "@/components/ui/MaterialIcon";

/**
 * Shared closing-CTA panel — the dark "ink" command-center surface used by
 * the homepage's FinalCTA. Previously every secondary page (FAQ, Features,
 * ServicePageTemplate, ServicesHub, ...) duplicated its own copy of a
 * green-gradient rounded banner; centralizing it here means the whole site
 * shares one closing-CTA visual instead of repeating the same markup five
 * times, and any future tweak only happens in one place.
 */
export function InkCtaPanel({
  eyebrow,
  heading,
  description,
  children,
}: {
  eyebrow?: string;
  heading: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-20 md:py-28 px-6 md:px-12">
      <div className="mkt-ink-panel max-w-[1184px] mx-auto rounded-2xl border border-(--mkt-ink-border) px-6 py-14 sm:px-10 sm:py-16 md:px-16 md:py-20 text-center">
        {eyebrow && (
          <div className="mkt-label inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-(--mkt-ink-border) mb-6">
            <MaterialIcon name="bolt" size={13} className="text-[#4ade80]" />
            <span className="text-[#4ade80]">{eyebrow}</span>
          </div>
        )}
        <h2 className="font-mkt-display text-2xl sm:text-3xl md:text-5xl font-semibold text-white tracking-tight mb-4 leading-tight">
          {heading}
        </h2>
        {description && (
          <p className="text-(--mkt-ink-text-dim) text-base sm:text-lg max-w-2xl mx-auto mb-8 sm:mb-10">
            {description}
          </p>
        )}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">{children}</div>
      </div>
    </section>
  );
}
