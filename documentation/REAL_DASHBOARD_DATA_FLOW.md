# Real Dashboard Data Flow

## Overview
The dashboard is now fully decoupled from static mock environments. It strictly consumes live MongoDB data specific to the authenticated business session.

## The Flow
1. **Cookie Injection (Onboarding):** Upon successful onboarding, the `activeBusinessId` HTTP-Only cookie is provisioned to the browser.
2. **Context Hydration:** The global React Context (`BusinessContext`) calls `GET /api/business/active` and caches the live `Business` document into state.
3. **Dashboard Route Protection:** The `CommandCenter` (`src/app/dashboard/page.tsx`) wraps itself in a loading state until the `activeBusiness` context resolves.
4. **Data Aggregation:** A frontend fetch requests `/api/dashboard/stats`. Crucially, no `businessId` query parameters are passed; the backend extracts the cookie directly, ensuring strict multitenant data isolation.
5. **Component Render:** The backend aggregates metrics across `Lead`, `Review`, `Post`, and `Activity` collections, returning a standardized payload which the dashboard components (Headers, Charts, Grids) blindly render. Empty arrays are handled gracefully via inline stylized empty states.
