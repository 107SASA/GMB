/**
 * Review links tapped inside WhatsApp / Instagram open Google's write-review
 * page in Chrome (already signed in) instead of the in-app browser.
 *
 * Run with: node --experimental-strip-types --test tests/integration/review-open-in-browser.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChromeIntentUrl,
  chooseReviewOpenMode,
  renderReviewOpenPage,
  reviewOpenResponse,
} from '../../src/lib/reviewOpenInBrowser.ts';

const URL_ = 'https://search.google.com/local/writereview?placeid=ChIJabc123XYZ_def';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_INSTAGRAM = `${ANDROID_WEBVIEW} Instagram 350.0.0.0 Android`;
const ANDROID_SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const ANDROID_GOOGLE_APP = `${ANDROID_WEBVIEW} GSA/15.0.0`;
const IOS_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
const IOS_FB = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

test('already-signed-in browsers get the plain redirect', () => {
  for (const ua of [ANDROID_CHROME, ANDROID_GOOGLE_APP, IOS_SAFARI, IOS_CHROME, DESKTOP, '']) {
    assert.equal(chooseReviewOpenMode(ua, URL_), 'redirect', ua);
  }
});

test('Android in-app and other browsers are handed to Chrome', () => {
  for (const ua of [ANDROID_WEBVIEW, ANDROID_INSTAGRAM, ANDROID_SAMSUNG]) {
    assert.equal(chooseReviewOpenMode(ua, URL_), 'android-chrome', ua);
  }
});

test('iOS in-app browsers get the Chrome / Safari choice', () => {
  assert.equal(chooseReviewOpenMode(IOS_FB, URL_), 'ios-choose');
});

test('the generic fallback is never wrapped', () => {
  assert.equal(chooseReviewOpenMode(ANDROID_WEBVIEW, 'https://google.com'), 'redirect');
});

test('the Chrome intent keeps the full URL and falls back to it', () => {
  const intent = buildChromeIntentUrl(URL_);
  assert.equal(
    intent,
    `intent://search.google.com/local/writereview?placeid=ChIJabc123XYZ_def#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(URL_)};end`
  );
});

test('page offers Chrome and a stay-here link; previews still get a 302', () => {
  const android = renderReviewOpenPage('android-chrome', URL_);
  assert.match(android, /Open in Chrome/);
  assert.match(android, /location\.replace\("intent:\/\//);
  const ios = renderReviewOpenPage('ios-choose', URL_);
  assert.match(ios, /googlechromes:\/\/search\.google\.com/);
  assert.match(ios, /x-safari-https:\/\//);

  const preview = reviewOpenResponse(URL_, { userAgent: ANDROID_WEBVIEW, isPreview: true });
  assert.equal(preview.status, 302);
  assert.equal(preview.headers.get('location'), URL_);
  const page = reviewOpenResponse(URL_, { userAgent: ANDROID_WEBVIEW });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') || '', /text\/html/);
});
