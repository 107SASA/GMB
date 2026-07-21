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

const nextConfig: NextConfig = {
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
