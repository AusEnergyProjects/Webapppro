# AEA Energy roadmap

## Current state

- Next.js app lives in C:\Webproject\aea-energy.
- /compare is the original production electricity comparator served through a same-origin Next route so all proven interactions remain available.
- /compare/gas is the new native Next gas page with a server-side gas-plan endpoint.
- The Electricity compare and Gas compare tabs now link the two tools.

## Phase 1: protect the working comparator

- Keep NMI to distributor lookup, NEM12 upload and drag/drop, usage chart, plan retrieval, tariff estimates, solar, battery, filters and lead flow working.
- Use the original HTML as the acceptance reference while porting.
- Test desktop and mobile before each replacement.

## Phase 2: finish native electricity migration

- Move the legacy NEM12 parser and chart into typed client modules.
- Move CDR electricity retrieval and tariff estimation behind a Next server route.
- Recreate the result cards, filters, solar and battery scenarios in native components.
- Remove the compatibility route only after the complete interaction audit passes.

## Phase 3: make gas comparison trustworthy

- Keep gas on its own page and use annual estimated cost as the primary ranking.
- Capture postcode, distributor, annual MJ, average daily or seasonal usage, mains gas versus LPG, concessions and winter usage assumptions.
- Price daily supply charges, declining blocks, GST and conditional discounts.
- Add offer details, rates, terms, retailer contact and side-by-side comparison.
- Align the user journey with Victorian Energy Compare: recent bill, usage profile, annual estimated offer ranking, offer details and retailer contact. The official guidance says gas usage is measured in MJ and offers are ranked by annual estimated price. [Government comparison guidance](https://compare.energy.vic.gov.au/assets/languages/english/how-to-compare-offers-on-victoria-energy-compare.html)

## Phase 4: expand the site

- Add guides, rebates, case studies, solar, batteries, heating, hot water and getting-started pages.
- Add saved comparisons and lead follow-up only after consent, privacy and backend behaviour are reviewed.
- Deploy only after local build, desktop and mobile checks pass.
