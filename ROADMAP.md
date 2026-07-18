# AEA Energy roadmap

## Current state

- Next.js app lives in C:\Webproject\aea-energy.
- /compare is the native typed electricity comparator. The compatibility implementation remains available at the noindex `/compare/electricity-legacy` rollback route.
- /gas-compare is the native Next gas page with a server-side gas-plan endpoint. `/compare/gas` remains a compatibility entry point.
- The Electricity compare and Gas compare tabs now link the two tools.

The exact release status, validation evidence and external dependencies are maintained in [docs/RELEASE_TRUTH.md](./docs/RELEASE_TRUTH.md). The external audit response is tracked in [docs/EXTERNAL_AUDIT_REMEDIATION.md](./docs/EXTERNAL_AUDIT_REMEDIATION.md).

Every AI-assisted milestone must follow [docs/AI_DELIVERY_GUARDRAILS.md](./docs/AI_DELIVERY_GUARDRAILS.md) and begin from the single rolling [next-task handover](./docs/HANDOVER_NEXT_TASK.md).

## Release-quality remediation programme

### P0: safety and release truth

- Completed: synthetic benchmark population is outside the production migration path. Historical migration identifiers remain as no-op compatibility records, while test fixtures require an explicit workflow.
- Completed: generated synthetic credentials and benchmark output are ignored.
- Completed: active web and worker typecheck, runtime integration tests, coverage, fresh D1 migration validation and one aggregate `npm run validate` command are available.
- Completed: commercial Stripe links and payment-link identifiers are validated server configuration rather than source constants.
- Completed: inactive Netlify deployment configuration is removed. Sites and GitHub are the only active release targets.
- Completed: one canonical release-truth document identifies what is implemented, externally dependent or not yet verified.
- Completed: Stripe production preflight on 17 July 2026 found no active account tasks, four active Direct Trade membership payment links at the configured prices, and one active membership webhook destination with five events and a 0% error rate. Webhook secrets remain intentionally non-displayable and must remain configured as deployment secrets.

### P1: architecture and maintainability

- In progress: split `AdminOperationsPortal.tsx` into feature workspaces, typed API clients and reducer-backed domain hooks without changing the admin workflow. Opportunity, catalogue, account, inbox and product-enquiry workspaces are feature-owned.
- In progress: move feature styling out of `globals.css` beside TLink CRM, catalogue, admin, consumer and comparison features. Remove obsolete selectors only after visual regression checks.
- In progress: one canonical uppercase Australian state code now drives new writes and filtering. Migration 0045 normalises existing stored state values.
- Completed foundation: shared keyset pagination, list controls, searchable lookups, high-volume table behaviour and route telemetry are reusable across admin, CRM, catalogue and purchasing.
- Next: extract the referral workspace, then reassess the remaining stateful admin shell one domain at a time.

### P2: production scaling

- Completed foundation: cursor pagination covers the major admin, CRM, catalogue and purchasing endpoints.
- Completed foundation: bounded server search and D1 FTS5 indexes cover products, accounts, customers, opportunities and CRM customer records.
- Completed foundation: API and database timing telemetry records slow or failed requests without request bodies or household identity.
- Completed foundation: the 400,000-row scale benchmark and high-volume list views protect the primary query paths.
- Completed foundation: the admin performance panel evaluates 7-day p95 latency, average database time, error rate and minimum sample SLOs, and exposes read-only query plans for the principal keyset lists.
- Next: monitor real-traffic SLO results, then add specialised indexes only where telemetry proves a need.

### P3: controlled retirement and native release

- Keep the compatibility electricity comparator until the native route completes its stability period and parity gate.
- Complete physical iOS and Android device acceptance, store credentials and release signing before field-app distribution.
- Retire historical design and status documents only after their durable decisions are merged into release truth and this roadmap.

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

