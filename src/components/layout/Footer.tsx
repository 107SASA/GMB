import Link from "next/link";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { BRAND_ATTRIBUTION, COMPANY } from "@/lib/companyInfo";
import { SERVICES } from "@/lib/servicesData";
import { GbpBoosterPromo } from "@/components/sections/GbpBoosterPromo";
import { BookDemoButton } from "@/components/shared/BookDemoButton";

export function Footer() {
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
          <p className="text-on-surface-variant text-xs leading-relaxed max-w-sm">
            {COMPANY.address}
          </p>
        </div>

        <div>
          <h4 className="mkt-label text-[#6b756f] mb-4 sm:mb-6">OnDemand Service</h4>
          <ul className="space-y-3 sm:space-y-4 text-sm text-on-surface-variant">
            {SERVICES.map((service) => (
              <li key={service.slug}>
                <Link href={`/services/${service.slug}`} className="hover:text-primary transition-colors">
                  {service.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mkt-label text-[#6b756f] mb-4 sm:mb-6">Product</h4>
          <ul className="space-y-3 sm:space-y-4 text-sm text-on-surface-variant">
            <li>
              <Link href="/features" className="hover:text-primary transition-colors">
                Features
              </Link>
            </li>
            <li>
              <Link href="/gbp-booster" className="hover:text-primary transition-colors">
                GBP Booster
              </Link>
            </li>
            <li>
              <Link href="/about" className="hover:text-primary transition-colors">
                About Us
              </Link>
            </li>
            <li>
              <Link href="/pricing" className="hover:text-primary transition-colors">
                Pricing
              </Link>
            </li>
            <li>
              <Link href="/faq" className="hover:text-primary transition-colors">
                FAQ
              </Link>
            </li>
            <li>
              <a
                href={boostProfileLink()}
                {...(bookDemoOpensWhatsApp ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className="hover:text-primary transition-colors"
              >
                Get Report on WhatsApp
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="mkt-label text-[#6b756f] mb-4 sm:mb-6">Get Started</h4>
          <ul className="space-y-3 sm:space-y-4 text-sm text-on-surface-variant">
            <li>
              <Link href="/free-report" className="hover:text-primary transition-colors">
                Get Free Report
              </Link>
            </li>
            <li>
              <BookDemoButton origin="footer" showIcon={false} className="hover:text-primary transition-colors" />
            </li>
            <li>
              <Link href="/contact" className="hover:text-primary transition-colors">
                Contact Us
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="mkt-label text-[#6b756f] mb-4 sm:mb-6">Legal</h4>
          <ul className="space-y-3 sm:space-y-4 text-sm text-on-surface-variant">
            <li>
              <Link href="/privacy" className="hover:text-primary transition-colors">
                Privacy Policy
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-primary transition-colors">
                Terms &amp; Conditions
              </Link>
            </li>
            <li>
              <Link href="/refund" className="hover:text-primary transition-colors">
                Refund &amp; Cancellation
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:text-primary transition-colors">
                Contact Us
              </Link>
            </li>
          </ul>
        </div>
      </div>

      <div className="max-w-container-max mx-auto mt-8 sm:mt-10 md:mt-12 pt-6 sm:pt-8 pb-3 sm:pb-4 border-t border-(--mkt-line) text-center text-outline text-xs space-y-1.5 px-2">
        <p>© {new Date().getFullYear()} GrowwMatics AI. All rights reserved. Built for the future of local SEO.</p>
        <p>{BRAND_ATTRIBUTION}</p>
      </div>

      <GbpBoosterPromo />
    </footer>
  );
}
