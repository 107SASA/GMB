# Database Flow & State Persistence

This document explains how data moves through the collections during major workflows.

## 1. The CRM Flow (Twilio -> Leads)
1. **Insert/Update**: When a text arrives, the system queries the `Lead` collection by `phone`. If it doesn't exist, it creates it with `status: 'New'`.
2. **Conversation Append**: The raw text is appended to the `Conversation.messages` array.
3. **AI Mutation**: The LLM infers intent from the new message. The backend explicitly overwrites `Lead.intentScore`, `Lead.status`, and `Lead.aiSummary` using `$set` based on the LLM's JSON output.

## 2. The Content Machine Flow
1. **Query**: The `generate-content-cron` queries `Post.find({ status: 'scheduled', scheduledDate: { $gt: now } })`.
2. **Generation**: If count < 7, it generates new posts.
3. **Context Check**: Before generating, it queries the 5 most recent `Post` documents and passes them to the AI to prevent duplicate topics.
4. **Insertion**: New posts are saved with incrementing `scheduledDate`s.
5. **Mutation (Publishing)**: The `publish-scheduled-posts-cron` queries posts where `scheduledDate <= now`. It fires the API, then updates `status` to `'published'`.

## 3. The Review Campaign Flow
1. **Upload**: The CSV parser does an `upsert` on the `Customer` table by phone number. If the customer exists, it increments `totalSpent`.
2. **Campaign Launch**: Creates a `ReviewRequest` for every targeted customer with `status: 'PENDING'`.
3. **Link Tracking**: When the user clicks the SMS link, the `GET /go/[id]` route updates the specific `ReviewRequest.status` to `'CLICKED'`.
4. **Suspension Validation**: When the Inngest worker wakes up from its 2-day sleep, it queries the `ReviewRequest`. If the status is *still* `'SENT'` (meaning they didn't click), it sends the follow-up text.