- The root route now provides one simple home energy starting point instead of requiring visitors to choose a specialist tool first. It offers a private roadmap, direct electricity or gas comparison and a project-ready trade brief. The previous `/getting-started` route now forwards to the roadmap.
- A private, no-account `/plan` journey orders the next steps from household goal, authority context, existing equipment and preferred pace. It covers urgent replacement, renters and strata, building fabric, appliance electrification, solar, storage, EV charging, current support and the final project brief without collecting an address, bill, meter identifier or contact details.
- Shared navigation is reduced to six clear choices: start, home energy plan, electricity comparison, gas comparison, guides and rebates, and assessments. Direct Trade, rebates and worked examples remain available in the contextual journeys where they are relevant.
- A dedicated guides area now covers rooftop solar and home batteries. It explains household energy flow, sizing evidence, written quote requirements, installer and product checks, backup and VPP questions, and the federal battery support structure current at 14 July 2026.
- Solar and battery guides link directly into the existing half-hour scenario model so educational guidance and household calculations use the same evidence-led journey.
- Heating and hot water guides now cover building-load reduction, climate-zone performance, system sizing, noise, tariffs, written quote evidence and location-specific support checks. The hot water guide links certificate claims to the current Clean Energy Regulator model register.
- Electric cooking and home EV charging guides now cover appliance fit, electrical enabling work, gas isolation, ventilation, driving needs, charging controls, solar timing, site capacity and approval requirements for renters, strata and shared buildings.
- A location-aware rebates and assistance hub now separates federal certificates and programs from state, territory and provider support. It requires an explicit state or territory selection, shows the information date and caveats, and links each listed program to an official confirmation source without hard-coded dollar claims.
- A certificate price tracker now explains STC, ESC, VEEC, PRC, LGC, ACCU and SMC markets in plain English, stores six months of validated reported trades, refreshes them through the scheduled worker and exposes an accessible chart with explicit indicative-price caveats.
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
- Direct Trade household briefs now capture the household's property role and structured priorities such as comfort, running costs, equipment replacement, electrification, resilience and assessment evidence. A review panel reflects the selected services, location, authority context and priorities before consent, while the protected lead route allows only the defined matching fields.
- The email workflow now uses a versioned event contract across electricity comparisons, electricity and gas upgrades, Direct Trade project briefs and installer or supplier applications. Customer and internal emails share the site's visual system, carry the same opaque reference, omit unavailable values, escape submitted content and use correct reply routing. Comparison delivery rejects incomplete usage or plan data, while new unsubscribe links use opaque tokens instead of placing customer email addresses in URLs.
- Direct Trade project briefs now create a versioned internal triage record with manual review status, priority, authority and scope flags, verified participant matching criteria and a category-specific quote evidence checklist. The matching engine excludes participants without approved status, verified credentials, verified insurance, service coverage and every required capability, and it cannot automatically distribute a household brief.
- Direct Trade participant applications now begin a versioned manual review with installer or supplier evidence checks and no automatic approval or public listing. Participant records must pass current business, review, coverage, capability and role-specific evidence controls before matching, while public profile projections require separate consent and review and omit private credential, insurance and contact data.
- Electricity solar and battery scenarios and gas heating and hot-water estimates now hand off into prefilled Direct Trade project briefs. The handoff carries only an allowlisted journey source, service choices, priorities and postcode, while usage, NMI, meter files, bill dates, plan results, costs, savings, contact details and adjustment reasons remain outside the URL.
- Direct Trade installer and supplier participation now uses the shared visible field treatment for text, URL, email, phone and summary controls, with stronger borders plus consistent hover, keyboard-focus, selected and mobile states across field and checkbox components.
- Direct Trade account language now clearly describes subscription membership without free, paid or individually purchased leads. Business profiles require a private Australian business address, Google sign-in uses the official identity mark and signed-in installers and wholesalers can open a role-aware starter dashboard.
- The starter dashboard shows real profile, verification, membership and opportunity readiness states without invented activity. It previews GST-inclusive installer and wholesaler pricing, keeps Stripe controls disabled until an approved billing phase and explains the planned two-sided referral credit with basic misuse safeguards.
- DIRECT_TRADE_DASHBOARD_PROMPT.md is the implementation brief for secure verification, Stripe subscriptions, referral credits, opportunity operations and the expanded wholesaler workspace.
- Signed-in businesses can now save whether they are open, limited or paused for future matching and choose suitable-opportunity and weekly-summary email preferences. These preferences remain inactive until verification and membership launch.
- A role-specific verification centre now explains installer licence and insurance checks or wholesaler product, warranty and Australian support checks without opening unsafe document uploads.
- Paid installers can now turn a Business Hub work record into an owner-scoped installed asset, warranty, compliance and protected document pack. Platform-linked customer handovers require completed work, resolved checks, a customer-visible document and administrator approval before appearing in the household's always-free project dashboard. Internal trade records remain useful without exposing household contact or street-address fields.
- Approved installed assets now continue into a durable lifecycle layer. Paid installers can create recurring service schedules, record completion history and pause or reactivate future dates without gaining household contact access. Customers receive free dashboard reminders, warranty dates, service history and voluntary Google Calendar actions inside the linked private project.
- Administrators can now draft, publish and withdraw sourced asset safety notices targeted by installed category, brand or model. Matching uses product records only, shows affected asset counts without household identities and records customer acknowledgements plus administrator audit history.
- Customers now have an always-free home asset passport that remains separate from project identity. A current household can create a seven-day one-time transfer code, a receiving household can consent while signed in and an administrator must approve both consents before live asset, document, lifecycle and safety access changes. Only a SHA-256 hash of the claim code is stored, neither household sees the other account identity and every ownership event remains in an immutable ledger.
- Paid installers can now propose controlled one-field corrections to published handover assets. The previously approved value remains live while the proposal is reviewed, administrator approval publishes a numbered version and rejection preserves the existing record. Customer and administrator views show the correction history without adding customer contact or address fields.
- A public membership page now compares all four GST-inclusive installer and wholesaler billing options, explains equal matching rules and records the planned two-sided referral credit before Stripe is connected.

## Phase 5: native field platform and offline operation

