# Onboarding Database Flow

## Goal
Ensure NO data is lost between the frontend React state-machine (`OnboardingData`) and the backend MongoDB persistence layer.

## The Payload Mapping
- `data.businessName` -> `Business.name`
- `data.category` -> `Business.category`
- `data.address` -> `Business.address`
- `data.googlePlaceId` -> `Business.placeId`
- `data.metaBusinessProfileUrl` -> `Business.metaBusinessProfileUrl`
- `data.whatsappBusinessNumber` -> `Business.whatsappConfig.businessPhone`

By doing a full 1-to-1 mapping inside `/api/onboarding`, the backend accurately mirrors the exact context the user constructed during the 9-step wizard.
