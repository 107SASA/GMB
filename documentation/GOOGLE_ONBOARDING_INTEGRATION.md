# Google Onboarding Integration

## Overview
GMBBoost integrates the Google Places API directly into the onboarding wizard. By using an intelligent autocomplete input in Step 4 ("Business Details"), users can search for their business natively, exactly like they would on Google Maps.

## The UI Flow (`StepBusiness.tsx`)
1. **Search Mode**: The user is presented with a large, animated search bar.
2. **Debounce**: A custom `useDebounce` hook waits 300ms after the user stops typing to prevent hammering the Google API.
3. **Dropdown**: If the query is > 3 characters, a `framer-motion` dropdown appears with live suggestions.
4. **Selection**: Upon clicking a suggestion, the `placeId` is dispatched to the backend.
5. **Autofill**: The UI transitions to the "Manual Form" state, but fully pre-filled with the Google data (and shows a green "Connected to Google Maps" success banner).

## Step 5 Auto-Skipping
If a user selects a business via the search bar, the system automatically captures `googlePlaceId` and generates the `gbpUrl` (Review Link). Because of this, the manual "Google Connect" (Step 5) is effectively completed. The parent `OnboardingWizard` orchestrator will allow the user to breeze past Step 5.
