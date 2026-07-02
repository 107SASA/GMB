# Module 4: Automation Flow

## Review Sync Pipeline
1. At 2:00 AM, `reviewSyncWorker` triggers.
2. Identifies active businesses and dispatches `processReviewSyncJob`.
3. Job hits `POST /api/reviews/fetch`.
4. Provider Abstraction returns latest reviews.
5. `sentimentEngine.ts` processes each review. If "terrible", labels it `critical`.
6. Reviews are upserted to MongoDB to prevent duplicates.
7. Analytics are recalculated and saved.

## Alerting Pipeline
1. During the sync pipeline, if `critical` is detected, `fetch` API fires `reviews/critical-alert` event to Inngest.
2. `criticalAlertWorker` catches the event.
3. Queries the `Business` model for a phone number.
4. Sends Twilio WhatsApp message: *"Reputation Alert: Business received a critical review..."*

## AI Reply Generation
1. Admin clicks "Generate AI Reply" on the dashboard.
2. Payload hits `POST /api/reviews/generate-reply`.
3. `replyEngine.ts` injects review context and selected tone into the Groq prompt.
4. Groq returns human-sounding text.
5. Saved to DB as `aiSuggestedReply` and displayed in the workspace for editing.
