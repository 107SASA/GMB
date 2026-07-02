# Business Persistence Flow

## The Post-Onboarding Pipeline
When a user completes Step 9 of the Onboarding Wizard, an orchestrated backend flow executes at `POST /api/onboarding`.

### 1. User Creation
A `User` record is generated with a bypass hash and a `BusinessOwner` role.
### 2. Organization Creation
An `Organization` record is spun up, assigned to the `User`.
### 3. Business Creation
A `Business` record is created. This holds the rich payload:
- Google Maps Data (Place ID, URL, Lat/Lng)
- Meta Business Data (Facebook URL, WhatsApp Number)
- AI Sales Agent Parameters

### 4. Contextual Injection (The Cookie Bypasser)
To maintain a stateless, NextAuth-free development environment, the API automatically provisions an HTTP-only `activeBusinessId` cookie containing the newly minted `Business._id`. 

### 5. Dynamic Dashboard Fetching
The frontend `BusinessContext` queries `GET /api/business/active`, which parses the cookie, fetches the live MongoDB document, and hydrates the dashboard headers and subsequent modules with REAL user data.
