This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Site journeys

- `/` is the simplified home energy starting point.
- `/plan` creates a private, no-account roadmap from the household's goal, property situation, existing equipment and preferred pace.
- `/guides` connects the whole-home guidance library, including building fabric, heating, hot water, electric cooking, solar, batteries and EV charging.
- `/rebates` separates official federal support from state, territory and provider programs and sends users to the current source before relying on eligibility.
- `/assessments` explains the NatHERS, existing-home rating and BASIX pathways.
- `/direct-trade` turns a defined project into a privacy-safe brief for manual review.

## Comparison routes

- `/compare` is the primary typed electricity comparer.
- `/compare/electricity-next` is a noindex native regression route.
- `/compare/electricity-legacy` preserves the compatibility implementation as a noindex rollback path.
- `/gas-compare` is the gas comparer.

## Electricity tariff sources and freshness

The electricity comparer retrieves current plan records from retailer Consumer Data Right product-reference-data endpoints. Retailer endpoint discovery currently uses the community-maintained Australian CDR register directory because the AER does not publish a dynamic JSON directory of retailer endpoints. Plan names, prices, eligibility, fees, effective dates and retailer update times come from the official AER and Victorian government Energy Product Reference Data APIs, not from the directory.

The service uses list API v1 and detail API v3, rejects plans that are not yet effective or have expired, and caches successful retrievals for no more than one hour. Retrieval time is not described as the retailer publication time. Every response reports source coverage, validation failures, missing timestamps and the oldest and newest retailer update times represented in the result.

Recognised equipment and customer-type eligibility is enforced by the comparison engine. Conditions that cannot be proven from the supplied inputs remain visible as retailer confirmations, and published contract terms are retained in each calculation audit. Fees, benefits or tariff structures that cannot be costed are labelled or excluded rather than silently treated as zero.

## Solar and battery scenario assumptions

Upgrade scenarios simulate solar and battery energy flows half-hourly, but their financial output is a simple first-year bill-saving comparison rather than a lifetime return forecast. The consumer can replace the state-level solar yield, battery round-trip efficiency and every installed-cost input. Changing a system size refreshes the cost field to a dated model default so an old quote is not silently applied to a different system size.

Cost model `2026-07-14` uses an indicative solar net installed cost of $850 per kW and an indicative battery gross installed cost of $1,000 per usable kWh. Its federal battery discount estimate uses the May to December 2026 factor of 6.8 STCs per eligible kWh, the current capacity taper and the government clearing-house value of $40 per STC. These are transparent modelling placeholders, not market quotes or an eligibility decision. The UI asks the consumer to replace them with complete written installed quotes after every applicable discount.

The scenario caveat identifies omitted lifetime and site variables, including degradation, replacement, finance, warranty, VPP control, roof geometry, shading, inverter constraints, export limits, connection work and product compatibility. It links to the government-supported SunSPOT calculator and Australian Government quote checklist for roof-specific and installer-specific checks.

## Gas comparison integrity

The gas comparer retrieves current list API v1 and detail API v3 product-reference-data records. It rejects future or expired records, reports retailer source coverage and publication timestamps, and does not claim complete-market coverage when a source or plan detail fails.

Annual gas MJ is allocated using an explicit household pattern. The gas-heating profile concentrates usage in cooler months, while the hot-water-or-cooking profile spreads usage evenly through the year. Published seasonal calendars must cover every day exactly once. Daily and monthly usage blocks reset at the correct interval, and plans with overlapping, incomplete or unsupported tariff periods are excluded from ranking.

Postcodes can contain more than one gas distribution network. When multiple networks are represented, the consumer must choose the distributor printed on the gas bill before any ranked results are shown. Conditional discounts are excluded by default, and uncosted fees, incentives and retailer eligibility conditions remain visible on each result.

## Local enquiry delivery

The comparer submits result emails and upgrade enquiries to the same-origin `/api/leads` route. Configure the downstream processor in an ignored `.env.local` file:

