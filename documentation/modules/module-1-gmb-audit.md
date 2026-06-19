# Module 1: GMB Audit Engine

## 1. Module Overview
The GMB Audit Engine is the core discovery and analysis tool of the platform. It takes a business name or Google My Business URL, fetches real-time data from Google Maps, and uses an AI model to evaluate the profile's SEO completeness, engagement, and review sentiment. It outputs actionable recommendations and a comprehensive growth score.

## 2. Architecture
- **Frontend Structure**: 
  - `src/app/dashboard/audit/page.tsx`: The main user interface with an animated input form, live loading indicators, and results display.
  - `src/components/sections/ResultsView.tsx`: Renders the detailed breakdown of the audit scores.
- **Backend Structure**: 
  - `src/app/api/audit/route.ts`: Exposes `POST` (create audit) and `GET` (fetch past audits).
- **Service Layer**: 
  - `src/services/audit-engine.ts`: Orchestrates the fetching, AI scoring, and MongoDB insertions.
  - `src/services/google-maps.ts`: Fetches live Google Maps data using SerpApi.
  - `src/services/ai-analysis.ts`: Feeds the data to Groq (`llama-3.3-70b-versatile`) to extract keywords, summaries, and prioritized actions.
- **Database**: 
  - Uses Mongoose to store the scraped `Business`, the detailed `Audit` report, and imported `Review` records.

## 3. APIs Used
- **Internal APIs**: 
  - `POST /api/audit`: Payload `{ query: string }`. Returns the populated `Audit`, `Business`, and `Reviews`.
  - `GET /api/audit?businessId=...`: Returns historical audits.
- **External APIs**: 
  - **SerpApi**: Used to query Google Maps local results.
  - **Groq API**: Used for NLP analysis of the business data.

## 4. MongoDB/Mongoose Structure
- **Collections**:
  - `businesses`: Stores `placeId`, `name`, `category`, `address`, `rating`, `reviewCount`, and extracted `keywords`.
  - `audits`: Stores `overallScore`, `seoScore`, `reviewScore`, `engagementScore`, `completenessScore`, `aiSummary`, and `recommendations` array. Linked via `businessId`.
  - `reviews`: Imported during the audit with `reviewer`, `rating`, `reviewText`, and `sentiment`.

## 5. AI Integrations
- **Prompts**: The AI is prompted to act as an "expert local SEO consultant" analyzing the JSON dump from SerpApi. It is specifically asked to format its output as JSON with `summary`, `keywords` (array), and `prioritizedActions` (array of action items).
- **Model**: `llama-3.3-70b-versatile` running via Groq SDK.

## 6. Automation & n8n Workflows
- **Triggers**: Currently, this module is manually triggered from the UI. It is not currently tied into automated n8n polling (which is a potential future feature for weekly automated audits).

## 7. UI/UX Components
- **Pages**: `/dashboard/audit`
- **Design System**: Dark glassmorphism, Framer Motion animations (`AnimatePresence`), and Lucide icons.
- **Interactions**: Animated loading steps ("Connecting to SerpApi", "Processing SEO Gaps", etc.).

## 8. Environment Variables Needed
```env
MONGODB_URI=mongodb+srv://...
GROQ_API_KEY=gsk_...
SERPAPI_KEY=...
```

## 9. Execution/Setup Guide
1. Ensure `SERPAPI_KEY` and `GROQ_API_KEY` are valid.
2. Run `npm run dev`.
3. Navigate to `/dashboard/audit`.
4. Enter a business name (e.g., "Starbucks Seattle") and click "Run Live AI Audit".

## 10. Module Dependencies
- **Depends on**: Mongoose/MongoDB connection, Groq service, SerpApi integration.
- **Depended upon by**: Nothing currently, though other modules (Scheduler, Content Generator) can utilize the `keywords` extracted and stored in the `Business` model during this audit.

## 11. Known Issues / Technical Debt
- **Local Storage Cache**: The frontend currently saves a copy of the audit to `localStorage("gmb_audits")` as a fallback, which can desync from MongoDB.
- **Pagination**: The Google Maps API call only fetches the first page of reviews; large businesses will need pagination logic via SerpApi `next_page_token`.

## 12. Future Scaling Suggestions
- **Automated Weekly Audits**: Set up a CRON job or Inngest workflow to run this audit weekly for premium CRM clients to track progress over time.
