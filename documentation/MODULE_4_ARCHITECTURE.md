# Module 4: AI Reputation Agent - Architecture

## Overview
The AI Reputation Agent transforms raw provider reviews into an intelligent, actionable command center. It uses an abstraction layer for fetching reviews and an AI processing pipeline to analyze sentiment and generate context-aware replies.

## Provider Abstraction (`src/services/reviews/providers`)
To avoid tight coupling with any specific API (e.g. Google Business API, SerpAPI), fetching and posting reviews are handled via a provider interface. 
- Currently implemented: `MockGoogleProvider.ts` which simulates network latency and random provider errors for testing the robustness of the system.
- To switch to production, you just swap the implementation of `fetchReviews` and `postReply` to call the real API.

## Database Schema
- **Review**: Stores the raw review text, sentiment, generated `aiSuggestedReply`, and multi-tenant keys (`tenantId`, `businessId`). Uses `providerReviewId` as a unique identifier to prevent duplicate ingestion.
- **ReviewAnalytics**: Aggregates ratings, response rates, and sentiment scores per business to power the premium dashboard metric cards.

## Background Processing (Inngest)
- **`reviewSyncWorker`**: Nightly cron job that iterates through all active businesses and dispatches `processReviewSyncJob` to pull the latest reviews.
- **`criticalAlertWorker`**: Event-driven worker triggered during the sync process. If a 1-star or "critical" review is found, it immediately dispatches a Twilio WhatsApp alert to the business owner so they can take action on the dashboard.
