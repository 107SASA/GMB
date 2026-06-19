# Backend Architecture

The backend is built entirely within the Next.js App Router (`src/app/api`) using serverless functions, backed by a robust Mongoose service layer (`src/services`).

## 1. Directory Structure
- `src/app/api/`: The entry points (Controllers).
- `src/services/`: Business logic, 3rd-party API integrations, and AI prompts.
- `src/models/`: Mongoose schemas.
- `src/lib/`: Database connection logic.

## 2. API Design Principles
- **RESTful Endpoints**: The dashboard communicates with the backend via standard HTTP methods (GET, POST, PUT, DELETE).
- **Stateless Authentication**: (Note: NextAuth integration is planned, but current architecture assumes context is managed via client-side `BusinessProvider`).
- **Heavy Lifting Delegation**: Any API route that takes longer than 2 seconds to resolve (e.g., generating AI content, processing a CSV, responding to Twilio) immediately offloads the work to Inngest.

## 3. The Service Layer
The core logic resides in `src/services` to keep the API routes clean.

### 3.1 `ai.ts` & `content-ai.ts`
Wrappers around the Groq SDK. They handle:
- Prompt construction.
- Strict JSON instruction formatting.
- Parsing and sanitization (stripping out markdown backticks).

### 3.2 `audit-engine.ts`
Orchestrates the GMB audit. It chains three distinct actions:
1. Calls `google-maps.ts` (SerpApi) to get live data.
2. Passes that data to `ai-analysis.ts` to get an SEO gap summary.
3. Computes heuristic scores (`calculateSEOScore`, `calculateEngagementScore`) and saves the massive payload to MongoDB.

### 3.3 `reviews.ts`
Handles the logic for importing reviews and generating simulated or actual API calls to publish AI-drafted replies.

## 4. Database Connection Strategy
Because Next.js serverless functions spin up and down rapidly, we use a cached MongoDB connection in `src/lib/mongodb.ts`.
```typescript
let cached = (global as any).mongoose;
if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}
```
Every API route and Inngest function *must* call `await dbConnect();` at the beginning of its execution to ensure the connection pool is active.
