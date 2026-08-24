import type { Metadata } from "next";
import { Inter, Public_Sans } from "next/font/google";
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
  logo: "https://growwmatics.com/favicon.ico",
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

export const metadata: Metadata = {
  metadataBase: new URL("https://growwmatics.com"),

  title: {
    default: "GrowwMatics AI",
    template: "%s | GrowwMatics AI",
  },

  applicationName: "GrowwMatics AI",

  description:
    "Automate your Google Business Profile, generate more reviews, convert leads instantly, and grow local visibility using AI.",

  keywords: [
    "Google Business Profile",
    "Local SEO",
    "AI Marketing",
    "WhatsApp Automation",
    "Business Growth",
  ],

  openGraph: {
    title: "GrowwMatics AI",
    description:
      "Automate your Google Business Profile, generate more reviews, convert leads instantly, and grow local visibility using AI.",
    url: "https://growwmatics.com",
    siteName: "GrowwMatics AI",
    type: "website",
  },

  twitter: {
    card: "summary_large_image",
    title: "GrowwMatics AI",
    description:
      "Automate your Google Business Profile, generate more reviews, convert leads instantly, and grow local visibility using AI.",
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
        className={`${inter.variable} ${publicSans.variable} ${inter.className} antialiased bg-background text-on-surface`}
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
