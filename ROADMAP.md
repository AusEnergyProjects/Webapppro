# AEA Energy roadmap

## Current state

- Next.js app lives in C:\Webproject\aea-energy.
- /compare is the native typed electricity comparator. The compatibility implementation remains available at the noindex `/compare/electricity-legacy` rollback route.
- /gas-compare is the native Next gas page with a server-side gas-plan endpoint. `/compare/gas` remains a compatibility entry point.
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
- Gas supply is now explicitly gated between reticulated mains gas and LPG. LPG users are directed to supplier quotes before any CDR plan request is made.
- Residents can enter either a full-year MJ total or one bill with exact start and end dates. Recent bills are annualised using the selected heating or steady profile, so a winter bill is not multiplied as though usage were flat all year.
- Concession status is captured and disclosed without guessing a dollar value. Plan rankings remain on a consistent before-concession basis and residents are prompted to confirm transfer and evidence requirements with the retailer.

## Phase 4: expand the site

- Add guides, rebates, case studies, solar, batteries, heating, hot water and a Direct Trade Services entry journey.
- Continue monitoring consented saved comparisons and lead follow-up after production release.
- Deploy only after local build, desktop and mobile checks pass.

Progress as at 14 July 2026:

- The root route now presents Direct Trade Services as the main proposition instead of sending every visitor directly into electricity comparison. The previous `/getting-started` route remains as a compatibility entry point.
- Shared navigation connects Direct Trade Services, electricity and gas journeys, while the entry page explains what evidence to prepare, the difference between electricity and mains gas inputs, privacy boundaries and what to confirm before switching.
- A dedicated guides area now covers rooftop solar and home batteries. It explains household energy flow, sizing evidence, written quote requirements, installer and product checks, backup and VPP questions, and the federal battery support structure current at 14 July 2026.
- Solar and battery guides link directly into the existing half-hour scenario model so educational guidance and household calculations use the same evidence-led journey.
- Heating and hot water guides now cover building-load reduction, climate-zone performance, system sizing, noise, tariffs, written quote evidence and location-specific support checks. The hot water guide links certificate claims to the current Clean Energy Regulator model register.
- A location-aware rebates and assistance hub now separates federal certificates and programs from state, territory and provider support. It requires an explicit state or territory selection, shows the information date and caveats, and links each listed program to an official confirmation source without hard-coded dollar claims.
- A worked-examples area now explains electricity timing, solar self-use, battery dispatch and seasonal gas annualisation without inventing customer testimonials or guaranteed savings. Each example shows its evidence, method, decision lesson and limitations, plus the privacy and comparability requirements for future consented customer case studies.
- An insulation and draught-proofing guide now covers building-fabric diagnosis, R values, thermal bridges, moisture, deliberate ventilation, electrical and combustion-appliance safety, windows, quote scope and the need to reassess heating and cooling size after reducing the load.
- The shared visual foundation now uses a unified responsive header, contemporary typography, refined spacing, stronger hierarchy, consistent focus states, quieter page surfaces and polished cards, forms, buttons and hero treatments across the comparison and guidance journeys.
- The site-wide visual system now uses one maximum content width, shared spacing, radius, surface, shadow and action tokens, and a consistent navy, teal, emerald and restrained gold palette. The Getting Started hero includes original AEA-specific energy artwork, while desktop and mobile page shells use the same responsive geometry.
- The Direct Trade Services proposition now reflects an active trade network and current installer subscription model. It connects households and verified licensed installers while giving reputable wholesalers a route to place proven products into suitable customer homes through qualified trades.
- Direct Trade Specialist membership is explicitly separated from government accreditation, trade licensing and scheme-specific installer approvals. Customer-facing pages now share one `Powered by Australian Energy Assessments` footer component so later brand changes remain consistent across the site.
- The measured electricity chart now uses a vivid dark energy-dashboard treatment, lightweight native SVG gradients and pointer, touch and keyboard interval inspection without adding a chart library.
- Internal links now prefetch on intent and use client-side route transitions with a visible progress response. The homepage hero asset is reduced from about 1.95 MB to about 0.22 MB and external fonts use preconnect and swap loading.
- The redundant homepage development-status strip has been removed. The primary Direct Trade action now opens a structured household project brief for assessment, solar, batteries, heating and cooling, hot water, insulation, draught control and EV charging.
- Direct Trade project briefs require explicit location, project and contact choices, use the protected same-origin lead route and retain only allowlisted fields. The form warns households not to submit addresses, NMI details, meter files, bills, payment data or identity documents.
- Gas upgrade enquiries now use the same validated, rate-limited and consented server route instead of posting directly to an external webhook.
- Sites now holds the private enquiry delivery destination as a protected runtime setting, so consented project briefs can reach the existing live service without exposing the destination in browser code.
- A dedicated Direct Trade participation journey now accepts structured expressions of interest from licensed installers and reputable suppliers. It captures service areas and capabilities without asking applicants to place licence documents, identity records or sensitive commercial material into the initial form.
- A public Direct Trade standards page now defines participant review, supplier evidence, project matching, quote transparency, household choice, ongoing review and privacy boundaries. It also makes clear that subscriptions do not buy ranking, exclusivity or guaranteed opportunity volume.
- The full application now sits on a fixed deep-blue gradient canvas with teal and emerald ambient light, brighter canvas headings, stronger panel depth and a high-contrast footer. Existing white and tinted content surfaces remain the readable layer so shared cards, forms and comparison results stand out consistently across routes.
- A dedicated assessments hub now makes Australian Energy Assessments' new home NatHERS, existing home energy rating and NSW BASIX specialisation a first-class service. It separates plan-based and built-home pathways, shows dated official sources and approval boundaries, lists evidence to prepare, and keeps future document review outside the public form until secure controls exist.
- Shared navigation now keeps the core Direct Trade, comparison, guide, rebate and worked-example journeys ahead of the secondary assessments route. The header contains every hover and active state inside its shell, while assessment pathway cards share aligned content rows on desktop and return to natural stacked height on smaller screens.
- Direct Trade household briefs now infer the usual state or territory from a completed residential postcode, identify mismatches before submission and repeat the same consistency check on the protected lead route. Unknown postcode ranges remain reviewable rather than being rejected from a broad approximation, and the form still avoids collecting a street address.