- Treat iOS and Android field apps as first-class clients of the same installer platform, not as separate products with separate records.
- Keep the web CRM as the owner, office and dispatch workspace. Keep the future mobile apps focused on assigned work, checklists, time, field evidence and handover completion.
- Design every field mutation for delayed delivery, safe replay, revision conflicts and explicit removal from a device when work is unassigned.
- Require encrypted device storage, purge data on sign-out and tightly expire any direct-customer address cached for assigned work.
- Never sync AEA protected customer identity, contact information or street address to a trade device.
- Use the versioned technician sync contract documented in `docs/MOBILE_FIELD_SYNC.md` for future native client work.

Progress as at 16 July 2026:

- Installer jobs and checklist items now carry server revisions for optimistic conflict detection.
- A durable sync ledger records job upserts and deletion tombstones separately for the dispatch workspace and each assigned technician.
- Field actions accept stable client action IDs, record hashed idempotency receipts and safely recognise duplicate delivery.
- The first versioned sync API supports bootstrap snapshots, opaque cursors, bounded change pages, job-stage changes, checklist completion and technician time entries.
- Direct-customer addresses are limited to assigned jobs with a 24-hour offline cache policy. AEA protected jobs remain region-only with a seven-day non-contact cache policy.
- Registered iOS and Android installations now have server-enforced minimum app versions, private push-token storage, last-seen records and immediate owner-controlled revocation from the CRM Team area.
- Assigned-job changes now create data-free push outbox events. Notification payloads contain only an opaque job reference and an instruction to perform an authorised sync.
- Field photos and PDFs now use idempotent 24-hour multipart upload sessions with resumable 5 MB parts, a 50 MB limit, completion recovery and CRM revision updates after assembly.
- Interrupted queued actions now use processing leases, safe retry responses and durable completion receipts so a network failure cannot leave the mobile queue permanently blocked.
- A native Expo SDK 57 field app now implements the version 2 contract for iOS and Android. Its focused technician experience covers assigned work, system job IDs, job stages, checklists, time, camera and document evidence, sync status, conflicts and account security.
- Field metadata is encrypted with SQLCipher. Photos and documents are split into authenticated AES-256-GCM chunks with a secure-store key, then decrypted one part at a time for resumable upload.
- Native devices now bootstrap, process deltas and tombstones, replay offline actions, recover uploads, register native push tokens, sync after reconnection and use operating-system background windows without exposing protected household information.
- Installer jobs now support versioned, trade-aware pre-start, commissioning, completion and scheduled-service records. These are supporting technical records with explicit licence, certificate, permit and standards boundaries, not automatic proof of regulatory compliance.
- Asset service schedules can now create system-numbered recurring jobs once each due date enters its chosen lead window. A durable service-plan and due-date ledger prevents duplicates, saved job templates provide the checklist and AEA protected jobs retain their privacy boundary.
- Assigned native jobs now sync versioned technical form snapshots into the encrypted offline payload. Technicians can save or complete forms without reception, with required-field validation, idempotent replay and revision conflict handling.
- Remote revocation and sign-out purge the encrypted database, queued evidence, address cache and encryption key. Direct customer addresses expire from the offline cache after 24 hours.
- Phase 5 implementation is ready for physical-device acceptance testing. Store distribution still requires the business Apple and Google developer accounts, Firebase mobile configuration files, native Google OAuth client IDs and APNs or FCM release credentials.

## Phase 6: make Direct Trade the free trade operating system

### Product decision

Direct Trade will use the trade operating platform to grow marketplace supply. Core trade software is therefore an acquisition product, not a subscription product.

This decision supersedes the subscription-led access model recorded in the Phase 4 implementation history. The current membership pages and entitlement gates remain part of the implemented state until they are removed, but they are not the target product model.

- A verified trade receives the CRM, quoting, scheduling, field app, forms, team access, accounting integrations, marketplace opportunities and customer portal for A$0.
- Do not charge per user, per job, per quote or per marketplace lead.
- Do not require a payment card during onboarding.
- Do not sell marketplace ranking, exclusivity or preferred access to opportunities.
- Verification, licensing, insurance, role permissions and customer privacy remain mandatory controls.
- Generic CSV and Excel import is sufficient. Do not build or maintain bespoke Simpro, Tradify, Fergus or ServiceTitan importers.
- The product must support a sole trader without exposing unnecessary administration while retaining the roles, audit, branch and cost controls required by larger organisations.

The product succeeds when a trade can run the complete workflow without duplicate entry:

`Enquiry -> customer and site -> quote -> acceptance and deposit -> job and phases -> schedule -> field work -> costs -> invoice and payment -> asset and service history -> rebooking`

### Competitive implementation benchmark

Use the current official workflows as acceptance references, then remove their avoidable friction:

