import Link from "next/link";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { BRAND_ATTRIBUTION, COMPANY } from "@/lib/companyInfo";
import { SERVICES } from "@/lib/servicesData";
import { GbpBoosterPromo } from "@/components/sections/GbpBoosterPromo";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

// Touch widths (phones + tablets): each link is a 40px-tall tap row in place of
// the old list gap, which left ~17–20px targets. lg+: inline links, spacing as before.
const FOOTER_LINK = "inline-flex items-center min-h-10 lg:min-h-0 hover:text-primary transition-colors";

/**
 * `hideBoosterPromo`: form pages (free report, book demo) opt out of the floating
 * booster pill — on small phones it sat on top of the form fields and Submit.
 */
export function Footer({ hideBoosterPromo = false }: { hideBoosterPromo?: boolean } = {}) {
  return (
    <footer className="theme-marketing py-10 sm:py-12 md:py-16 px-4 sm:px-6 border-t border-(--mkt-line) bg-white">
      <div className="max-w-container-max mx-auto grid grid-cols-2 sm:grid-cols-2 md:grid-cols-5 gap-8 sm:gap-10 md:gap-12">
        <div className="col-span-2 md:col-span-1">
          <Link href="/" className="flex items-center gap-2 mb-4 sm:mb-6">
            <img src="/brand/icon.png" alt="GrowwMatics AI" className="w-8 h-8 object-contain" />
            <span className="font-mkt-display text-lg sm:text-xl font-semibold tracking-tight text-[#101613]">
              Growwmatics
            </span>
          </Link>
          <p className="text-on-surface-variant text-sm leading-relaxed mb-4 sm:mb-6 max-w-sm">
            The AI-powered platform for local business growth and Google Business Profile automation.
          </p>
          {COMPANY.address && (
            <p className="text-on-surface-variant text-xs leading-relaxed max-w-sm">
              {COMPANY.address}
            </p>
          )}
        </div>

        <div>
          <h4 className="mkt-label text-[#6b756f] mb-4 sm:mb-6">OnDemand Service</h4>
          <ul className="lg:space-y-4 text-sm text-on-surface-variant">
            {SERVICES.map((service) => (
              <li key={service.slug}>
                <Link href={`/services/${service.slug}`} className={FOOTER_LINK}>
                  {service.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mkt-label text-[#6b756f] mb-4 sm:mb-6">Product</h4>
          <ul className="lg:space-y-4 text-sm text-on-surface-variant">
            <li>
              <Link href="/features" className={FOOTER_LINK}>
                Features
              </Link>
            </li>
            <li>
              <Link href="/gbp-booster" className={FOOTER_LINK}>
                GBP Booster
              </Link>
            </li>
            <li>
              <Link href="/about" className={FOOTER_LINK}>
                About Us
              </Link>
            </li>
            <li>
              <Link href="/pricing" className={FOOTER_LINK}>
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/faq" className={FOOTER_LINK}>
                FAQ
              </Link>
            </li>
            <li>
              <a
                href={boostProfileLink()}
                {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={FOOTER_LINK}
              >
                Get Report on WhatsApp
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="mkt-label text-[#6b756f] mb-4 sm:mb-6">Get Started</h4>
          <ul className="lg:space-y-4 text-sm text-on-surface-variant">
            <li>
              <Link href="/free-report" className={FOOTER_LINK}>
                Get Free Report
              </Link>
            </li>
            <li>
              <BookDemoButton origin="footer" showIcon={false} className={FOOTER_LINK} />
            </li>
            <li>
              <Link href="/contact" className={FOOTER_LINK}>
                Contact Us
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="mkt-label text-[#6b756f] mb-4 sm:mb-6">Legal</h4>
          <ul className="lg:space-y-4 text-sm text-on-surface-variant">
            <li>
              <Link href="/privacy" className={FOOTER_LINK}>
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link href="/terms" className={FOOTER_LINK}>
                Terms &amp; Conditions
              </Link>
            </li>
            <li>
              <Link href="/refund" className={FOOTER_LINK}>
                Refund &amp; Cancellation
              </Link>
            </li>
            <li>
              <Link href="/delete-account" className={FOOTER_LINK}>
                Delete Your Account
              </Link>
            </li>
            <li>
              <Link href="/contact" className={FOOTER_LINK}>
                Contact Us
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="max-w-container-max mx-auto mt-8 sm:mt-10 md:mt-12 pt-6 sm:pt-8 pb-3 sm:pb-4 border-t border-(--mkt-line) text-center text-outline text-xs space-y-1.5 px-2">
        <p>© {new Date().getFullYear()} GrowwMatics AI. All rights reserved. Built for the future of local SEO.</p>
        <p>{BRAND_ATTRIBUTION}</p>
        <p>
          {COMPANY.legalName} · CIN {COMPANY.cin}
          {COMPANY.address ? ` · Registered office: ${COMPANY.address}` : ''}
        </p>
      </div>

      {!hideBoosterPromo && <GbpBoosterPromo />}
    </footer>
  );
}
