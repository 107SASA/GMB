# Platform Security Review

The following security measures have been standardized across the SaaS platform for production release:

## Authentication
- **NextAuth.js**: Powers the authentication layer, storing sessions in HttpOnly, secure cookies that cannot be accessed via client-side JavaScript (preventing XSS data theft).
- **Password Hashing**: User passwords are encrypted using `bcryptjs` before insertion into MongoDB.

## Data Isolation (Multi-Tenancy)
- **Session-Based Querying**: API endpoints no longer accept `businessId` via GET/POST parameters (which can be easily spoofed or manipulated in DevTools). Instead, they extract the user's `activeBusinessId` directly from the signed JWT payload on the server side (`getServerSession()`).
- **Compound Database Indexes**: Ensure `phone` or `email` uniqueness is scoped strictly to the `businessId`, preventing collisions between tenants.

## Webhook Validation
- **Idempotency**: Inngest functions use `step.run()` to guarantee that if a webhook fires twice (which Twilio often does on slow connections), the platform will not send duplicate AI replies or charge the business twice.

## Rate Limiting & Abuse Prevention
- Review Campaigns enforce a 2-day and 5-day pause between texts to prevent spam complaints and Twilio number blocking.
- The `optedOut` flag is respected universally across the platform prior to any outbound SMS dispatch.
