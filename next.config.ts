import type { NextConfig } from "next";

// Security headers applied to every response. These are safe, broadly-compatible
// defaults; a full Content-Security-Policy is intentionally left as a follow-up
// because it needs per-page testing (Razorpay, Google Maps, inline scripts).
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
