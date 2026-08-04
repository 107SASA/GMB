import type { Metadata } from "next";
import { Inter, Public_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

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
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0&display=swap"
        />
      </head>
      <body
        className={`${inter.variable} ${publicSans.variable} ${inter.className} antialiased bg-background text-on-surface`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
