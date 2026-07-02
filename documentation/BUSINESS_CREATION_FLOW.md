# Business Creation Flow

## The Data Payload
By the time the user reaches Step 9, the orchestrator has compiled a massive, unified JSON payload:
```json
{
  "fullName": "John Doe",
  "email": "john@example.com",
  "companyName": "Acme Corp",
  "businessName": "Acme HQ",
  "aiTone": "luxury",
  "selectedPlan": "growth"
  // ...
}
```

## API Execution
This payload is dispatched via `POST` to `/api/onboarding`.

### Creation Sequence
1. **User Record**: `User.create()` is executed using the email and hashed password.
2. **Organization Record**: `Organization.create()` is generated using `companyName` and tied to the new `userId`.
3. **Business Record**: `Business.create()` is initialized using the `businessName`, `aiTone`, `twilioSid`, etc., and linked to the `organizationId`.
4. **Context Injection**: The `User` record is updated with `activeBusinessId` pointing to the newly created location.

*Note: In `DEV_CONTEXT` mode, this API execution is bypassed, and the UI simulates a successful deployment before routing the user to the dummy dashboard.*
