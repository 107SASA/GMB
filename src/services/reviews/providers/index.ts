import { MockGoogleProvider } from './MockGoogleProvider';
import { SerpApiGoogleProvider } from './SerpApiGoogleProvider';

export type ReviewProvider = MockGoogleProvider | SerpApiGoogleProvider;

export function getReviewProvider(): ReviewProvider {
  const explicitProvider = process.env.REVIEW_PROVIDER;
  const hasSerpKey = !!process.env.SERPAPI_KEY;

  // Explicit override to mock, or no key available → safe fallback
  if (explicitProvider === 'mock' || !hasSerpKey) {
    console.log('[ReviewProvider] Using MockGoogleProvider (REVIEW_PROVIDER=mock or missing SERPAPI_KEY)');
    return new MockGoogleProvider();
  }

  console.log('[ReviewProvider] Using SerpApiGoogleProvider');
  return new SerpApiGoogleProvider();
}
