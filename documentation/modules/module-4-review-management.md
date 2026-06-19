# Module 4: Review Management Agent

## 1. Module Overview
The Review Management Agent acts as an intelligent hub for tracking, analyzing, and responding to Google Business Profile reviews. It aggregates reviews into a central dashboard, uses AI to tag them with sentiment scores (`positive`, `neutral`, `negative`, `critical`), and automatically drafts empathetic, context-aware replies tailored to the rating and tone settings.

## 2. Architecture
- **Frontend Structure**: 
  - `src/app/dashboard/reviews/page.jsx`: A unified "glass-dark" UI that lists all synced reviews. Includes inline textareas for administrators to manually edit the AI-generated replies and explicit "Approve" and "Post" buttons to maintain brand safety.
- **Backend Structure**: 
  - `src/app/api/reviews/route.ts`: Exposes a `GET` endpoint for fetching reviews with optional `businessId`, `replyStatus`, and `sentiment` filters.
  - `src/app/api/reviews/[id]/approve-reply/route.ts`: Endpoint to flag a draft reply as `APPROVED` and save manual edits.
  - `src/app/api/reviews/[id]/post-reply/route.ts`: Endpoint designed to push the `APPROVED` reply to the Google Business Profile API.
  - `src/app/api/reviews/monitor/route.ts`: A trigger endpoint for automated polling.
- **Service Layer**: 
  - `src/services/reviews.ts`: Contains the `fetchGoogleReviews` (currently mocked) and `processNewReviews` functions.
  - `src/services/ai.ts`: Contains `generateAIReply` and `analyzeSentiment`.
- **Database**: 
  - Stores all logic natively using Mongoose (`Review`, `ReviewReply`, `ReviewMonitorLog`).

## 3. APIs Used
- **Internal APIs**: 
  - `/api/reviews` (GET)
  - `/api/reviews/monitor` (POST)
  - `/api/reviews/[id]/approve-reply` (POST)
  - `/api/reviews/[id]/post-reply` (POST)
- **External APIs**: 
  - **Groq API**: For sentiment analysis and dynamic response generation.
  - **Google My Business API**: *(Integration Pending/Mocked)* The mechanism to pull reviews and push responses.

## 4. MongoDB/Mongoose Structure
- **Collections**:
  - `reviews`: Stores `reviewer`, `rating`, `reviewText`, `sentiment`, `aiSuggestedReply`, and `replyStatus` (`PENDING`, `APPROVED`, `POSTED`).
  - `reviewreplies`: Acts as a ledger of all historically posted AI replies (`generatedReply`, `tone`, `aiGenerated`).
  - `reviewmonitorlogs`: Logs each polling cycle (`reviewsFetched`, `newReviewsDetected`, `aiRepliesGenerated`).

## 5. AI Integrations
- **Prompts**: `generateAIReply` provides explicit guidelines: "Keep the reply under 80 words... If rating is low (1-3), apologize... Tone specific instructions (Professional vs Friendly)."
- **Sentiment Analysis**: `analyzeSentiment` forces the LLM to categorize the review strictly into `positive`, `neutral`, `negative`, or `critical` by restricting max tokens and lowering the temperature to 0.1 for deterministic output.

## 6. Automation & n8n Workflows
- **Triggers**: The "Poll New Reviews" button on the UI directly hits the `/api/reviews/monitor` route. This route is fully decoupled and can be easily hit by n8n or a cron job hourly to maintain a real-time sync.

## 7. UI/UX Components
- **Pages**: `/dashboard/reviews`
- **Design System**: Displays analytical KPI cards (Total Reviews, Pending AI Replies, Average Google Rating) and uses conditionally colored badges based on sentiment (e.g., green for positive, red for critical).

## 8. Environment Variables Needed
```env
GROQ_API_KEY=gsk_...
GOOGLE_REVIEW_API_KEYS=your_google_review_api_key
```

## 9. Execution/Setup Guide
1. Run `npm run dev`.
2. Navigate to `/dashboard/reviews`.
3. Click "Poll New Reviews" to trigger the mock fetch and initiate the AI drafting process.
4. Click "Edit" or "Approve" on a pending reply.

## 10. Module Dependencies
- **Depends on**: Groq SDK.
- **Depended upon by**: Admin Dashboard.

## 11. Known Issues / Technical Debt
- **Mocked GMB Integration**: `fetchGoogleReviews` in `src/services/reviews.ts` is currently returning static mock data. The true Google Business Profile OAuth scope is pending integration.

## 12. Future Scaling Suggestions
- **Review Alerts**: Connect the `ReviewMonitorLog` to an email or Slack integration to complement the existing Twilio SMS alerts.
