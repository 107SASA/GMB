# Queue and Workers (Inngest)

The platform is fully decoupled via event-driven architecture using **Inngest**.

## 1. Why Inngest?
Serverless platforms (like Vercel) terminate functions quickly (often 10-15s). Twilio webhooks timeout after 15s. To do long-running tasks (like waiting for Groq APIs or sleeping for 2 days during a drip campaign), we must use a background queue.

## 2. Component Layout
- `src/app/api/inngest/route.ts`: The Next.js bridge. It exposes a single API route that the Inngest cloud pings to execute your code.
- `src/services/inngest/client.ts`: Instantiates the `inngest` object.
- `src/services/inngest/functions.ts`: Where all the actual workers live.

## 3. Worker Types

### 3.1 Event-Triggered Workers
Triggered explicitly by our code calling `inngest.send()`.
- **`process-whatsapp-message`**: Triggered by `/api/webhook/twilio`. Handles the entire AI conversation and CRM updating logic in the background.

### 3.2 Scheduled (Cron) Workers
Triggered by Inngest's internal clock based on standard cron syntax.
- **`generate-content-cron`** (`0 9 * * *` - 9 AM daily): Queries businesses, calculates if they need new posts, and dispatches individual generation jobs.
- **`publish-scheduled-posts-cron`** (`*/15 * * * *` - every 15 min): Checks if any `status: "scheduled"` post is past due, and mocks publishing it to Google.

### 3.3 Delayed Drip Campaigns
Inngest supports step-level suspension.
In `sendReviewRequestJob`:
```typescript
await step.run("send-initial-request", async () => { ... });
// The function suspends here for 2 days! Vercel is not billed for this time.
await step.sleep("wait-for-click", "2d");
const clicked = await step.run("check-if-clicked", async () => { ... });
```
This elegant syntax completely replaces the need for complex external workflow tools like n8n or Zapier.

## 4. Retries and Idempotency
By default, `inngest.createFunction` is set with `retries: 3`. If Groq is down or MongoDB times out, the function will throw an error and Inngest will automatically re-run it using exponential backoff.
Because of this, all step functions are designed to be **idempotent** (safe to run multiple times). We check database states (e.g., `if (post.status !== "scheduled") return;`) before executing actions.
