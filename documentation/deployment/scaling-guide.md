# Scaling & Concurrency Guide

As the platform grows, processing thousands of WhatsApp messages or generating hundreds of posts concurrently requires tuning.

## 1. MongoDB Connection Pooling
In serverless environments (Vercel), connections spin up and down. `src/lib/mongodb.ts` caches the mongoose instance. However, in production, ensure your MongoDB Atlas tier (M10+) supports a high maximum connection limit.

## 2. Inngest Concurrency
By default, Inngest will scale to process events as fast as possible.
If the Groq API rate-limits you (e.g., 30 requests per minute), you must throttle your Inngest workers.

In `src/services/inngest/functions.ts`:
```typescript
export const processWhatsappMessage = inngest.createFunction(
  { 
    id: "process-whatsapp-message",
    concurrency: {
      limit: 10, // Max 10 executing at once
    }
  },
  ...
);
```

## 3. MongoDB Indexing
To keep queries fast, ensure the following indexes exist in MongoDB:
- `Lead`: `phone` (Unique), `status` (for the Kanban board).
- `Post`: `scheduledDate`, `status` (for the cron jobs).
- `ReviewRequest`: `customerId`, `status` (for drip campaigns).

## 4. Twilio Throughput
Twilio WhatsApp has a default limit of messages per second. If your Review Request drip campaign (which can loop over 10,000 customers) attempts to send all texts in the exact same millisecond, Twilio will throw `Error 20429 (Too Many Requests)`.
**Solution:** Use Inngest step batching or introduce artificial step delays (`step.sleep("100ms")`) inside massive `for` loops in background workers.
