# Customer and job maps

The Jobs and Customers registers offer a Map view of the current filtered page.
Pagination bounds geocoding requests. Pins open the same records as the list.
Jobs use their service-site address; protected and missing addresses stay unlocated.
Council access and postcode-level trade availability are outside this feature.

## Google Cloud configuration

Use the existing billing-enabled Google Cloud project. Enable Maps JavaScript API
and Geocoding API. Create a dedicated browser key restricted to those two APIs
and the exact website referrers that serve TLink, including
`https://ausenergyassessments.com/*`. Add a development origin only when needed.
Do not expose or repurpose `TLINK_ADDRESS_AUTOCOMPLETE_TOKEN`.

Create a JavaScript map ID in Google Maps Platform's Map Management. Configure
these runtime values in the hosting environment:

- `TLINK_GOOGLE_MAPS_BROWSER_KEY`: the website-restricted browser key.
- `TLINK_GOOGLE_MAPS_MAP_ID`: the owned JavaScript map ID, not `DEMO_MAP_ID`.

The authenticated `/api/trade-map/config` route supplies only those public browser
values. Missing configuration leaves the record list available with an explicit
setup message. Google authentication, quota and lookup failures are distinguished
from empty results. No API key or customer address belongs in logs or source control.

Opening the map incurs Google map loads and address lookups under the project's
billing and quotas. Set project quotas and billing alerts appropriate to usage.
The map deduplicates addresses in memory and does not persist geocoded coordinates.
Only address text is sent to the geocoder; names, job descriptions and contact
details remain in TLink's record panel. No Google requests are made by list view.

## Verification before activation

Check one customer, one job at a distinct service site, shared-site records,
missing and protected addresses, filters/pagination, pin and list selection,
record opening, denied/quota errors, and narrow-screen layout. Verify real map
rendering on an allowed origin with the configured key. Local tests with a mocked
provider do not establish that billing, restrictions or real geocoding work.

References: [JavaScript API loading](https://developers.google.com/maps/documentation/javascript/load-maps-js-api),
[advanced markers](https://developers.google.com/maps/documentation/javascript/advanced-markers/start),
[geocoding](https://developers.google.com/maps/documentation/javascript/geocoding),
[API security](https://developers.google.com/maps/api-security-best-practices).
