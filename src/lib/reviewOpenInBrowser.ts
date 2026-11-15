/**
 * Where a tapped review link should open.
 *
 * Google's "Write a review" page needs a signed-in Google account. When a
 * customer taps the link inside WhatsApp's (or Instagram's / Facebook's)
 * built-in browser, that browser has no Google sign-in, so Google asks them
 * to log in and most customers give up. Chrome on the phone is already
 * signed in with the phone's Google account.
 *
 * So:
 *   - Desktop, real Chrome, the Google app, iOS Safari, link previews → plain 302.
 *   - Android in-app browsers and other Android browsers → a tiny page that
 *     hands the review URL to Chrome (intent://, falls back to the same URL).
 *   - iOS in-app browsers → a tiny page with "Open in Chrome" / "Open in Safari".
 *
 * Pure: no database, no Next.js imports.
 */

export type ReviewOpenMode = 'redirect' | 'android-chrome' | 'ios-choose';

const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp|\bLine\/|Snapchat|MicroMessenger|Twitter|LinkedInApp|Telegram/i;
const ANDROID_OTHER_BROWSER = /SamsungBrowser|MiuiBrowser|XiaoMi|OPR\/|Opera|UCBrowser|EdgA\/|YaBrowser|HeyTapBrowser|VivoBrowser|OppoBrowser|Firefox|DuckDuckGo|PhxBrowser|Silk\//i;
const GOOGLE_APP = /\bGSA\//;

export function chooseReviewOpenMode(userAgent: string | null | undefined, reviewUrl: string): ReviewOpenMode {
  const ua = userAgent || '';
  // Only Google's own write-review page needs the hand-off.
  if (!/^https:\/\/search\.google\.com\/local\/writereview\?/.test(reviewUrl)) return 'redirect';

  if (/Android/i.test(ua)) {
    if (GOOGLE_APP.test(ua)) return 'redirect';
    const webView = /; wv\)/.test(ua) || /Version\/\d+\.\d+.*Chrome\//.test(ua);
    const realChrome = /Chrome\/\d/.test(ua) && !webView && !IN_APP.test(ua) && !ANDROID_OTHER_BROWSER.test(ua);
    return realChrome ? 'redirect' : 'android-chrome';
  }

  if (/iPhone|iPad|iPod/i.test(ua)) {
    if (/CriOS\//.test(ua) || GOOGLE_APP.test(ua)) return 'redirect';
    return IN_APP.test(ua) ? 'ios-choose' : 'redirect';
  }

  return 'redirect';
}

/** Android intent that opens the https URL in Chrome; without Chrome it loads the same URL. */
export function buildChromeIntentUrl(httpsUrl: string): string {
  const rest = httpsUrl.replace(/^https:\/\//, '');
  return `intent://${rest}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`;
}

/** iOS Chrome's own scheme for an https URL. */
export function buildIosChromeUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https:\/\//, 'googlechromes://');
}

/** iOS 17+ scheme that opens the URL in Safari itself. */
export function buildIosSafariUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https:\/\//, 'x-safari-https://');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderReviewOpenPage(mode: Exclude<ReviewOpenMode, 'redirect'>, reviewUrl: string): string {
  const here = escapeHtml(reviewUrl);
  let buttons: string;
  let script = '';
  if (mode === 'android-chrome') {
    const intent = buildChromeIntentUrl(reviewUrl);
    buttons = `<a class="btn primary" href="${escapeHtml(intent)}">Open in Chrome</a>`;
    // JSON.stringify + escaping "<" keeps the URL inert inside the script tag.
    script = `<script>try{location.replace(${JSON.stringify(intent).replace(/</g, '\\u003c')})}catch(e){}</script>`;
  } else {
    buttons = `<a class="btn primary" href="${escapeHtml(buildIosChromeUrl(reviewUrl))}">Open in Chrome</a>`
      + `<a class="btn" href="${escapeHtml(buildIosSafariUrl(reviewUrl))}">Open in Safari</a>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Leave a Google review</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, system-ui, Roboto, sans-serif; background: #f6f7f9; color: #1a1a1a; }
  main { max-width: 420px; margin: 0 auto; padding: 48px 20px; text-align: center; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { font-size: 15px; line-height: 1.5; color: #555; margin: 0 0 28px; }
  .btn { display: block; padding: 16px; margin: 0 0 12px; border-radius: 12px; font-size: 17px; font-weight: 600; text-decoration: none; border: 1px solid #d0d4da; color: #1a1a1a; background: #fff; }
  .btn.primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
  .here { display: inline-block; margin-top: 12px; font-size: 14px; color: #1a73e8; }
  @media (prefers-color-scheme: dark) {
    body { background: #121212; color: #eee; }
    p { color: #aaa; }
    .btn { background: #1e1e1e; border-color: #333; color: #eee; }
    .here { color: #8ab4f8; }
  }
</style>
</head>
<body>
<main>
  <h1>Leave a Google review</h1>
  <p>Open it in Chrome, where you're already signed in to Google, so you can post your review right away.</p>
  ${buttons}
  <a class="here" href="${here}">Continue in this browser</a>
</main>
${script}
</body>
</html>`;
}

/**
 * The response for a tapped review link: a 302, or the small hand-off page.
 * Link-preview fetches always get the plain 302.
 */
export function reviewOpenResponse(reviewUrl: string, visit: { userAgent?: string | null; isPreview?: boolean }): Response {
  const mode = visit.isPreview ? 'redirect' : chooseReviewOpenMode(visit.userAgent, reviewUrl);
  if (mode === 'redirect') {
    return new Response(null, { status: 302, headers: { Location: String(new URL(reviewUrl)), 'Cache-Control': 'no-store' } });
  }
  return new Response(renderReviewOpenPage(mode, reviewUrl), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
