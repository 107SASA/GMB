import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Public_Sans, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { JsonLd } from "@/components/seo/JsonLd";

// Site-wide, not homepage-only: Google explicitly allows (and effectively
// expects) Organization/WebSite markup to appear on every page rather than
// just "/" — it's what backs brand-name search results (site name + logo in
// the SERP) and Sitelinks Search Box eligibility, neither of which is tied
// to which page the crawler happened to fetch first.
const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "GrowwMatics AI",
  url: "https://growwmatics.com",
  logo: "https://growwmatics.com/icon.png",
  description: "AI-powered Google Business Profile management and local SEO for local businesses in India.",
  areaServed: { "@type": "Country", name: "India" },
  sameAs: [] as string[], // TODO: add real social profile URLs here once they exist — an empty/fake list actively hurts entity confidence, so leave empty until real ones are set.
};

const websiteSchema = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "GrowwMatics AI",
  url: "https://growwmatics.com",
};

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-public-sans",
});

// Marketing-site-only typographic voice (redesign, Aug 2026). Kept as
// separate variables rather than repointing --font-heading so the
// dashboard/admin/auth surfaces — which also read --font-heading — are
// unaffected; only components that opt in via .font-mkt-display /
// .font-mkt-mono (scoped under .theme-marketing, see globals.css) use these.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://growwmatics.com"),

  title: {
    default: "GrowwMatics AI — Google Business Profile Management & Local SEO",
    template: "%s | GrowwMatics AI",
  },

  applicationName: "GrowwMatics AI",

  description:
    "AI that runs your Google Business Profile: Google posts, review replies, more 5-star reviews and WhatsApp lead follow-up for local businesses in India. Free GBP report.",

  keywords: [
    "Google Business Profile management",
    "GMB management",
    "Google My Business optimization",
    "local SEO India",
    "Google reviews",
    "review management",
    "WhatsApp automation",
    "GrowwMatics",
  ],

  // Search Console ownership tag — set GOOGLE_SITE_VERIFICATION in
  // .env.production (the content="..." value Search Console gives you).
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
    : {}),

  openGraph: {
    title: "GrowwMatics AI — Google Business Profile Management & Local SEO",
    description:
      "AI that runs your Google Business Profile: Google posts, review replies, more 5-star reviews and WhatsApp lead follow-up for local businesses in India. Free GBP report.",
    url: "https://growwmatics.com",
    siteName: "GrowwMatics AI",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "GrowwMatics AI — Google Business Profile Management & Local SEO",
    description:
      "AI that runs your Google Business Profile: Google posts, review replies, more 5-star reviews and WhatsApp lead follow-up for local businesses in India. Free GBP report.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" data-scroll-behavior="smooth">
      <head>
        {/* Google tag (gtag.js). Measurement ID is public. Loaded from the
            shared document head so the landing page and every other route
            send page views. */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-SNVHQ3RW4B"
          strategy="afterInteractive"
        />
        <Script id="gtag-init" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-SNVHQ3RW4B');
          `}
        </Script>
        {/* Speeds up the external Material Symbols stylesheet below — the
            browser can open the connection before it even parses the <link>
            that needs it, instead of discovering the domain cold. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0&display=swap"
        />
        <JsonLd data={organizationSchema} />
        <JsonLd data={websiteSchema} />
      </head>
      <body
        className={`${inter.variable} ${publicSans.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${inter.className} antialiased bg-background text-on-surface`}
        // Grammarly (and similar extensions) inject data-gr-ext-installed /
        // data-new-gr-c-s-check-loaded onto <body> before React hydrates —
        // a real client-vs-server mismatch, but caused by the browser, not
        // this app. suppressHydrationWarning only silences the warning for
        // this element's own attributes; it doesn't hide real mismatches in
        // children. See https://nextjs.org/docs/messages/react-hydration-error
        suppressHydrationWarning
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
