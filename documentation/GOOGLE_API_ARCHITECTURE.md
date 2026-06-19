# Google API Architecture

## Security
To prevent exposing the `GOOGLE_MAPS_API_KEY` to the client (which could be scraped and abused), all Google API requests are proxied through our Next.js backend.

## Service Layer (`src/services/google/places.ts`)
This abstract class wraps the raw Google Maps API endpoints.
1. `autocomplete(query)`: Calls `maps/api/place/autocomplete/json`. Filters for `types=establishment`.
2. `getDetails(placeId)`: Calls `maps/api/place/details/json`. Fetches specific fields (`name`, `formatted_address`, `formatted_phone_number`, `website`, `rating`, `geometry`, etc.) to minimize API billing costs.

## Edge API Routes
We expose two lightweight Next.js route handlers:
- `GET /api/google/autocomplete?q=...`
- `GET /api/google/place-details?placeId=...`

These routes handle error states, validate inputs, and return clean JSON to the React frontend.
