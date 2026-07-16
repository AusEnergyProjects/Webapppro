# Native electricity comparer parity audit

Status: **cutover gate passed**. The native comparer is the primary implementation
at `/compare`. The compatibility implementation remains available at the noindex
`/compare/electricity-legacy` rollback route.

Audit date: 16 July 2026

## Calculation credibility

| Area | Status | Evidence |
| --- | --- | --- |
| NEM12 interval use | Pass | General and controlled-load registers are retained separately. Dated half-hour intervals drive time-of-use windows, measured seasonal allocation, demand peaks, solar export and battery dispatch. |
| Manual usage profile | Pass | NEM12 upload is the primary path. When no file is available, the optional bill fallback uses exact dates and a bounded AEMO NSLP seasonal reference before the selected household pattern drives the synthetic half-hour profile. |
| Annual usage summary | Pass | An uploaded NEM12 file produces an automatic annual summary. Pricing still preserves the underlying interval pattern rather than substituting a synthetic timing profile. |
| Location | Pass | Postcode and distributor constrain eligible offers, so identical consumption in different locations can produce different plans, tariffs and rankings. |
| Tariff components | Pass | Single rate, time of use, usage blocks, daily supply, controlled load, measured demand, feed-in credits and supported discounts have typed charge-level evidence. |
| Solar and battery scenarios | Pass | Scenarios are simulated half-hourly and then repriced, including export timing and equipment-specific eligibility. |
| Reconciliation | Pass | Every plan and scenario audit reconciles supply, usage, controlled load, demand, feed-in and discounts to the displayed ranked annual total. |
| Limitations | Pass | Unsupported or uncertain tariff conditions are surfaced and are not silently assumed. |

## Interaction parity with the primary comparer

| Interaction | Status | Cutover note |
| --- | --- | --- |
| Postcode and ambiguous distributor choice | Pass | Native flow supports location selection before retrieving offers. |
| Annual usage and household usage pattern | Pass | Manual assumptions are used only without interval data and appear in the audit. |
| Local NEM12 parsing, chart and annualised summary | Pass | Processing stays in the browser; the measured period and automatic annual estimate are shown after upload. |
| Multi-register role confirmation | Pass | Every consumption register must be assigned as general usage or controlled load before pricing. |
| Solar, battery, EV and controlled-load inputs | Pass | Inputs flow into eligibility and scenario calculations. |
| Search, filters, show-more and source evidence | Pass | Available in the native results experience. |
| Plan and scenario calculation audit | Pass | Accessible dialog supports Escape, trapped focus and focus return. |
| NMI-assisted exact distributor lookup | Pass | NMI allocation runs locally, masks the identifier in the UI, confirms the network and rejects postcode/network conflicts without sending the NMI to the tariff service. |
| Drag-and-drop upload | Pass | Native input supports a labelled file picker and drag-and-drop; both use the same local typed parser. |
| Customer type selection | Pass | Residential and small-business selections are sent to the same-origin tariff endpoint and recorded in calculation evidence. |
| Reasoned override of NEM12 annualisation | Pass | The annual figure remains read-only until the user opens the adjustment flow. A positive value and reason are required; general and controlled registers scale proportionally while measured timing remains unchanged and the audit records the adjustment. |
| Distributor-specific meter-data guidance | Pass | NMI or confirmed network reveals the distributor's NEM12 instructions and data portal, with a local-processing privacy explanation. |
| Definitions and contextual help | Pass | An accessible native glossary explains NMI, NEM12, register roles, TOU, demand, supply, feed-in, conditional discounts and calculation audits. |
| Email top plans and six-month reminder | Pass | Native results submit only the three currently cheapest visible plans through the same-origin validated lead route after explicit reminder consent. Upgrade follow-up has a separate opt-in. |
| Upgrade enquiry actions | Pass | Each solar/battery scenario opens a keyboard-accessible, single-purpose consent dialog and sends only the scenario summary, safe assumptions and contact details. |
| Share/reminder URL restoration | Pass | A typed whitelist restores safe assumptions without auto-running. NMI, meter intervals, filenames, override reasons and contact data are excluded; meter-derived links require a fresh local upload. |
| Final mobile visual regression | Pass | Full inputs, results, evidence hashes, follow-up cards and enquiry dialogs fit a 390 by 844 viewport without horizontal overflow. |

## Cutover decision

The local cutover gate approves the native implementation for `/compare`.
The full 443-test suite passed 441 active tests with no failures. Two supplied
Origin fixture compatibility checks remained skipped because their fixture was
not present. Lint, TypeScript, database migration validation and the production
build passed. Interactive desktop and compact-width checks covered the NEM12-first
layout, optional manual bill flow, range calendar, seasonal annual estimate and
gas-comparator calendar integration. Browser logs contained no errors.

Recommended order:

1. Publish through the configured repository and Sites workflow.
2. Smoke-test `/compare`, `/api/electricity-plans` and the rollback route on production.
3. Confirm the production lead webhook before relying on email and enquiry delivery.
