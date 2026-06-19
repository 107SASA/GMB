# Troubleshooting Guide

## 1. Twilio Errors

### Error 11200: HTTP Retrieval Failure
**Symptom:** Twilio says "Webhook failed with 11200" or users get a default "Sorry, service unavailable" message.
**Cause:** Twilio requires a webhook response within 15 seconds. If Next.js takes 16 seconds to respond, Twilio throws this error.
**Fix:** Ensure your `/api/webhook/twilio` route instantly returns `200 OK` (with empty TwiML) *before* doing any AI inference. The heavy lifting must be passed to Inngest via `inngest.send()`.

### Error 20429: Too Many Requests
**Symptom:** Your Review Campaign SMS aren't sending.
**Fix:** You are hitting Twilio's rate limit. Add concurrency limits or `step.sleep("50ms")` in your Inngest looping workers.

## 2. Inngest Worker Failures

**Symptom:** Jobs are stuck in `Failed` or `Retrying` in the Inngest Dashboard.
**Debugging Steps:**
1. Check the Inngest Cloud Logs (or `localhost:8288` if in dev).
2. **"Failed to fetch from Groq"**: This usually means you hit Groq's Tokens-Per-Minute limit. Inngest's automatic exponential backoff will usually solve this natively by waiting a few minutes and trying again.
3. **"MongooseServerSelectionError"**: The worker failed to connect to MongoDB. Ensure your Atlas cluster allows connections from `0.0.0.0/0` and that Vercel has the correct `MONGODB_URI`.

## 3. LLM Parsing Failures

**Symptom:** CRM metadata isn't updating correctly (intent score is stuck at 0).
**Cause:** The LLM hallucinated markdown backticks around its JSON output, breaking `JSON.parse()`.
**Fix:** Ensure `response_format: { type: 'json_object' }` is rigidly set in the Groq completion configuration in `src/services/ai.ts`.

## 4. UI Doesn't Update After Dragging Lead
**Symptom:** You drag a Kanban card, it snaps back, and you get a red toast error.
**Cause:** The optimistic UI update reverted because the backend PUT request to `/api/leads/[id]` failed.
**Fix:** Check your Next.js server console. Usually, this means the `businessId` context is missing, or the backend threw a 500 because `mongoose.connect()` failed.