```text
AEA_LEAD_WEBHOOK_URL=https://your-private-lead-processor.example/endpoint
AEA_LEAD_RATE_LIMIT_SECRET=replace-with-at-least-32-random-characters
```

Do not expose either value through a `NEXT_PUBLIC_` variable. The route validates the request, checks consent evidence, applies a durable shared rate limit through the site-scoped `aea-lead-rate-limit` Netlify Blobs store, and only reports success after the downstream processor returns the exact acknowledgement `ok`. Raw IP addresses are never stored: the limiter uses an HMAC-obscured client key and an atomic rolling list of recent request times. Local Next.js development uses an in-memory fallback because Netlify Blobs requires `netlify dev` outside production.

The current Google Apps Script processor is tracked at `integrations/google-apps-script/lead-email-relay.gs`. Website submissions use schema version 6 and one of five explicit events: electricity comparison results, electricity upgrades, gas upgrades, Direct Trade household projects and Direct Trade partner applications. Eligible household briefs enter privacy-safe allocation automatically unless property authority is unconfirmed. Up to six approved installers can see a limited opportunity summary, no more than three can receive a customer handover, each connected installer can record no more than two contact attempts, and the opportunity closes after 30 days. Suppliers cannot access household opportunities. Solar, battery, heating and hot-water scenarios can start a Direct Trade brief with only an allowlisted journey source, service selection, priority selection and postcode in the URL. Usage, meter files, NMIs, bill dates, plan results, scenario costs, savings, contact details and adjustment reasons are never placed in that handoff URL. Partner applications begin a structured review that cannot automatically approve or publicly list the applicant. Every delivered request receives an `AEA` reference shared by the browser acknowledgement, customer email, internal email and spreadsheet row. Customer and internal messages use the same navy, teal, emerald and restrained gold visual system as the website, include plain text fallbacks and show only fields relevant to that request.

Comparison emails require a positive annual usage value and at least one complete ranked plan. Scenario emails omit unavailable optional values instead of printing placeholders. New reminder unsubscribe links contain an opaque random token only. They never include an email address, phone number, meter identifier or energy data.

### Privacy-safe webhook delivery probe

`POST /api/internal/lead-webhook-probe` verifies that the configured lead processor is reachable and returns a successful acknowledgement. It sends a dedicated `webhook.delivery_probe` event containing only a test flag, probe ID, timestamp, schema version and application name. It does not pass through lead validation and contains no customer, contact, meter, usage, postcode or plan data.

Configure a separate random token of at least 32 characters as `AEA_LEAD_WEBHOOK_TEST_TOKEN`. The downstream processor must treat `eventType: "webhook.delivery_probe"` or the matching `X-AEA-Event-Type` header as an operational event and must not create a customer lead. Invoke the probe from PowerShell without printing the token:

```powershell
$headers = @{ Authorization = "Bearer $env:AEA_LEAD_WEBHOOK_TEST_TOKEN" }
Invoke-RestMethod -Method Post -Uri "https://compare.ausenergyassessments.com/api/internal/lead-webhook-probe" -Headers $headers
```

An `ok: true` response proves that the application reached the processor and received its exact `ok` acknowledgement. The Apps Script branch for this event must return before opening the customer sheet or sending mail. Confirming any downstream audit record still requires checking the processor itself by `probeId`.

### API monitoring and alerts

An hourly Netlify scheduled function checks `/api/electricity-plans` and the privacy-safe lead delivery probe. Configure `AEA_OPS_ALERT_WEBHOOK_URL` to an alert receiver that accepts JSON and notifies an operations channel. Failure and recovery notifications are deduplicated through the site-scoped `aea-operations` Netlify Blobs store. API responses include an `X-Request-Id`, and server logs contain structured outcome and aggregate source metrics without request bodies, contact details, IP addresses, NMIs or meter data.

See [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md) for configuration, alert behavior, privacy boundaries and incident response steps.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
