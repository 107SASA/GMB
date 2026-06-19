# User Flow Documentation

## 1. Landing Page Hook
Users click the "Get Started" or "Start Free Audit" buttons located in the `Navbar`, `Hero`, or `SocialProof` sections. These buttons route the user instantly to `/onboarding`.

## 2. The Wizard
The user progresses through 9 highly focused steps:
1. **Welcome**: Brand introduction and "Let's Get Started" CTA.
2. **Account**: Email and Password collection (with minimum length validation).
3. **Organization**: Parent company name definition.
4. **Business Details**: Granular data for the first workspace (Name, Phone, Category).
5. **Google Connect**: Optional Place ID and Maps URL collection for SEO ranking tracking.
6. **WhatsApp Connect**: Twilio API key injection (can be skipped).
7. **AI Personality**: Selecting the AI tone (Professional, Luxury, etc.) and defining custom sales prompts.
8. **Plan Selection**: Choosing the software package (Starter, Growth, Enterprise).
9. **Launch**: A success animation celebrating the creation of the workspace.

## 3. Post-Onboarding
Once the user clicks "Launch Dashboard" on Step 9, the system triggers the API creation sequence and routes the user to `/dashboard`. The UI will instantly boot into the newly created business context.
