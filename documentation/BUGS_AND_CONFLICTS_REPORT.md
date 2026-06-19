# Bugs & Conflicts Audit Report

During the Phase 10 Stabilization pass, the following legacy conflicts were identified and resolved to ensure cross-module stability:

## 1. `businessId` Mismatches
**Issue:** Modules 1-4 originally hardcoded `tenantId='demo-tenant'`, while Modules 5-9 assumed a multi-business architecture. 
**Resolution:** Implemented NextAuth.js. All API routes now extract `activeBusinessId` dynamically from the user's JWT session, ensuring global context consistency.

## 2. Inngest Review Campaign Collision
**Issue:** In `functions.ts`, there were two distinct stubs for review campaigns (`startCampaign` vs the new `processReviewCampaign` from Module 9). 
**Resolution:** Replaced the old stub with the newly implemented, Groq-powered multi-step drip campaign. The `route.ts` Inngest handler was updated to export only the correct function.

## 3. Duplicate Webhook Handling
**Issue:** The Twilio Webhook was synchronously calling external APIs in early modules, creating a risk of timeouts.
**Resolution:** The Webhook was stabilized to perform immediate DB inserts (logging the message) and then instantly dispatching an `inngest.send` event. The webhook now returns an HTTP 200 XML response within milliseconds, preventing Twilio from endlessly retrying.

## 4. Opt-Out Compliance
**Issue:** Modules 5 and 6 did not have strict opt-out paths for outbound CRM messages.
**Resolution:** Updated the webhook to intercept "STOP", "UNSUBSCRIBE", and "CANCEL" keywords natively, flagging the models across the entire organization so no module can accidentally spam an opted-out user.
