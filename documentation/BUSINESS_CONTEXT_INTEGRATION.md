# Business Context Integration

## Architecture
The platform utilizes a `useBusiness()` React Context hook mapped directly to the MongoDB `Business` collection.

## Personalization Implementation
By pulling `activeBusiness` down from the global provider, the Dashboard can personalize the UI without relying on heavy prop-drilling or separate API calls.

For example, the Dashboard Header dynamically parses the `name` field:
```tsx
<DashboardHeader businessName={activeBusiness?.name || "Your Business"} />
```

## Security Posture
Even though `DEV_CONTEXT` bypassing is active (NextAuth removed), data isolation remains intact. The frontend never tells the backend *which* data to fetch. It is exclusively driven by the secure backend HTTP cookie injected during onboarding, mimicking a true SaaS tenant boundary.
