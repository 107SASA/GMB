# Meta WhatsApp Architecture

## Overview
The platform has officially migrated from a legacy Twilio integration to the official **Meta WhatsApp Business Platform**.

## Data Structure
The `Business` MongoDB model now handles WhatsApp configurations via the `whatsappConfig` object:
```json
{
  "whatsappConfig": {
    "provider": "meta",
    "businessPhone": "+14155238886",
    "metaProfileUrl": "https://business.facebook.com/...",
    "isConnected": true
  }
}
```

## Cloud API Readiness
We have established a scaffolding class at `src/services/whatsapp/meta.ts` (`MetaWhatsAppService`) that will act as the unified interface for all outbound graph API requests and inbound webhook parsing. This centralizes the logic so the AI Sales Agent can seamlessly interact with leads over Meta's infrastructure.
