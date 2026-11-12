type OGImageDescriptor = { url: string; width: number; height: number; alt: string };

/**
 * Shared Open Graph fields for marketing pages.
 *
 * Next.js merges `openGraph` SHALLOWLY across segments: a page/layout that
 * sets its own `openGraph` replaces the root layout's object entirely — and
 * with it the image from app/opengraph-image.tsx, siteName and locale. That
 * left most marketing pages with no og:image at all (blank link previews on
 * WhatsApp / LinkedIn / X). Spread this into every page-level `openGraph`:
 *
 *   openGraph: { ...sharedOpenGraph, title: "...", url: "/x" }
 */
export const sharedOpenGraph: { siteName: string; locale: string; images: OGImageDescriptor[] } = {
  siteName: "Growwmatics AI",
  locale: "en_IN",
  images: [
    {
      url: "/opengraph-image",
      width: 1200,
      height: 630,
      alt: "Growwmatics AI — Google Business Profile management & local SEO",
    },
  ],
};
