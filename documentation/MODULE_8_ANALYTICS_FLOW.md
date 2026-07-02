# Module 8: Analytics Flow

## 1. Client Initialization
- The user navigates to `/dashboard`.
- React state initializes `loading: true`.
- The `useEffect` hook fires `fetchStats()`.

## 2. Server Aggregation
- Next.js API receives the request.
- Resolves `businessId` and sets up date boundaries (e.g., 30 days ago).
- Fires 5 parallel Mongoose queries:
  - `leadsPromise`: Uses `$facet` to get total count, group by source, and group by date.
  - `reviewsPromise`: Uses `$facet` to get avg rating, unread count, and star distribution.
  - `postsPromise`: Uses `$facet` to get published count, upcoming 7 days calendar, and calculates the `bufferDays` metric.
  - `followUpsPromise`: Standard `.find()` query for hot leads.
  - `activityPromise`: Standard `.find()` query for the AI Activity Feed.
- Data is normalized into the `payload` JSON structure and returned.

## 3. UI Hydration & Polling
- Client receives the JSON and updates state (`setData`).
- `loading` is set to false.
- React renders the Header, Metrics, Charts, and Panels.
- A `setInterval` is established to silently poll the endpoint every 5 minutes. The UI will not show a loading spinner during background polls, ensuring a smooth experience.
