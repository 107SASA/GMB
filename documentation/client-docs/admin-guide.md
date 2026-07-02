# Admin Guide

This guide explains how to operate the administrative dashboard of the platform.

## 1. Accessing the Dashboard
Navigate to `http://localhost:3000/dashboard`.
The platform features a global sidebar on the left for navigation. All views are designed in a premium, dark-mode glassmorphism UI.

## 2. Managing Leads (CRM)
**Path:** `/dashboard/crm`
- **Overview:** This is a drag-and-drop Kanban board mapping your entire sales pipeline.
- **Lanes:** Leads move from left to right (`New` -> `Contacted` -> `Qualified` -> `Interested` -> `Booking Pending` -> `Converted`).
- **Cards:** Each card displays the lead's name, phone, AI-generated summary of their chat, and their intent score (0-100%).
- **Action:** You can physically drag a card from one lane to another. The database updates instantly.

## 3. Monitoring Reviews
**Path:** `/dashboard/reviews`
- **Overview:** A central inbox for all your Google reviews.
- **Sentiment Badges:** Reviews are auto-tagged as Positive (Green), Neutral (Gray), Negative (Yellow), or Critical (Red).
- **AI Replies:** The AI automatically drafts a response to every review. You will see it labeled as "PENDING".
- **Action:** You can click the text box to edit the AI's draft, then click "Approve". Once approved, the system will eventually push it to Google (simulated in local dev).

## 4. Scheduling Posts
**Path:** `/dashboard/posts`
- **Overview:** Your content calendar.
- **Auto-pilot:** You do not *need* to manually create posts. If your calendar drops below 7 days, the AI will auto-fill it overnight.
- **Manual Generation:** If you want a specific post (e.g., a Thanksgiving sale), go to `/dashboard/content`, select "Promotional" and "Enthusiastic", and click generate. It will be added to your pipeline.

## 5. Uploading Customers for Review Campaigns
**Path:** `/dashboard/upload`
- **Overview:** Ingest historical customer data.
- **Format:** Ensure your CSV has headers like `name`, `phone`, `email`, `lastVisit`, `totalSpent`.
- **Action:** Drag and drop the CSV into the upload zone. The system will process them, deduplicate any phone numbers already in the system (while summing their `totalSpent`), and prepare them for Review SMS campaigns.
