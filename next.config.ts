import type { NextConfig } from "next";

/**
 * Content-Security-Policy — shipped as REPORT-ONLY (Phase 11).
 *
 * Report-Only never blocks anything; the browser only logs violations to the
 * console (and to `report-uri` if a collector is added). This lets us watch
 * real traffic for a release or two, confirm nothing legitimate trips it, then
 * flip the header name to `Content-Security-Policy` to enforce.
 *
 * Origins allow-listed and why (see documentation/security/csp.md):
 *  - script-src: 'unsafe-inline'/'unsafe-eval' are still required — Next.js
 *    injects inline bootstrap scripts (no nonce wired yet) and Razorpay's
 *    checkout.js needs eval. Tightening this needs the nonce work tracked in
 *    csp.md. Razorpay + Google Maps JS are the only third-party script hosts.
 *  - connect-src: Razorpay (checkout XHR/telemetry) + Google Maps.
 *  - frame-src: Razorpay checkout iframe + Google account chooser (OAuth).
 *  - img-src https: — GBP media, DO Spaces CDN, Google user content and
 *    competitor photos all load from many hosts; images can't execute, so a
 *    broad allow here is acceptable.
 *  - font-src: Google Fonts. style-src 'unsafe-inline': styled-jsx / inline styles.
 */
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://maps.googleapis.com https://*.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://*.razorpay.com https://lumberjack.razorpay.com https://maps.googleapis.com https://api.groq.com",
  "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://accounts.google.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// Security headers applied to every response.
const securityHeaders = [
  // Force HTTPS for 2 years once seen over HTTPS. Ignored over http://localhost,
  // so it is safe to send in every environment.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Clickjacking protection — only our own origin may frame our pages.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Stop browsers from MIME-sniffing a response away from its declared type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send only the origin (not the full path) on cross-origin navigations.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Disable powerful browser APIs the app does not use.
  { key: "Permissions-Policy", value: "camera=(), microphone=()" },
  // CSP in report-only mode — observe first, enforce later (see csp.md).
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

// Dashboard pages render per-session data server-side (DashboardLayout calls
// requireClient()) but ship no explicit cache directive of their own, so a
// browser's back/forward cache (bfcache) is free to restore a previously
// rendered authenticated view verbatim after logout — the page just reappears
// with no re-check. Login already avoids the mirror-image problem with a
// hard navigation (see (auth)/login/page.tsx); this closes the logout side.
const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, must-revalidate" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  // `next dev`'s built-in cross-origin protection only trusts localhost by
  // default — any request arriving with a different Host header (e.g. a
  // phone on the LAN hitting this machine's IP directly, which the mobile
  // app does for local testing — see mobile/.env) gets a warning response
  // instead of reaching the actual route. That response isn't JSON, which
  // is why it showed up client-side as a Zod "expected object, received
  // string" error rather than anything login-specific.
  //
  // NOT used in production — that config comes from .env.production /
  // whatever domain the app is actually deployed behind, this only affects
  // `next dev`. Update this IP if it changes (DHCP can reassign it — same
  // caveat as mobile/.env, check with `ipconfig`).
  allowedDevOrigins: ['192.168.1.34'],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/dashboard/:path*", headers: noStoreHeaders },
      { source: "/admin/:path*", headers: noStoreHeaders },
    ];
  },
};

export default nextConfig;
