# Module 1: AI Google Ranking Agent - Architecture Document

## Overview
Module 1 implements a production-grade, multi-tenant AI Google Ranking Agent (Audit Engine). It replaces the previous MVP with scalable services, background processing, and a premium SaaS UI.

## Tech Stack
- **Frontend**: Next.js 15 (App Router), React 19, Tailwind CSS v4, Framer Motion
- **Backend**: Next.js API Routes, Inngest Background Jobs
- **Database**: MongoDB Atlas via Mongoose
- **AI Integration**: OpenAI GPT-4 (`openai` SDK)

## Component Architecture
1. **AuditForm**: Handles user input and triggers `/api/audit`.
2. **AuditResultsDashboard**: Polls `/api/audit/[id]` for the audit status. Displays `PENDING` state with a skeleton loader.
3. **ScoreRing**: Animated SVG ring for the overall score using Framer Motion.
4. **MetricCardsGrid**: Modular cards for detailed scores.
5. **CompetitorTable**: Tabular breakdown of local competitors.
6. **RecommendationsList**: Expandable list of actionable insights.

## Services Architecture
- `src/services/gmb/provider.ts`: Abstracted GMB fetching. Currently uses a `MockGMBProvider` which simulates network latency and returns realistic local business data.
- `src/services/ai/auditEngine.ts`: Takes structured GMB data and sends it to OpenAI with `response_format: { type: 'json_object' }` to ensure strict parsing of the insights.
- `src/services/audit/auditService.ts`: Orchestrates fetching, AI generation, and DB updates.
- `src/inngest/functions/generateAudit.ts`: Consumes the Inngest event `audit/generate.requested` and executes the orchestrator.

## Database Schema
The `Audit` Mongoose model implements strict multi-tenancy:
- `tenantId` (indexed)
- `userId`
- `organizationId`
- `businessName`, `location`, `gbpUrl`
- `status`: PENDING, COMPLETED, FAILED
- `overallScore`, `auditData`, `recommendations`, `competitors`

## Setup Instructions
1. Copy `.env.example` to `.env.local` and add `OPENAI_API_KEY`, `MONGODB_URI`, `INNGEST_EVENT_KEY`.
2. Run `npm run dev`.
3. In a separate terminal, start the Inngest dev server: `npx inngest-cli@latest dev`.
4. Navigate to `/dashboard/audit` to run a new audit.

## Next Steps for Production
- Swap `MockGMBProvider` with real SerpAPI/Google Places integration.
- Implement proper Authentication hooks to inject real `tenantId` into `/api/audit`.
- Enhance the PDF Export functionality with a library like `jspdf` if native browser printing is insufficient.
