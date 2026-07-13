# AEA Energy roadmap

## Current state

- Next.js app lives in C:\Webproject\aea-energy.
- /compare is the native typed electricity comparator. The compatibility implementation remains available at the noindex `/compare/electricity-legacy` rollback route.
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
- Retain the compatibility route as a noindex rollback path until the native production release has a stable operating history.

Progress as at 13 July 2026:

- A typed NEM12 parser, domain model and reusable chart component now exist alongside the compatibility implementation.
- Synthetic and supplied-file parity tests compare the typed parser with the compatibility parser before migration work can proceed.
- Electricity CDR retrieval and strict tariff validation now run through a same-origin Next server route.
- `/compare` now runs typed single-rate, time-of-use, controlled-load, measured-demand and discount pricing with native result state, filters, cards and source diagnostics. `/compare/electricity-next` remains a noindex regression route.
- Native NEM12 input supports multiple consumption registers but requires the user to confirm every general-usage or controlled-load assignment before pricing. Supported demand offers require at least a 360-day span, 98% day coverage and 90% actual intervals, and use measured general-register peaks.
- Native solar and battery scenarios now run the typed half-hour flow model, price published feed-in tariffs against export timing, recalculate eligible equipment-specific offers and expose grid import, export, discharge, savings and payback evidence.
- Native plan and scenario calculation audits now expose charge-level evidence, exact annual reconciliation, interval-based time-of-use allocation and dated seasonal allocation. They record whether usage came from NEM12 evidence or a named manual assumption.
- Native location and input parity now includes local NMI-to-distributor matching, residential/small-business retrieval, drag-and-drop NEM12 input, a reasoned and audited annualisation override, and distributor-specific meter-data guidance. Mobile input verification passes at 390x844 without horizontal overflow.
- Accessible definitions, privacy-safe saved/reminder links, consented top-three email reminders and scenario-specific solar/battery enquiries now have native parity. Meter-derived links require a fresh local upload, and tests prove that NMI, interval, filename, adjustment-reason and contact data cannot enter the URL or validated lead payload.
- The full cutover gate passed on 13 July 2026: all 63 automated tests passed with the supplied Origin fixture, lint, TypeScript and production build passed, and interactive desktop/mobile, validation, audit, consent, privacy, restoration and rollback checks passed without browser errors.

## Phase 3: make gas comparison trustworthy

- Keep gas on its own page and use annual estimated cost as the primary ranking.
- Capture postcode, distributor, annual MJ, average daily or seasonal usage, mains gas versus LPG, concessions and winter usage assumptions.
- Price daily supply charges, declining blocks, GST and conditional discounts.
- Add offer details, rates, terms, retailer contact and side-by-side comparison.
- Align the user journey with Victorian Energy Compare: recent bill, usage profile, annual estimated offer ranking, offer details and retailer contact. The official guidance says gas usage is measured in MJ and offers are ranked by annual estimated price. [Government comparison guidance](https://compare.energy.vic.gov.au/assets/languages/english/how-to-compare-offers-on-victoria-energy-compare.html)

Progress as at 14 July 2026:

- Gas plans now use current CDR list v1 and detail v3 records with effective-date checks, retailer source coverage and update-time evidence.
- Annual MJ is allocated through an explicit gas-heating or steady-use profile before seasonal tariff periods are priced. Daily and monthly usage blocks reset at their published interval.
- Tariff calendars must cover all 365 days exactly once. Unsupported, overlapping or incomplete plans are excluded rather than ranked with a flat daily approximation.
- Ambiguous postcodes require the gas distributor shown on the bill before ranking. Conditional discounts are off by default, while eligibility, fees, incentives and other uncosted features remain visible.
- Appliance inputs are separated into heating, hot water, cooking, clothes dryer and pool or spa sections. The heating answer now sets the seasonal pricing profile automatically, removing the duplicate gas-use question, while unbenchmarked dryer and pool or spa allocations are labelled as broad proxies.
- Residents can shortlist up to three gas offers in a side-by-side view covering annual and monthly cost, supply and usage rates, seasonal pricing and conditions to confirm.

## Phase 4: expand the site

- Add guides, rebates, case studies, solar, batteries, heating, hot water and getting-started pages.
- Continue monitoring consented saved comparisons and lead follow-up after production release.
- Deploy only after local build, desktop and mobile checks pass.
