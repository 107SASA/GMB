import Link from "next/link";
import { boostProfileLink, bookDemoOpensWhatsApp } from "@/lib/whatsappCta";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BRAND_ATTRIBUTION } from "@/lib/companyInfo";
import { SERVICES } from "@/lib/servicesData";

export function Footer() {
  return (
    <footer className="py-20 px-6 border-t border-outline-variant bg-surface-container-low">
      <div className="max-w-container-max mx-auto grid grid-cols-1 md:grid-cols-5 gap-12">
        <div className="col-span-1 md:col-span-1">
          <Link href="/" className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <MaterialIcon name="rocket_launch" size={18} className="text-on-primary" />
            </div>
            <span className="text-xl font-heading font-bold tracking-tight text-on-surface">
              GrowwMatics AI
            </span>
          </Link>
          <p className="text-on-surface-variant text-sm leading-relaxed mb-6">
            The #1 AI-powered platform for local business growth and Google Business Profile automation.
          </p>
        </div>

        <div>
          <h4 className="font-heading font-bold text-on-surface mb-6">OnDemand Service</h4>
          <ul className="space-y-4 text-sm text-on-surface-variant">
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
          <h4 className="font-heading font-bold text-on-surface mb-6">Product</h4>
          <ul className="space-y-4 text-sm text-on-surface-variant">
            <li>
              <Link href="/features" className="hover:text-primary transition-colors">
                Features
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
          <h4 className="font-heading font-bold text-on-surface mb-6">Get Started</h4>
          <ul className="space-y-4 text-sm text-on-surface-variant">
            <li>
              <Link href="/free-report" className="hover:text-primary transition-colors">
                Get Free Report
              </Link>
            </li>
            <li>
              <Link href="/login" className="hover:text-primary transition-colors">
                Sign In
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:text-primary transition-colors">
                Contact Us
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-heading font-bold text-on-surface mb-6">Legal</h4>
          <ul className="space-y-4 text-sm text-on-surface-variant">
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

      <div className="max-w-container-max mx-auto mt-20 pt-8 border-t border-outline-variant text-center text-outline text-xs space-y-1">
        <p>© {new Date().getFullYear()} GrowwMatics AI. All rights reserved. Built for the future of local SEO.</p>
        <p>{BRAND_ATTRIBUTION}</p>
      </div>
    </footer>
  );
}
