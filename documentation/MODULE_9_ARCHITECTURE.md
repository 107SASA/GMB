# Module 9: Review Acquisition System Architecture

## Core Philosophy
The Review Acquisition System is designed to seamlessly ingest bulk lists of past customers, automatically synchronize them with the CRM module, and put them into intelligent, rate-limited outbound sequences to acquire 5-star Google Reviews.

## Data Models
1. **`Customer`**: A distinct model from `Lead`. While a Lead is someone in the sales pipeline, a Customer is someone who has completed a transaction. Customers have a `reviewStatus` and an `optedOut` flag for compliance.
2. **`ReviewRequest`**: Tracks the individual outbound messages sent to a Customer. It logs clicks, delivery status, and current step in the drip campaign.

## Import Strategy
- We use **PapaParse** on the client-side for rapid, browser-based validation of massive CSV files without overloading the server.
- The `POST /api/campaigns/import` endpoint handles the upsert logic and ensures that imported customers are also represented as "Converted" leads in the CRM Timeline if they don't already exist.

## Automation Engine (Inngest)
Instead of relying on clunky cron jobs that run into timeout limits or memory issues on Vercel, the campaign relies on Inngest's `step.sleep()` and step-level idempotency. The worker safely puts itself to sleep for 2 days or 5 days at a time, resuming exactly where it left off, while continually checking if the user clicked the link or replied "STOP".
