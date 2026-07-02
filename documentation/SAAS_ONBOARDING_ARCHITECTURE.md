# SaaS Onboarding Architecture

## Overview
GMBBoost has transitioned from a single-tenant developer architecture to a fully multi-tenant SaaS application. When a user registers, the system dynamically provisions an isolated workspace hierarchy.

## The Registration Pipeline (`/register`)
1. **User Creation**: The user account is created with `role: Owner`.
2. **Organization Creation**: A parent organization is created mapping to the user's `companyName`.
3. **Business Creation**: The first location/business is created inside the organization. Default AI Settings (`professional` tone) are assigned.
4. **Context Linking**: The user's `activeBusinessId` and `organizationId` are stored in the User document.

## The Onboarding Wizard (`/onboarding`)
Users are locked into the `/onboarding` route by the Next.js Edge Middleware (`src/proxy.ts`) until they complete the 5-step wizard.
1. **Details**: Description and SEO Keywords.
2. **Google**: Google Place ID and GBP URL.
3. **WhatsApp**: Twilio SID, Auth Token, and Sender Number.
4. **AI**: Tone of voice and custom sales prompts.
5. **Completion**: API flips `onboardingCompleted` to true on the User and Business models, unlocking the dashboard.
