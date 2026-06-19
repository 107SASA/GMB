# Business Autofill & Database Flow

## Data Mapping
When a business is selected via the autocomplete dropdown, the following data is captured and mapped to the `OnboardingData` master state:

| Google Field | Onboarding Field | Notes |
| :--- | :--- | :--- |
| `name` | `businessName` | The exact GBP title |
| `formatted_address` | `address` | Full address string |
| `formatted_phone_number` | `phone` | Local/international format |
| `types[0]` | `category` | e.g. "dental_clinic" -> "dental clinic" |
| `website` | `website` | Used for future SEO auditing |
| `place_id` | `googlePlaceId` | Critical for API sync |
| `url` | `googleMapsUrl` | Direct link to maps |
| `geometry.location` | `latitude` / `longitude` | For mapping UI |
| `rating` / `user_ratings_total`| `rating` / `totalReviews` | Initial reputation baseline |

## Review Link Generation
Since the `placeId` is the universal identifier, we automatically generate the public review write link using the standard Google format:
`https://search.google.com/local/writereview?placeid={placeId}`
This populates the `gbpUrl` state and eliminates the need for the user to manually hunt for their review link.
