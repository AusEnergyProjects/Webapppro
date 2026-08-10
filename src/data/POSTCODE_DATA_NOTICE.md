# Australian postcode centroid data

`postcode-centroids.json` is a compact derivative of the postcode-level data in
[`joelkoen/postcodes-au`](https://github.com/joelkoen/postcodes-au), copyright
2024 Joel Koen and provided under the MIT Licence.

The upstream data incorporates or was developed using G-NAF (c) Geoscape
Australia, licensed by the Commonwealth of Australia under the Open Geocoded
National Address File End User Licence Agreement.

Postcode centroids are approximate service-area points. They must not be
presented as a household or business street location.

## Public address locality selection

`postcode-localities.json` is a server-only compact derivative of the
Delivery Area rows in the dated
[`australian-postcodes-2026-05-27.csv`](https://github.com/schappim/australian-postcodes/blob/7874021a281bad87d8cd234a7d8f82d18f279fcc/australian-postcodes-2026-05-27.csv)
snapshot from `schappim/australian-postcodes`. Post Office Box rows and the
source's fictitious `9999 / NORTH POLE / VIC` test tuple are excluded. Suburb
and state remain an exact tuple because some postcodes cross state or territory
boundaries.

- Snapshot date: `2026-05-27`
- Source commit: `7874021a281bad87d8cd234a7d8f82d18f279fcc`
- Source SHA-256: `9120ed3f90b5dbfa12186ea11f19852f98b556e07c2cb3df5f93d1b97830bff8`
- Derived artifact SHA-256: `1d75e7645d79c50ec117fe7776ed88d761b5e64f474a6448af74ef60697f074c`
- Derived rows: `16,236` Delivery Area locality/state tuples across `2,644` postcodes

The source is provided as-is and is not a live Australia Post address service.
The application fails closed when a postcode or exact suburb/state tuple is
absent. Refreshing the snapshot requires a new pinned source, hashes and
regression review before release.
