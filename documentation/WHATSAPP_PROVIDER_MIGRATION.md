# WhatsApp Provider Migration

## Why Move Away From Twilio?
Twilio served as an effective MVP testing architecture, but moving to the direct Meta WhatsApp Cloud API provides:
1. Native integration with Facebook Business Pages.
2. Rich interactive message templates.
3. Lower latency and no middleman markup pricing.

## Status: IMPLEMENTED (Jul 2026)

The Meta Cloud API integration is now built and is the default provider. Twilio
remains in the codebase as an automatic fallback / rollback path.

### Architecture

| Piece | File | Notes |
| --- | --- | --- |
| Meta Graph API client | `src/services/whatsapp/meta.ts` | Text + template sends, 15s timeout, typed errors |
| Provider router | `src/services/whatsapp/send.ts` | Same `sendOutboundMessage(phone, body, leadId?, businessId?)` signature as the old Twilio client — all call sites import from here |
| Dual webhook | `src/app/api/whatsapp/webhook/route.ts` | `GET` = Meta verify handshake; `POST` parses Meta JSON (with `X-Hub-Signature-256` HMAC check) *and* legacy Twilio form-encoded bodies on the same URL |
| Legacy Twilio sender | `src/services/twilio/client.ts` | Unchanged; used when routed to Twilio |
| Business schema | `src/models/Business.ts` | Additive `whatsappConfig.phoneNumberId` / `wabaId` for webhook→business mapping |

### Provider routing rules (`send.ts`)
1. `WHATSAPP_PROVIDER=twilio` forces Twilio globally.
2. Otherwise Meta is used **only when** `META_WHATSAPP_ACCESS_TOKEN` and
   `META_WHATSAPP_PHONE_NUMBER_ID` are set; if they're empty, sends fall back
   to Twilio (so a sandbox deployment keeps working before Meta keys exist).
3. A business with `whatsappConfig.provider = 'twilio'` overrides to Twilio.

### 24-hour window / templates
Free-form text to a customer who hasn't messaged in 24h is rejected by Meta
(error 131047). When `META_UTILITY_TEMPLATE_NAME` is set, the router retries
automatically as that approved template with the message text as its single
`{{1}}` body parameter. Campaign initial sends, review reminders, and lead
follow-ups all rely on this — **the template must be created and approved in
Meta Business Manager before campaigns will deliver.**

### Delivery receipts
Meta posts `statuses` events to the same webhook; `delivered` / `read` /
`failed` are applied to `Conversation.messageStatus` (matched by wamid stored
in the `twilioSid` field) and failures to `MessageQueue`.

### Environment variables
```
WHATSAPP_PROVIDER=meta                  # or 'twilio' to force rollback
META_WHATSAPP_ACCESS_TOKEN=             # permanent System User token
META_WHATSAPP_PHONE_NUMBER_ID=          # Phone Number ID (not the phone number)
META_WHATSAPP_BUSINESS_ACCOUNT_ID=      # WABA ID
META_APP_SECRET=                        # Meta App secret — webhook signature check
META_WEBHOOK_VERIFY_TOKEN=              # any random string; must match webhook config
META_UTILITY_TEMPLATE_NAME=             # approved template with one {{1}} body var
META_TEMPLATE_LANGUAGE=en
META_GRAPH_API_VERSION=v23.0            # optional
```

### Meta dashboard setup (one-time)
1. Meta Business Manager → verify the business.
2. developers.facebook.com → create an app (type: Business) → add the
   **WhatsApp** product. Copy the **App Secret** → `META_APP_SECRET`.
3. WhatsApp → API Setup: register the sender phone number (it must NOT be in
   use on the WhatsApp/WA Business app). Copy the **Phone Number ID** →
   `META_WHATSAPP_PHONE_NUMBER_ID` and **WABA ID** →
   `META_WHATSAPP_BUSINESS_ACCOUNT_ID`.
4. Business Settings → System Users → create a system user with access to the
   app + WABA → generate a **permanent token** with
   `whatsapp_business_messaging` + `whatsapp_business_management` →
   `META_WHATSAPP_ACCESS_TOKEN`.
5. App → WhatsApp → Configuration → Webhook:
   - Callback URL: `https://<domain>/api/whatsapp/webhook`
   - Verify token: value of `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the **messages** webhook field.
6. WhatsApp Manager → Message Templates → create the utility template (single
   `{{1}}` body variable), wait for approval, put its exact name in
   `META_UTILITY_TEMPLATE_NAME`.
7. Set each Business's `whatsappConfig.businessPhone` (done in onboarding) —
   the webhook maps inbound messages to a business via this number or via
   `whatsappConfig.phoneNumberId`.

### Rollback
Set `WHATSAPP_PROVIDER=twilio` and point the Twilio sandbox/sender webhook
back at `/api/whatsapp/webhook` — the route still parses Twilio form posts.
