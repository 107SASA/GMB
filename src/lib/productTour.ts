/**
 * Dashboard product tour — walks a new user through the core first-value
 * path: connect Google, add photos, publish a first post, turn on review
 * requests. See context/ProductTourContext.tsx for the state machine and
 * components/tour/ProductTourOverlay.tsx for the spotlight UI.
 *
 * Each step's `selector` must match a real `data-tour="<id>"` attribute
 * already placed on the target element in the page it lives on — see the
 * grep-able list below so a future UI refactor doesn't quietly break this:
 *   connect-google        → app/dashboard/gbp-profile/page.tsx
 *   upload-photo          → components/gbp/GbpMediaManager.tsx
 *   generate-content      → components/content/ContentWorkspace.tsx
 *   review-campaigns-tab  → app/dashboard/reviews/page.tsx
 */
export interface TourStep {
  id: string;
  route: string;
  selector: string;
  title: string;
  body: string;
}

export const PRODUCT_TOUR_STEPS: TourStep[] = [
  {
    id: 'connect-google',
    route: '/dashboard/gbp-profile',
    selector: '[data-tour="connect-google"]',
    title: 'Step 1 — Connect your Google Business Profile',
    body: "Link your Google account so we can pull your live listing and let you manage it here. This unlocks everything else — posts, photos and reviews all publish through this connection.",
  },
  {
    id: 'upload-photo',
    route: '/dashboard/gbp-profile',
    selector: '[data-tour="upload-photo"]',
    title: 'Step 2 — Add your photos',
    body: 'Upload a logo and cover photo here so your profile looks complete to customers browsing on Google.',
  },
  {
    id: 'generate-content',
    route: '/dashboard/content',
    selector: '[data-tour="generate-content"]',
    title: 'Step 3 — Create your first post',
    body: 'Generate AI-written posts for your business, then schedule them to keep your profile active on Google.',
  },
  {
    id: 'review-campaigns-tab',
    route: '/dashboard/reviews',
    selector: '[data-tour="review-campaigns-tab"]',
    title: 'Step 4 — Start collecting reviews',
    body: 'Turn on review-request campaigns here to bring in more 5-star reviews from your customers automatically.',
  },
];
