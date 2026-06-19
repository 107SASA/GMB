# Workflow Demos & User Journeys

This document outlines the complete user journeys for the most common automated workflows in the platform.

---

## 1. The "New Lead to CRM" Flow
**Goal:** Capture a lead from WhatsApp, qualify them automatically, and populate the CRM.

1. **The Trigger:** A potential customer sees your GMB profile and sends a WhatsApp message to your Twilio number: *"Do you guys do emergency plumbing? How much?"*
2. **The Catch:** Twilio instantly sends a webhook to our `/api/webhook/twilio` route.
3. **The Queue:** The route instantly responds with a `200 OK` and pushes the data to an Inngest background worker to avoid timeouts.
4. **The AI Brain:** The worker pulls the customer's chat history and passes it to Groq (Llama-3). The AI drafts a friendly reply AND generates hidden JSON metadata.
5. **The Response:** The AI texts the customer back: *"Yes, we offer 24/7 emergency plumbing! We can have someone there in an hour. Are you located in downtown?"*
6. **The CRM Update:** Simultaneously, the JSON metadata updates the CRM:
   - `Lead Status`: Contacted
   - `Urgency`: Urgent
   - `Intent Score`: 85%
7. **The Human Handoff (Optional):** If the user asks a highly specific question the AI can't answer, it flags the CRM status and can alert a human to take over the chat.

---

## 2. The "Review Request SMS" Flow
**Goal:** Ingest past customers and solicit 5-star reviews via automated drip campaigns.

1. **The Upload:** The business owner drags and drops a CSV file into `/dashboard/upload`.
2. **The Ingestion:** The backend parses the CSV, deduplicates returning customers (updating their `totalSpent`), and saves them to the DB.
3. **The Campaign Launch:** The owner clicks "Start Campaign".
4. **The First Touch:** Inngest sends out an initial Twilio SMS: *"Hi John, thanks for visiting! Leave a review here: domain.com/go/123"*
5. **The Smart Link:** If John clicks, the `/go/123` route intercepts the click, marks John as `CLICKED` in the database, and redirects him to Google.
6. **The Follow-Up:** The Inngest worker automatically sleeps for 2 days. When it wakes up, it checks if John's status is `CLICKED`. If not, it sends a gentle reminder text.

---

## 3. The "Infinite Content Calendar" Flow
**Goal:** Never run out of GMB posts.

1. **The Setup:** The user generates an initial GMB audit, saving the business's niche, address, and target keywords into the DB.
2. **The Daily Check:** Every day at 9 AM, the `generateContentCron` Inngest worker runs.
3. **The Buffer Logic:** It checks the `Post` database. "Does this business have at least 7 posts scheduled for the future?"
4. **The Generation Loop:** If only 4 posts exist, the system loops 3 times. For each iteration, it pulls the last 5 posts (for context deduplication) and asks Groq to generate a brand new, SEO-optimized post.
5. **The Scheduling:** The new posts are saved in the DB with dates exactly 1 day apart.
6. **The Publishing:** A separate worker runs every 15 minutes, finds any posts where the `scheduledDate` is in the past, and pushes them live to Google.
