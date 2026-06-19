# Module 3: Scheduler & Auto-Posting

## 1. Module Overview
The Scheduler & Auto-Posting module ensures that a business always has an active, forward-looking content pipeline. It provides a visual content calendar for users to view, edit, and approve posts. Behind the scenes, it features a "7-Day Buffer Logic" that continuously checks the calendar and automatically drafts new AI posts if the queue drops below 7 scheduled days.

## 2. Architecture
- **Frontend Structure**: 
  - `src/app/dashboard/posts/page.tsx`: The Content Calendar view showing a kanban/list style layout of upcoming posts.
  - `src/app/dashboard/posts/pending/page.tsx` & `scheduled/page.tsx`: Specific filtering views.
  - `src/app/dashboard/posts/create/page.tsx`: Manual post creation interface.
- **Backend Structure**: 
  - `src/app/api/cron/auto-generate/route.ts`: A webhook endpoint designed to be hit by a daily CRON job (like Vercel Cron or n8n).
- **Service Layer**: 
  - `src/services/automation.ts`: Contains `checkScheduledPosts()`, which iterates over all businesses, checks their future post count, and recursively calls the AI Generator if they have less than 7 upcoming posts.
- **Database**: 
  - Relies on the `Post` model to manage states (`draft`, `scheduled`, `published`) and `AutomationLog` to keep a system audit trail.

## 3. APIs Used
- **Internal APIs**: 
  - `POST /api/cron/auto-generate`: Triggers the `checkScheduledPosts` automation loop. Protected by standard authorization headers (though currently relies on external webhooks).
  - CRUD endpoints in `src/app/api/posts/*` for frontend manipulation.
- **External APIs**: 
  - Indirectly uses **Groq API** when it delegates post drafting to `src/services/ai.ts`.

## 4. MongoDB/Mongoose Structure
- **Collections**:
  - `posts`: Includes `scheduledDate`, `status`, `content`, `aiGenerated`, and `businessId`.
  - `automationlogs`: Logs `SCHEDULER_START`, `POST_CREATED`, and `SCHEDULER_FATAL` events with timestamps.

## 5. AI Integrations
- **Generation Logic**: When the scheduler detects a gap (e.g., only 4 posts scheduled), it calls `generatePost(business)` inside a loop to dynamically create 3 new posts set exactly 1 day apart from the `lastScheduledDate`.

## 6. Automation & n8n Workflows
- **Triggers**: The `/api/cron/auto-generate` route is the primary entry point for orchestrating this workflow. It is designed to be hit daily at midnight UTC by an external orchestrator like n8n or a Vercel Cron job.

## 7. UI/UX Components
- **Pages**: `/dashboard/posts/*`
- **Design System**: Includes drag-and-drop support (via `@dnd-kit` installed in `package.json`) and clear visual tags indicating if a post is a Draft, Scheduled, or Published.

## 8. Environment Variables Needed
```env
CRON_SECRET=your_cron_secret_here
```

## 9. Execution/Setup Guide
1. Create a Vercel Cron configuration or an n8n HTTP Request node pointing to `http://<your-domain>/api/cron/auto-generate`.
2. Add the `Authorization: Bearer <CRON_SECRET>` header.
3. The scheduler will automatically fill databases overnight.

## 10. Module Dependencies
- **Depends on**: AI Content Generator (Module 2) for drafting the actual text.
- **Depended upon by**: Admin Dashboard relies on `posts` being populated.

## 11. Known Issues / Technical Debt
- **Asset Generation**: Image generation for posts is not yet natively supported; currently restricted to text posts.

## 12. Future Scaling Suggestions
- **Vector Context Memory**: Feed the last 5 generated posts into the AI's system prompt using RAG (Vector DB) instead of standard array slices for a more robust similarity check.
- **Native Task Queues**: The backend uses Inngest for job processing, which successfully manages exact post scheduling and automated publishing.
