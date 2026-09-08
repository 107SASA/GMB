# Content-Security-Policy

## Current state — REPORT-ONLY

`next.config.ts` sends `Content-Security-Policy-Report-Only` on every response.
It **does not block anything** — the browser only logs violations to the
console. Purpose: watch real production traffic for a release or two, fix any
legitimate violations, then enforce.

## Required external origins (why each is in the policy)

| Directive | Host | Used by |
| --- | --- | --- |
| `script-src` | `checkout.razorpay.com` | Razorpay checkout widget (`useRazorpayCheckout.ts` injects `<script src=…/v1/checkout.js>`) |
| `script-src` | `maps.googleapis.com`, `*.gstatic.com` | Google Maps JS (if any client-side Maps is used; static maps are already proxied server-side) |
| `connect-src` | `*.razorpay.com`, `lumberjack.razorpay.com` | Razorpay checkout XHR + telemetry |
| `connect-src` | `maps.googleapis.com` | Maps API calls |
| `connect-src` | `api.groq.com` | (only if any client calls Groq directly — review; may be removable) |
| `frame-src` | `api.razorpay.com`, `checkout.razorpay.com` | Razorpay checkout iframe |
| `frame-src` | `accounts.google.com` | Google OAuth account chooser |
| `style-src` | `fonts.googleapis.com` | Google Fonts stylesheet |
| `font-src` | `fonts.gstatic.com`, `data:` | Google Font files + inlined fonts |
| `img-src` | `https:` (broad) | GBP media, DO Spaces CDN, `lh*.googleusercontent.com`, competitor photos — many hosts; images can't execute so a broad allow is acceptable |

## Inline script / style requirements (blockers for a strict policy)

- **`script-src 'unsafe-inline' 'unsafe-eval'`** — still required:
  - Next.js App Router injects inline bootstrap/flight scripts with no nonce.
    Enforcing a nonce needs a `middleware`/`proxy.ts` nonce generator + threading
    it through the document (`headers()` → `<Script nonce>`); non-trivial with
    the current setup.
  - Razorpay `checkout.js` uses `eval`.
- **`style-src 'unsafe-inline'`** — styled-jsx and inline `style={}` props.

## Path to enforcement

1. Ship report-only (done). Collect violations for ~1–2 releases.
2. Optionally add a lightweight report collector: a route that accepts
   `application/csp-report` POSTs and logs them, referenced via `report-uri`.
3. Remove any origin that never legitimately appears; add any that do.
4. Do the Next.js nonce work to drop `'unsafe-inline'` from `script-src`.
5. Rename the header `Content-Security-Policy-Report-Only` →
   `Content-Security-Policy` to enforce. Keep report-only alongside for a bit.

Never use `*` as a shortcut.
