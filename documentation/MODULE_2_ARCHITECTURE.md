# Module 2: AI Content Studio - Architecture

## Overview
The AI Content Studio provides a complete, multi-tenant workspace for generating, reviewing, and scheduling Google Business Profile content. It uses the Groq AI API (LLaMA 3.3) for rapid, structured JSON generation of posts, SEO descriptions, and FAQs.

## Component Architecture
- **ContentGeneratorForm**: A dynamic form capturing the business context, tone, and targeted keywords. It invokes the synchronous `/api/content/generate` endpoint.
- **ContentWorkspace**: A 3-tab layout component that receives the JSON payload from the API and distributes the state to the respective tabs.
- **WeeklyPostsTab & PostCard**: Renders a grid of generated posts. Allows for inline editing (React local state) before posting the payload to `/api/content/schedule` to persist the data to MongoDB.
- **SEOTab & FAQTab**: Present structured outputs with "Copy" functionalities and visual metrics (SEO score).

## Database Schema
The system leverages three primary Mongoose models to support multi-tenant isolation:

1. **Post Model (`src/models/Post.ts`)**
   - Extended from the base architecture to include `tenantId`, `organizationId`, and `aiMetadata`.
   - The status defaults to `draft` upon creation via the UI.

2. **FAQ Model (`src/models/FAQ.ts`)**
   - Tracks `tenantId`, `businessId`, `question`, and `answer`.

3. **SEOContent Model (`src/models/SEOContent.ts`)**
   - Tracks `tenantId`, `businessId`, `description`, and `seoScore`.

## AI Pipeline
The `contentEngine.ts` uses the `groq-sdk` with `llama-3.3-70b-versatile` utilizing the strict `json_object` response format. It accepts parameters injected dynamically into the prompt to guarantee 7 GMB posts, 5 FAQs, and a 750-char SEO description.

## Scheduling Integration
When the user clicks "Schedule", the system saves a record to the MongoDB `Post` collection. The existing Inngest CRON job architecture (`publishScheduledPostsCron`) can subsequently query `Post.find({ status: 'scheduled' })` to deploy them.
