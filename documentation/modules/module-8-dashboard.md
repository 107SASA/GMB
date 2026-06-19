# Module 8: Admin Dashboard

## 1. Module Overview
The Admin Dashboard is the centralized presentation layer for the entire platform. It unifies GMB Auditing, Content Generation, Post Scheduling, Review Tracking, and Customer Uploads into a single, cohesive interface. It strictly adheres to a premium, dark-mode, glassmorphism design language.

## 2. Architecture
- **Frontend Structure**: 
  - `src/app/dashboard/layout.tsx`: The primary wrapper containing the global navigation sidebar and top bar.
  - Sub-routes for each feature: `/audit`, `/content`, `/history`, `/posts`, `/reviews`, `/upload`, `/campaigns`, `/crm`.
- **Backend Structure**: 
  - Relies on the individual Next.js API routes defined for each module.
- **Service Layer**: N/A natively, acts as a consumer of internal APIs.
- **Database**: N/A natively.

## 3. APIs Used
- **Internal APIs**: 
  - Consumers of `/api/audit`, `/api/content`, `/api/reviews`, `/api/posts`, `/api/upload` (for CSV processing).
- **External APIs**: 
  - Client-side interactions are abstracted behind internal APIs to protect secrets, though `framer-motion` and `lucide-react` are heavily used for UI interactions.

## 4. MongoDB/Mongoose Structure
- N/A natively.

## 5. AI Integrations
- The dashboard itself does not make direct LLM calls. It provides the UI interfaces (inputs, dropdowns, buttons) that trigger the backend AI services.

## 6. Automation & n8n Workflows
- Features manual trigger buttons (e.g., "Poll New Reviews", "Run Live AI Audit", "Generate Local SEO Content") that bypass scheduled n8n workflows for immediate execution.

## 7. UI/UX Components
- **Global Layout**: A persistent left-hand sidebar containing navigation links with Lucide icons.
- **Design System**: 
  - Consistently utilizes `glass-dark`, `border-white/10`, and `bg-white/5` Tailwind utility combinations for the premium dark mode look.
  - Highly reliant on conditional styling and `framer-motion` for micro-animations (hover scales, opacity transitions).
  - Toast notifications provided by `react-hot-toast` across all modules.

## 8. Environment Variables Needed
None specifically for the UI dashboard rendering (Next.js public variables, if any, would be `NEXT_PUBLIC_*`).

## 9. Execution/Setup Guide
1. Ensure the backend services are configured.
2. Run `npm run dev`.
3. Navigate to `http://localhost:3000/dashboard` to access the main hub.

## 10. Module Dependencies
- **Depends on**: Every backend module in the system.
- **Depended upon by**: End users.

## 11. Known Issues / Technical Debt
- **Authentication Bypass**: The dashboard is currently lacking a strict NextAuth or JWT middleware wrapper. Any user navigating to `/dashboard` has access.

## 12. Future Scaling Suggestions
- **NextAuth Integration**: Implement `next-auth` middleware to protect the `/dashboard` routes and redirect unauthenticated users to `/login`.
