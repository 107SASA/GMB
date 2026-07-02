# Security Best Practices

## 1. Webhook Validation
Currently, `/api/webhook/twilio` accepts any POST request. In production, you **must** validate the `X-Twilio-Signature` header to ensure the request actually originated from Twilio, preventing malicious actors from spamming your Inngest queue with fake messages.

## 2. Inngest Security
Inngest is secured via the `INNGEST_SIGNING_KEY`. The `serve()` function in `/api/inngest/route.ts` automatically rejects any incoming requests that do not match the cryptographic signature, preventing abuse of your background workers.

## 3. Rate Limiting
Next.js API routes are vulnerable to DDoS. Implement Vercel KV (Redis) rate-limiting on routes like `/api/upload` to prevent malicious users from uploading massive CSVs repeatedly and draining database resources.

## 4. NextAuth Integration
The current `/dashboard` relies on basic React Context. For multi-tenant production, wrap the `src/app/dashboard/layout.tsx` in a strict `next-auth` middleware that rejects unauthenticated sessions and ties users strictly to their own `businessId`.
