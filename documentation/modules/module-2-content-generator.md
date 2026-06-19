# Module 2: AI Content Generator

## 1. Module Overview
The AI Content Generator automates the creation of high-quality, local-SEO-optimized posts for Google Business Profiles. Users provide basic details like their business name, location, target keywords, and preferred tone. The AI then drafts ready-to-publish posts, SEO descriptions, or FAQs that are stored in the database for scheduling.

## 2. Architecture
- **Frontend Structure**: 
  - `src/app/dashboard/content/page.tsx`: The primary interface where users fill out the generation parameters (tone, type, keywords) and view the generated JSON response containing the title, content, and hashtags.
- **Backend Structure**: 
  - `src/app/api/content/route.ts`: Exposes the `POST` endpoint to trigger generation.
- **Service Layer**: 
  - `src/services/content-ai.ts`: The core logic that builds the prompt, sanitizes input, calls Groq, and strictly parses the returned JSON string into the `AIContentResponse` interface.
- **Database**: 
  - Relies on the `Post` model (via the scheduler) to save the generated outputs if they are approved by the user.

## 3. APIs Used
- **Internal APIs**: 
  - `POST /api/content`: Payload `{ business_name, business_type, location, keywords, tone, content_type }`. Returns a structured JSON object with `title`, `content`, `hashtags`, `cta`, and `seo_score`.
- **External APIs**: 
  - **Groq API**: Specifically running `llama-3.3-70b-versatile` for fast, JSON-enforced inference.

## 4. MongoDB/Mongoose Structure
- **Collections**:
  - `posts`: Generated content is saved here with fields like `title`, `content`, `status` (draft/scheduled), `platform` (gmb), `aiGenerated` (boolean), `businessId`, and `userId`.

## 5. AI Integrations
- **Prompts**: `content-ai.ts` uses dynamic prompt building based on `CONTENT_TYPE_LABELS` (e.g., promotional, educational, faq) and `TONE_LABELS`. 
- **Generation Logic**: The prompt uses a strict instruction: "You MUST respond with ONLY a valid JSON object. No markdown, no code fences". It includes a secondary sanitization phase `sanitizeInput()` that strips out prompt injection attempts like "ignore previous instructions".

## 6. Automation & n8n Workflows
- **Triggers**: Works closely with Module 3 (Scheduler). If the scheduler detects a business has fewer than 7 upcoming posts, it automatically calls `generatePost` (which wraps `content-ai.ts`) to auto-fill the calendar.

## 7. UI/UX Components
- **Pages**: `/dashboard/content`
- **Design System**: A two-column layout. The left column contains the input form (Select menus for Tone/Type, TextAreas for keywords). The right column is an interactive preview card displaying the generated copy, complete with hashtag pills and an SEO score ring.

## 8. Environment Variables Needed
```env
GROQ_API_KEY=gsk_...
```

## 9. Execution/Setup Guide
1. Ensure `GROQ_API_KEY` is configured.
2. Run `npm run dev`.
3. Navigate to `/dashboard/content`.
4. Fill in the parameters and click "Generate Local SEO Content".

## 10. Module Dependencies
- **Depends on**: Groq SDK for generation.
- **Depended upon by**: Scheduler & Auto-Posting (Module 3) heavily relies on this to automatically draft calendar updates.

## 11. Known Issues / Technical Debt
- **Image Generation Missing**: The current post generator outputs text and hashtags, but Google Business Profile posts often require an image. Image generation (e.g., using OpenAI DALL-E or similar) is not yet implemented.

## 12. Future Scaling Suggestions
- **Asset Integration**: Integrate an image generation or stock photo API to attach relevant visual media to the generated posts.
