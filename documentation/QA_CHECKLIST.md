# QA Checklist

Before launching the platform to live customers, ensure every item on this list is verified.

## 1. Authentication & Security
- [ ] Attempt to access `/dashboard` without being logged in. Verifies middleware redirect to `/login`.
- [ ] Attempt to login with invalid credentials. Verifies error handling.
- [ ] Login successfully. Verify redirect to `/dashboard`.
- [ ] Check cookies to ensure `next-auth.session-token` is present and HttpOnly.

## 2. Multi-Business Isolation
- [ ] Create Business A and Business B.
- [ ] Import 5 Leads into Business A. Import 2 Leads into Business B.
- [ ] Switch active business in the Sidebar to Business A. Verify Dashboard shows 5 Leads.
- [ ] Switch active business to Business B. Verify Dashboard shows 2 Leads.
- [ ] Verify that Inngest Content Generation for Business A does not create Posts for Business B.

## 3. Webhooks & Automations
- [ ] Send a WhatsApp message to the Twilio number. Verify the Inngest worker picks it up and an AI reply is generated and sent.
- [ ] Send "STOP" via WhatsApp. Verify the `Customer` and `Lead` models are flagged with `optedOut = true`.
- [ ] Start a Review Campaign. Verify the initial message is sent, and the worker enters a 2-day sleep state.

## 4. UI/UX
- [ ] Test Mobile Responsiveness on Dashboard, Inbox, and CRM views.
- [ ] Verify CSV Upload drag-and-drop works with a 1,000 row CSV without crashing the browser.
- [ ] Verify loading spinners appear during manual data fetches and form submissions.
