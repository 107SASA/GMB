# Data Isolation Report

## 🛡️ Tenant Separation

### 1. API Protection
The `getAppSession()` utility guarantees that APIs can only return data matching the authenticated user's active session.
```typescript
const businessId = session.user.activeBusinessId;
const leads = await Lead.find({ businessId });
```

### 2. Webhook Protection
Since Twilio webhooks are anonymous HTTP requests, they cannot use NextAuth. 
Instead, the webhook parses the `To` phone number in the Twilio payload and queries the database for a `Business` matching that exact `whatsappNumber`. The message is then securely routed into that Business's CRM.

### 3. Middleware
The Next.js Edge middleware locks down the entire `/dashboard` and `/api/*` space. It also enforces the `/onboarding` redirect loop until `user.onboardingCompleted` is explicitly true, preventing users from accessing APIs with incomplete integration data.
