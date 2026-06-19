# Multi-Business Implementation

## Database Schema Refactor
All core collections (`Lead`, `ConversationThread`, `Review`, `Post`) strictly require a `businessId` foreign key. 
In the previous architecture, APIs were extracting this from the query parameters, which allowed tenant spoofing. 

## Dynamic Service Resolution
Previously, Twilio and OpenAI keys were loaded statically at server boot from `process.env`.
In the new architecture:
1. When an Inngest background job fires, it receives a `businessId`.
2. The worker does a `Business.findById(businessId)`.
3. The `twilio` SDK is instantiated dynamically on-the-fly using `business.integrations.twilioSid` and `business.integrations.twilioAuthToken`.
4. Outbound messages are sent from `business.integrations.whatsappNumber`.

This ensures that Business A and Business B use completely distinct communication channels and AI contexts without interference.