- Tradify sets the small-trade baseline for fast quotes, kits, online acceptance and quote-to-job conversion. Match the simplicity while providing complete offline work, stronger stock control and better quote options. See [Tradify quote creation](https://help.tradifyhq.com/hc/en-us/articles/360016443414-Create-a-Quote) and [quote acceptance](https://help.tradifyhq.com/hc/en-us/articles/360016571573-Accept-a-Quote).
- Fergus sets the growing-trade baseline for job phases, quote options, supplier-document reconciliation, back-costing and AI connectivity. Match the financial depth while simplifying communications, invoice corrections and mobile work. See [Fergus job cards](https://help.fergus.com/en/articles/3491998-the-job-card), [job phases](https://help.fergus.com/en/articles/10518804-job-phases-explained) and [supplier reconciliation](https://help.fergus.com/en/articles/2039991-reconciling-supplier-documents).
- Simpro sets the enterprise baseline for customer, site and asset hierarchy, cost centres, stock allocation, purchase orders, project costing and recurring maintenance. Provide the same underlying control with progressive disclosure rather than setup-heavy screens. See [Simpro service jobs](https://helpguide.simprogroup.com/Content/Service-and-Enterprise/Service-Jobs.htm).
- ServiceTitan sets the service-business baseline for booking, dispatch, estimate outcomes, mandatory field completion and operational AI. Reproduce the useful flow without its enterprise-only complexity. See [ServiceTitan estimate workflows](https://help.servicetitan.com/docs/estimate-workflows-in-servicetitan-and-servicetitan-mobile) and [field completion](https://help.servicetitan.com/docs/complete-the-work-in-the-field).

### Current blockers to remove

- The strongest installer CRM is routed to paid installers while free installers receive the older Business Hub.
- The paid CRM does not expose the existing platform-opportunity-to-work-order conversion, leaving the marketplace lead flow disconnected from the strongest operational workspace.
- Quotes and invoices are represented primarily by aggregate totals rather than authoritative line items, revisions, accepted scope, payment stages and cost allocations.
- Scheduling is a chronological list rather than a drag-and-drop dispatch board.
- Field work supports checklists, time and evidence but not the complete arrive, materials, variation, sign-off, invoice and payment flow.
- Purchasing is not one continuous quote-to-requirement-to-stock-or-PO-to-receipt-to-job-cost workflow.
- Accounting export is aggregate and the integration centre is limited to Xero, MYOB, Stripe and Square.
- Data import is narrow and AI-assisted trade operations are not implemented.

### Product and UX structure

Use one authoritative trade workspace. Remove the separate weak free hub and strong paid CRM paths.

Desktop navigation:

- Today
- Leads
- Schedule
- Jobs
- Customers
- Money
- Stock
- Marketplace

Mobile navigation:

- Today
- Jobs
- Add
- Inbox
- More

Every job uses the same tabs:

- Overview
- Schedule
- Quote
- Work
- Costs
- Invoice
- Files
- Activity

UX requirements:

- One primary action per screen.
- One authoritative customer, site, quote and job record across marketplace, office and field clients.
- Autosave drafts and make reversible actions undoable.
- Use progressive disclosure for branches, cost centres, approvals and other advanced controls.
- Show an actionable resolution for every validation or sync error.
- Keep customer quote, booking and payment actions usable on a phone without requiring an account.
- Keep common field-job completion to six deliberate actions or fewer, excluding the work data itself.
- Preserve complete keyboard operation, accessible labels, visible focus states and mobile layouts without horizontal overflow.

### Authoritative domain model

Introduce explicit entities instead of adding more aggregate fields to the current CRM job record:

- Customer -> account contacts and sites -> site contacts -> assets -> service history.
- Enquiry -> source -> conversation -> quote revisions.
- Quote revision -> sections -> options -> line items -> accepted scope.
- Accepted scope -> job -> phases -> appointments -> tasks and forms.
- Quote line -> material requirement -> stock reservation or purchase order -> receipt -> supplier bill -> job cost.
- Job and phase -> time, materials, subcontractors, overhead, variations and margin.
- Job -> deposit, progress, phase and final invoices -> payment allocations and credits.
- Service agreement -> covered sites and assets -> recurring jobs and invoices.

Published quotes, accepted variations, invoices, completed forms and signed service reports must be immutable revisions with a complete audit history.

Create the organisation, branch, user, role, permission and audit entities with this foundation so later scheduling, financial and reporting features do not have to retrofit tenancy or security boundaries.

## Build order for the trade platform

### Build step 1: remove access and workflow blockers

Deliver:

- Remove subscription and seat entitlements from core trade operations.
- Allow every verified trade to use leads, marketplace, CRM, quotes, scheduler, team, field app, forms, purchasing, catalogue and customer handover.
- Keep verification and role permissions as the only access gates.
- Route all trades into one authoritative workspace.
- Add `Create quote`, `Book site visit` and `Create job` directly to a marketplace opportunity.
- Preserve every authorised opportunity, customer, site, location, message, photo, document, source, matching and audit field through conversion. Keep protected marketplace locations region-only until the existing consent and assignment rules authorise a service address.
- Add an end-to-end contract test for marketplace opportunity -> accepted quote -> CRM job.

Acceptance criteria:

- A verified trade can join and start work without a card or paid membership.
- Free and previously paid users operate on the same data and screens.
- No marketplace opportunity requires customer or job information to be entered again.

Progress as at 18 July 2026:

- P6-2J adds the deliberate contact handover that makes a protected lead actionable. Customers must complete a private phone and service address before requesting trades, remain anonymised through matching and quote review, and can release a snapshotted contact record only to the exact verified installer whose option they shortlisted. Other matches remain redacted and withdrawal removes future portal visibility with immutable audit history.
- P6-2K adds required structured property context, consented phone or tablet photo capture, R2-backed evidence and installer-owned arrival windows. Every customer-approved photo and document is shared with each active verified installer allocated to the exact enquiry for quoting guidance, while identity, contact details, exact location and private notes remain protected. Only the accepted connected installer can propose arrival windows or convert the platform lead into a CRM job.
- P6-2L adds a fourth customer choice to contact the accepted installer directly, revealing only business name, contact number, email and ABN with an admin-visible audit notification. Those four business fields are mandatory for new and updated trade profiles. A customer-selected window is materialised as an unassigned CRM appointment only when the accepted installer creates the CRM job; dispatch assignment continues through existing availability, overlap and revision checks, followed by a bounded customer preparation acknowledgement.
- P6-2M adds consent-aware revision-bound appointment delivery records for customer and installer email plus approval-gated SMS, with authenticated provider callbacks and administrator delivery health.
- P6-2N adds editable service-specific photo requests for direct-customer jobs. Installers can issue, replace and revoke a 30-day private link; customers complete clarity, relevance and private-information checks before signature-checked, metadata-stripped photos enter the exact job proof with request revision context.
- P6-2O adds business-owned photo-request templates with draft, published and archived states. Published versions are immutable, new requests keep an independently editable snapshot and source version, and privacy-safe usage plus controlled trade-feedback counts identify unclear or unused guidance without image analysis.
- P6-2P adds consent-aware direct-customer photo-request delivery with masked recipient previews, protected current-link recovery, bounded resend and expiry reminders, authenticated provider receipts and privacy-safe administrator health.

- Core trade entitlements now depend on approved verification and role rather than Stripe billing state or seat grants. Verified installers and wholesalers receive the role-appropriate CRM, marketplace, team, field, forms, purchasing, catalogue and handover tools at A$0.
- The dashboard, participation journey, platform overview and historical membership route now present the free verified model. No new paid checkout or paid referral reward is offered for core access, while existing subscribers retain a Stripe billing-portal path during transition.
- Marketplace opportunity cards expose structured quote controls to interested installers. Platform job conversion and installer arrival-window proposals remain locked until the household accepts that exact connected installer. Generic non-platform opportunities retain direct job conversion. Customer selection alone does not create an appointment; the accepted installer must convert the exact lead, after which dispatch assigns staff using the authoritative schedule checks.
- Executable contract coverage protects billing-independent verified access, marketplace-to-CRM conversion, duplicate prevention, protected location handling and dated site-visit creation.

### Build step 2: establish customers, sites, assets and the enquiry inbox

Progress as at 17 July 2026:

- P6-2A establishes owner-scoped customer contacts, service sites and site-contact assignments around the existing customer account. Each new account receives a primary contact and primary site, while the additive migration backfills the same structure for existing direct customers without duplicating the customer account.
- Service sites now keep their own address, access, parking and hazard instructions. Verified installers can create and edit multiple contacts and sites, assign service contacts and select the authoritative service site for a direct job.
- Existing direct jobs are linked to the migrated primary site. Protected marketplace jobs retain an empty customer and site link, broad service region and protected reference until the existing consent boundary authorises more detail.
- P6-2B remains responsible for the unified enquiry inbox and generic CSV or Excel import. Assets, commercial account settings and complete timelines remain later Build step 2 slices.

Customer and site records must support:

- A payer account with multiple sites and contacts.
- Payment terms, pricing tier, tax treatment, account codes, lead source and custom fields.
- Site access instructions, parking, hazards, keys, photos and service contacts.
- Installed assets with make, model, serial, install date, warranty, manuals, photos and service interval.
- A complete timeline of enquiries, calls, email, SMS, marketplace messages, quotes, appointments, jobs, invoices, payments and files.
- Customer-specific rates and contract pricing.

The enquiry inbox must capture:

- TLink marketplace requests.
- Hosted and embeddable web forms.
- Dedicated enquiry email.
- SMS and manual phone entry.
- QR code, referral and public API sources.
- Customer or company, contacts, service site, category, description, urgency, preferred date, budget, source, photos and files.

Use these enquiry states:

`New -> contacted -> site visit -> quote required -> quoted -> booked -> won or lost`

Every enquiry card must provide `Call`, `SMS`, `Email`, `Request information`, `Create quote`, `Book`, `Create job`, `Assign`, `Follow up` and `Decline` actions.

Automate:

- Customer and site matching or creation.
- Duplicate detection by phone, email, business number and address.
- Response-time tracking and follow-up reminders.
- Attachment and conversation transfer into the resulting quote or job.
- Source, response, conversion and revenue attribution.

Generic import scope for this step:

- Accept CSV and Excel files.
- Provide downloadable templates for customers, contacts, sites, assets, products, price-book items, open jobs and open invoices.
- Include column mapping, preview, validation, duplicate handling, error export, reconciliation totals and rollback.
- Preserve an optional external record ID for audit and later reconciliation.
- Do not add competitor-specific formats or migration logic.

Acceptance criteria:

- A trade can import ordinary CSV or Excel data without engineering assistance.
- An enquiry converts without losing fields, files, conversation or source history.
- One customer can own multiple sites, contacts and assets.

### Build step 3: price book, job packets, quotes and online acceptance

Price-book items must support:

- Labour, material, equipment, subcontractor, travel, call-out, disposal, rebate, discount, non-billable and one-off types.
- Supplier cost, sell price, GST and tax code, markup, margin, expected duration, required skill, supplier and supplier SKU.
- Customer-specific price tiers and contract rates.

Reusable job packets must combine:

- Labour and materials.
- Default quantities and margin.
- Estimated duration.
- Tasks and checklists.
- Required forms and certificates.
- Skills and suggested crew.
- Asset type and service reminder.

The quote builder must provide:

- Sections and headings.
- Good, better and best packages.
- Optional add-ons and choose-one groups.
- Customer-facing totals that update when options change.
- Item, section and document-level markup, margin, discount and tax.
- Internal cost and margin visible only to authorised roles.
- Photos, diagrams, warranty information, terms, exclusions and expiry.
- Deposit and milestone requirements.
- Templates that preserve all options, job phases, tasks, forms, materials and estimated duration.
- Autosaved drafts, immutable published revisions, clone-and-revise and PDF output.
- Email and SMS delivery with viewed, questioned, accepted, declined, signed and deposit-paid events.

The customer flow is:

`View -> choose options -> ask question -> accept or decline -> sign -> pay deposit`

On acceptance, automatically:

- Lock the accepted revision.
- Create the job, phases, tasks and required forms.
- Create material requirements and reserve available stock.
- Draft purchase orders for shortages.
- Create the deposit invoice.
- Create an unscheduled appointment using the estimated duration.
- Create any required asset records.
- Carry every file, note, exclusion and customer message into the job.
- Notify the office and assigned estimator.

Support three estimate outcomes:

- Perform now: start the work and carry the accepted scope to the invoice.
- Perform later: create the sold job and place it in the scheduling queue.
- Not sold: create a follow-up opportunity with reason and reminder.

Acceptance criteria:

- A standard itemised quote can be sent in under five minutes from an existing job packet.
- A customer can accept, sign and pay a deposit in under one minute without creating an account.
- The accepted scope reaches job delivery, purchasing and invoicing without copying or re-entry.

### Build step 4: visual scheduler and dispatch

Deliver:

- Day, week and month calendar views.
- Rows grouped by technician or crew and colour-coded by job type or status.
- `Unscheduled`, `Assigned but unscheduled`, `Needs return visit` and `Overdue` trays.
- Drag-and-drop scheduling, duration resize and one-action reassignment.
- Multiple appointments per job or phase and multiple workers per appointment.
- Skills, licences, availability, shifts, leave, location, travel time and conflict checks.
- Map view, route order and realistic ETA.
- Recurring appointments and two-way Google and Microsoft calendar sync.
- Worker push notifications and customer confirmation, reminder and on-my-way messages.

Use these appointment states:

`Unscheduled -> scheduled -> dispatched -> en route -> arrived -> paused -> completed or return required`

Acceptance criteria:

- An unscheduled job can be assigned and timed in one drag operation.
- The dispatcher sees conflicts before saving.
- The assigned worker receives the complete job through the existing secure sync contract.
- The customer receives confirmation, reminder and ETA messages from the same appointment record.

### Build step 5: complete the offline field workflow

Arrive flow:

- Call customer and navigate to the site.
- Display access instructions, hazards, prior work and asset history.
- Provide large `Dispatch`, `En route`, `Arrive`, `Pause` and `Complete` actions.
- Record travel, work, break and crew time automatically while retaining manual correction with audit history.
- Generate a source-linked pre-job brief.

Work flow:

- Tasks, checklists, notes, voice notes, photos, annotated photos and video.
- Materials from barcode, catalogue, job packet, recent items or free text.
- Van or warehouse stock consumption and return.
- Purchase-order creation and purchase-receipt capture.
- Forms, certificates, JSA, SWMS, hazards and mitigations.
- Equipment nameplate scan into an asset record.
- Variation and onsite quote creation with customer approval.
- Customer and team messaging.

Complete flow:

- Stop and review time.
- Review materials, purchases and unbilled charges.
- Record return work and create the return appointment requirement.
- Explain and link directly to any missing mandatory task, form or certificate.
- Capture customer signature.
- Generate an immutable service report from work evidence.
- Create or send the invoice and accept onsite payment.
- Create a service reminder and request a verified review.

Offline requirements:

- Create and edit jobs, time, materials, forms, signatures, photos, variations, quotes and invoices without a connection.
- Queue writes with stable client action IDs and preserve the existing conflict, replay, encryption, revocation and cache-expiry controls.
- Show per-job sync state and make conflicts resolvable without discarding field work.

Acceptance criteria:

- A technician can complete the entire normal service call offline.
- Reconnection safely synchronises all actions and evidence once.
- Required safety or completion records block completion with an actionable explanation.
- No office user has to re-enter field time, materials, signatures or documents.

### Build step 6: phases, job costing, purchasing and inventory

Use one continuous financial chain:

`Quote line -> material requirement -> stock reservation or purchase order -> receipt -> supplier bill -> job cost -> customer invoice`

Track by job and phase:

- Estimated, committed and actual labour.
- Estimated, committed and actual materials.
- Equipment, subcontractor and overhead cost.
- Approved and unapproved variations.
- Invoiced and uninvoiced revenue.
- Gross profit, margin and budget variance.

Purchasing must support:

- Purchase order from a job, quote section, job packet or low-stock alert.
- Delivery or branch pickup, expected date, partial receipt and backorder.
- Returns and approval thresholds.
- Supplier-invoice capture from email, PDF upload or mobile photo.
- OCR line items with supplier, PO, receipt, job and phase matching.
- Quantity and price discrepancy queue.
- Split supplier bills across jobs or phases.

Inventory must support:

- Warehouses, vans and bin locations.
- On-hand, reserved, available, consumed, returned and damaged quantities.
- Minimum and maximum levels, transfers, stocktakes and reorder suggestions.
- Barcode receiving, transfer and consumption.
- Serialised equipment.

Acceptance criteria:

- Accepted quote materials become requirements without re-entry.
- Every stock issue, PO receipt and supplier bill changes actual job cost.
- The trade sees quoted, committed, actual, invoiced, profit and margin values while the job is active.
- Price or quantity discrepancies are explicit exceptions rather than silent cost changes.

### Build step 7: itemised invoices, payments and accounting

Support:

- Fixed quote, time-and-material, deposit, percentage, progress, milestone, phase and final invoices.
- Retention, credit notes, part payments, payment allocation, refund, statement and ageing.
- Clean customer-facing summaries without losing detailed internal cost records.
- Draft preview and role-based approval.
- Email and SMS delivery, online invoice, scheduled reminders, card, tap-to-pay and manual payment.
- Explicit consent for card-on-file and optional configured surcharges.
- Guided correct, credit or void, revise and reissue flow with complete history.

Accounting sync must exchange itemised records rather than aggregate job totals:

- Customers and suppliers.
- Products and services.
- Tax and account codes.
- Sales invoices and credits.
- Supplier bills.
- Payments, refunds and allocations.
- Sync state, errors, retries and external identifiers.

Continue Xero and MYOB, add QuickBooks, and prevent duplicate accounting records during reconnect or replay.

Acceptance criteria:

- Booking or accepted scope creates the correct draft invoice state automatically.
- Field time, material, PO and supplier-bill information reaches the invoice without re-entry.
- A customer can pay from the invoice link or in the field.
- Payment state reconciles back to the job and accounting provider.

### Build step 8: unified communications, customer portal and marketplace loop

Create one conversation timeline that automatically links:

- Marketplace chat.
- Email and SMS.
- Call notes and permitted call recordings.
- Quote questions.
- Appointment messages.
- Files, customer-visible notes and internal notes.

Provide a magic-link customer portal that allows the customer to:

- Request work.
- Book or reschedule.
- Approve quote options, sign and pay a deposit.
- View appointments and technician ETA.
- Message the trade.
- View photos, service reports, forms, certificates and warranties.
- View and pay invoices.
- See assets and service history.
- Rebook, request another job and leave a verified review.

Build the marketplace growth loop into normal trade work:

- Every quote, booking, invoice and handover uses the TLink customer experience.
- Completed jobs can produce a verified project, asset and review record subject to customer consent and existing privacy controls.
- The customer can request future work through the portal without the original trade losing ownership of their customer relationship.
- New marketplace demand returns to the same lead inbox used for a trade's direct enquiries.

Acceptance criteria:

- Customers do not need an account for ordinary quote, booking and payment actions.
- All communication appears on the correct customer, site and job timeline automatically.
- A completed direct-trade job creates a safe path for that customer to use TLink again.

### Build step 9: recurring work, asset lifecycle and service agreements

Support:

- Residential service memberships and commercial service agreements as distinct contract types.
- Covered customers, sites, assets, work types and exclusions.
- Service levels, response times, not-to-exceed limits and contract rates.
- Visit frequency, crew, duration, checklist, forms, materials and billing schedule.
- Automatic recurring job creation without duplicates.
- Automatic scheduling or placement into the unscheduled queue.
- Recurring invoices, renewal notices and expiry handling.
- Asset make, model, serial, installation, warranty, manuals, readings, photos and full service history.
- QR or barcode access to the asset in the field app.
- Safety notices, warranty expiry and service-due reminders.

A service reminder must create a prefilled job ready for review, not only send an email.

Acceptance criteria:

- A due service creates exactly one correctly scoped job.
- The technician sees the asset and complete service history offline.
- Completion updates asset history and calculates the next due event.

### Build step 10: embedded AI, public API, webhooks and MCP

Do not add a generic chatbot as the primary AI interface. Add AI to existing workflow actions:

- Phone call, email, SMS or marketplace message -> structured enquiry draft.
- Voice note -> job note, time entry, materials and follow-up tasks.
- Work-order PDF -> customer, site and job draft.
- Equipment nameplate photo -> asset fields and suggested service schedule.
- Supplier invoice or receipt -> line items and PO, receipt, job and phase match.
- Job description -> suggested job packet, duration, skills, materials and quote draft.
- Similar completed jobs -> price and duration suggestions.
- Assigned job -> source-linked pre-job brief.
- Completed work -> customer service report draft.
- Missing time, missing material, uninvoiced cost and margin-risk detection.
- Skill, location, duration and availability -> schedule recommendation.

AI safety requirements:

- Ground prices and durations in the trade's authoritative price book and completed work.
- Show source records and confidence where extraction or matching is uncertain.
- Require human confirmation before sending a quote, ordering materials, changing a schedule, issuing an invoice or taking payment.
- Record every accepted AI change in the normal audit history.
- Keep the AI provider replaceable behind typed tool and model interfaces.

Open-platform requirements:

- Scoped API keys and OAuth-ready application access.
- Versioned REST endpoints and documented webhooks for customers, enquiries, quotes, jobs, appointments, stock, purchasing, invoices and payments.
- Idempotency keys, cursor pagination, rate limits and audit logs.
- A permission-aware MCP server over the same typed application services, not a separate source of truth.

Use the current [Fergus MCP surface](https://help.fergus.com/en/articles/15439294-what-is-the-fergus-mcp-server), [Simpro Lightning](https://www.simprogroup.com/lightning) and [ServiceTitan Field Pro](https://help.servicetitan.com/docs/field-pro) as minimum competitive references.

Acceptance criteria:

- Every AI-created record is a reviewable draft unless the action is explicitly low risk and reversible.
- API, webhook, web, mobile and MCP operations use the same validation, permissions and audit services.
- Replacing the model provider does not require rewriting trade workflow logic.

### Build step 11: enterprise controls, integrations and exception-led reporting

The calendar, communications, accounting and payment connectors required by earlier workflow steps ship with those steps. This step completes their shared administration, adds the remaining connectors and exposes the advanced organisation controls.

Provide these controls without placing them in the default sole-trader flow:

- Multiple branches, business units and cost centres.
- Owner, administrator, dispatcher, estimator, supervisor, technician, apprentice, subcontractor and accountant roles.
- Granular action and financial-visibility permissions.
- Skills, licences, shifts, leave, labour cost and billing rates.
- Approval thresholds for discounts, quotes, purchase orders, variations, invoices and credits.
- Mandatory forms and certificates by job type or phase.
- Immutable audit log for financial, schedule, status, permission and communication changes.
- Custom fields, statuses, saved views and exports.
- Single sign-on readiness.

Add integrations for:

- Google and Microsoft email and calendars.
- SMS and telephony providers.
- Xero, MYOB and QuickBooks.
- Stripe, Square and onsite payment hardware.
- Zapier and Make.
- Supplier catalogue, price and availability feeds.
- Payroll exports through documented adapters rather than built-in payroll.

Prioritise exception views over vanity dashboards:

- Unassigned or overdue work.
- Late arrivals and route conflicts.
- Missing time, materials, forms or certificates.
- Unmatched supplier invoices and PO discrepancies.
- Margin leakage and budget overruns.
- Completed but uninvoiced work.
- Overdue customer payments.
- Quote conversion by source, estimator and job type.
- Technician utilisation and callback rate.
- Branch and business-unit performance when those controls are enabled.

Acceptance criteria:

- A sole trader sees none of the enterprise configuration unless they enable it.
- A larger organisation can enforce roles, approvals, branch separation and audit requirements on the same product.
- Every operational dashboard item links to the record and action required to resolve it.

## Trade-platform release gate

Do not market Direct Trade as a replacement for an incumbent trade-management system until all of these conditions pass:

- A verified trade joins without a card or subscription.
- Generic CSV or Excel import supports mapping, preview, validation, duplicate handling, reconciliation and rollback.
- A first itemised quote can be sent in under five minutes.
- A customer can accept, sign and pay a deposit without creating an account.
- Quote acceptance creates the job, phases, material requirements, forms, unscheduled appointment and deposit invoice automatically.
- An unscheduled job can be assigned in one drag operation.
- A field worker can complete a normal job offline, including materials, forms, signature and invoice.
- Labour, materials, stock, purchase orders, receipts and supplier bills reconcile to job cost without duplicate entry.
- An itemised invoice and payment state synchronise with the connected accounting provider.
- Asset and service history update from completed work.
- The completed transaction gives the customer a consented path back into TLink.
- Unlimited users, leads, jobs and quotes remain A$0.
- Physical iOS and Android device acceptance, release signing and store distribution prerequisites are complete.

## Deferred until the core workflow passes

- Generic AI chat that does not complete a workflow action.
- Vanity dashboards without an actionable exception queue.
- Bespoke competitor migration formats.
- Built-in payroll.
- Fleet telematics.
- Broad marketing-attribution tooling.
- Franchise administration beyond the branch and role foundations.
- Bespoke report builders before the standard operational and financial reports are accurate.
- AI automation that lacks authoritative price, job, stock and cost data.
