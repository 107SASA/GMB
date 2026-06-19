# Multi-Business Architecture

## The Problem
Agencies need to manage multiple local businesses from a single account without logging in and out. Data from Business A must NEVER bleed into Business B.

## The Solution: Global Context Injection
1. The `User` logs in and selects an `activeBusinessId` from the Sidebar dropdown.
2. The UI calls `useSession().update({ activeBusinessId: newId })`.
3. NextAuth updates the JWT cookie with the new ID.
4. From then on, every Server Action, API Route, and Component calls `getServerSession()`.
5. The resulting `businessId` is injected into every single MongoDB query (`Lead.find({ businessId })`, `Review.aggregate([{ $match: { businessId } }])`).

## Schema Enforcements
To guarantee multi-tenant safety at the DB layer, every operational schema MUST contain:
```typescript
organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true }
businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true }
```
A compound index should be placed on `businessId` for query optimization.

## Background Worker Context
When triggering Inngest jobs, the UI must pass the `businessId` in the event payload. The worker will use this payload to fetch the specific AI configurations and Twilio credentials required for that tenant.
