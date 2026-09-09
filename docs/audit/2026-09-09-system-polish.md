# AEA and TLink system audit and polish

Prepared 9 September 2026. Repository baseline: `23464a47b5349f6f3316dbc52253c8dc55578fdd`, verified against GitHub main and live Sites version 554. Implementation branch: `codex/system-polish`.

## Decision

Keep the current architecture and make one dependable operating path: **enquiry → customer and site → quote → scheduled job → field evidence → review → invoice → service follow-up**. The product already contains much of this. Its largest problem is overlapping workflows and uneven maturity across a very broad feature set. Adding another dashboard, generic automation framework or catalogue will amplify that problem.

The work in this release removes the obsolete household account application, hardens public lead intake and electricity ranking, reduces shared styling, and fixes specific trade and mobile workflow defects. It is a substantial polish release, not evidence that every certificate program is submission-ready or that the system has passed an independent penetration test.

## Execution command derived from the brief

Act as the accountable senior engineer and product maintainer for AEA and TLink. Establish the exact live source and isolate the work. Audit the real public, trade, field and compliance workflows against current primary-source competitor documentation. Identify duplicated or unused code, misleading calculations, security boundary defects and avoidable user steps. Remove the obsolete customer self-service application and route households through existing consented account-free enquiries, preserving trade CRM records, secure quote links and evidence controls. Implement the highest-confidence improvements directly using existing architecture and dependencies. Record strengths, limitations and a prioritised roadmap with measurable acceptance criteria. Validate changed behaviour and shared security boundaries, commit only this work, push the exact source to GitHub, publish its matching Sites artifact, and publish compatible field-app changes through the existing preview channel. Report verified outcomes and remaining limits precisely. Never invent program eligibility, certificate formulas, successful delivery or live-device results.

## Current features, strengths and weaknesses

| Area | Existing strength | Main weakness | Decision |
| --- | --- | --- | --- |
| Household acquisition | Public planner, Wattzun guidance, electricity/gas comparison and consented trade enquiries | Duplicate account/project pathways added friction and a second lifecycle | Retire household accounts; reuse the existing enquiry form |
| CRM and sales | Customer/site records, scoped leads, quotes, secure acceptance, immutable PDFs and invoice linkage | Broad workspaces make the next action harder to find; legacy platform quotes used account links | Make customer lookup and search dependable; suppress retired customer-account notifications |
| Daily operations | My Day, calendar/dispatch, staff permissions, reusable customer/site job creation | Search races and polling can misrepresent results or do unnecessary work | Match results to the current query, display timeouts, avoid duplicate/hidden-tab polling |
| Field app | Offline jobs, tasks, evidence, sync and completion blockers | Assigned undated work disappears from a day-only view; appointment dates were inconsistent | Add an Unscheduled section and use one effective appointment time |
| Service follow-ups | Asset schedules, assignments, revision checks, audit events and delivery receipts | Legacy reminder sending depended on removed customer-account preferences | Retain follow-up tracking and read-only history; retire its reminder sender |
| Energy comparisons | Server-side retailer retrieval, interval profiles, tariff audit breakdowns | Partial seasons, expired cached plans and unsupported solar credits could produce misleading rankings | Reject unsupported annual prices; recheck availability when serving cached data |
| Compliance | Program/activity registry, formula coverage, evidence, reviewer and output-action controls | Catalogue breadth can be confused with working accredited submission coverage | Use per-activity readiness as the product boundary; finish a governed submission path before expansion |
| Security | Firebase token issuer/audience/algorithm checks, reviewed ABNs, role and owner scopes, consent and rate limits | Public lead body size was measured after text decoding; removed account routes still expanded attack surface | Bound UTF-8 bytes while streaming and close retired API families |
| Maintainability | Typed boundaries, shared server utilities, migration history and extensive tests | Large components, shared CSS and many brittle source-text assertions | Delete obsolete implementations; retain domain tests and add executable boundary regressions |

## Competitor benchmark

These are documented product capabilities, not hands-on benchmark measurements or proof of their internal security.

| Product | Useful standard to meet | Application to TLink |
| --- | --- | --- |
| [ServiceM8](https://www.servicem8.com/feature-overview) | A job card that brings scheduling, forms, photos and communication together | Keep the job as the main field workspace. [Actionable checklists](https://support.servicem8.com/help-center/desktop/faq/how-to-create-and-use-checklists) are more useful than another menu. Its [Android Lite boundary](https://support.servicem8.com/help-center/app/basics/about-the-servicem8-android-app-servicem8-lite) also supports making our Android workflow a deliberate product priority. |
| [Tradify](https://www.tradifyhq.com/au/features/customer-enquiry-software-app) | Enquiries carry through customer, quote and job records; [job tracking](https://www.tradifyhq.com/au/features/job-tracking-software) makes progress visible | Capture details once, preserve the source enquiry, and expose the next action and financial state on the same job. |
| [JACK](https://jackapp.io/features) | Builder-focused estimates, contracts, project costs and progress claims, with [safety workflows](https://jackapp.io/features/safety) | Adopt its clear commercial lifecycle where relevant. Avoid importing builder-only complexity into small trade jobs. |
| [Simpro](https://www.simprogroup.com/features) | Asset/service operations and [digital forms](https://www.simprogroup.com/features/digital-forms) suited to field work | Build evidence from the assigned activity and known job data; make required information and review blockers visible before a technician leaves site. |

TLink's strongest potential differentiator is the connection between household energy needs, local trade work and evidence-backed program delivery. Generic forms alone do not demonstrate government-program compliance in any product.

## Implemented in this release

1. Removed the customer dashboard and its exclusive account, asset, appointment, quote, photo, history and dialog code. Old account pages redirect to the planner; nine customer API families return HTTP 410. The shared evidence download route retains trade authorisation, exact allocation, consent and audit checks. Household enquiries and planner PDFs remain available without an account.
2. Removed the account navigation and old account-oriented handoffs. Suppressed queued and retried customer-account activity emails. Removed legacy service-reminder preparation/send/retry; follow-up assignments, notes, due dates, suppression, completion and historical receipts remain available.
3. Replaced character-count request limits with a shared bounded stream reader on public lead routes. A 60,041-character UTF-8 fixture previously exceeded the 64 KiB byte boundary; the new reader rejects excessive bytes before allocating the complete decoded body and rejects malformed UTF-8.
4. Electricity ranking now rejects incomplete/overlapping annual tariff seasons, expired/future/malformed availability, stepped/capped or ambiguous solar credits, and invalid/missing solar time windows. Supported flat and measured time-varying cases retain reconciled audit totals. Exclusion is explicit until the relevant tariff model is supported.
5. TLink search hides results from previous queries and reports timeout failures. Released lead contacts can be found by name, email or phone inside the already-authorised inbox. Notifications use one request at a time, pause in hidden tabs and abort on cleanup.
6. The field schedule uses appointment time before its fallback schedule time, skips invalid timestamps and exposes open undated assignments below the selected day.
7. Moved approximately 36 KiB of admin-only source CSS behind its existing admin import boundary. Removed approximately 109 KiB of obsolete customer selectors from shared styles. No new dependency or framework was added. Deleted exclusively obsolete UI tests while preserving shared schema, consent, scope, calculation and delivery invariants; added executable retirement and input-boundary tests.
8. Applied compatible security patches for Next (16.3.4), its aligned lint configuration and fflate (0.7.5), and refreshed affected transitive lockfile resolutions. The ZIP64 fix matters to document and spreadsheet imports. Added a small Expo Metro configuration so independently installed mobile builds can resolve the existing shared domain logic and activity data; Android export now succeeds from a clean isolated checkout.

## Dependency-security boundary

The initial production dependency audit reported eight affected packages, including a critical Next advisory. After compatible patches, `npm audit --omit=dev` reports zero critical and two high entries, the related `image-size` and Vinext entries described below. The release patches [Next](https://github.com/advisories/GHSA-p293-qw3h-jr36) and [fflate ZIP parsing](https://github.com/advisories/GHSA-px8p-9vwx-vf98). Audit severity is a dependency signal, not proof of exploitability in the deployed Vinext Worker.

The remaining `image-size` 2.0.2 / Vinext dependency advisory has no published image-size patch as of this audit. Its [ICNS parser](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [HEIF/JXL parsers](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) can loop on malicious input. This installed Vinext version uses it for repository static/metadata image dimensions during builds; no application upload handler imports it. Keep uploaded content out of those build inputs. The compatible fix is not a fictional override or a forced framework-beta migration. This remains a documented build-input risk pending a reviewed framework update.

## Calculation evidence and limitations

The January-only regression fixture priced an annual 4,000 kWh profile at about $127.52 because only January's supply and usage were counted. The same all-year $1/day supply plus 25c/kWh ex-GST contract totals $1,501.50. The partial contract must not compete as an annual quote.

A 12c solar credit capped at 5 kWh/day, followed by 2c, applied to 10 kWh/day exports is $255.50/year. Applying the first rate to every export produces $438, an overstatement of $182.50. This release excludes that unsupported structure from the native ranking. Tariff structures follow the [Australian Consumer Data Standards](https://consumerdatastandardsaustralia.github.io/standards/#tocSenergyplansolarfeedintariffv3). Tariff eligibility, fees and retailer terms still require explicit attention; the ranking is an estimate, not a savings guarantee.

The compatibility electricity comparator is retained under the existing rollback contract. It uses the same browser-loadable pure tariff guards as the native engine and server. Recomputing a rejected legacy offer removes its old total. Focused regression cases cover these shared boundaries; they do not prove complete behavioural parity for every legacy interaction.

## Government-program coverage

The source catalogue contains **35 programs and 216 activities**. Its calculation coverage is **56 executable estimates and 160 non-executable activities**. The executable set spans SRES (2), VEU (27), NSW ESS (3), PDRS (4) and other/local pathways (20). These are source catalogue counts, not active customers, accredited processes, lodged certificates or proof that 56 activities can be submitted. Operational readiness also depends on database-backed governance and evidence decisions.

Keep different regimes explicit. [SRES](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems), [battery eligibility](https://www.dcceew.gov.au/energy/programs/cheaper-home-batteries/eligibility-information), [VEU accreditation](https://www.veu-registry.vic.gov.au/register-accredited-persons) and [NSW schemes](https://www.energysustainabilityschemes.nsw.gov.au/schemes) have distinct authorities and requirements. [ACT EEIS](https://www.climatechoices.act.gov.au/policy-programs/energy-efficiency-improvement-scheme) and [SA REPS](https://www.escosa.sa.gov.au/industry/reps/bulletins/technical-bulletins) are retailer-obligation settings; do not label every pathway as the same tradable-certificate process.

## Ordered next work and acceptance gates

| Priority | Work | Completion evidence |
| --- | --- | --- |
| 1 | Complete one high-volume provider-approved activity from enquiry to reviewed export/submission | Versioned official rules, accredited party and eligibility checks; mandatory evidence; deterministic calculation; independent reviewer approval; provider-accepted output and receipt; negative/revocation tests. Select the actual pilot with the provider. |
| 2 | Show activity readiness using the existing governance projection | Separate estimate, field capture, export and submission readiness; show exact blockers and source-review date. No green badge inferred from catalogue presence. |
| 3 | Make the job the daily operating workspace | One next action, outstanding evidence, quote/payment state and clear owner. Measure time from enquiry to quote, reassignment steps, evidence rework and completed-to-invoiced delay with consented, non-content telemetry. Establish a baseline before promising improvements. |
| 4 | Remove repeated access reads within a request and reduce unnecessary activity writes | Trace actual queries, reuse the existing owner projection for that request, condition timestamp updates, and retain immediate cross-request revocation. Compare query counts and p95 latency using the same workload. |
| 5 | Replace brittle implementation-text checks as touched; trim large protected modules incrementally | Behavioural regressions cover authorisation, state changes and failures. Bundle and route budgets remain enforced. Split components only along an existing workflow boundary. |
| Pilot prerequisite | Validate field recovery under real working conditions | Before activity-pilot acceptance, exercise offline capture, interruption/restart, retry, conflict handling and large evidence sync on the supported Android build. Preserve every saved item and block completion until required evidence is durable. |

## Data and release boundaries

Customer self-service is removed from the running application. Existing database rows, historical migrations, evidence and shared Firebase identities are not physically erased by this change. Trade and staff authentication uses the same Firebase project; an indiscriminate identity purge would affect those surfaces. Historical account rows do not restore retired self-service APIs. No live lead emails, SMS, certificate submissions or external customer messages are sent as part of verification.

The full source test run passed 4,047 tests with 11 intentional skips under the existing Node 22 runtime using `--no-opt` to avoid a local V8 optimisation crash. Node 24 was suitable for typechecking/lint but its newer SQLite engine produces seven fixture/index-plan differences in unchanged Creditex tests; the same cases pass on Node 22. The mobile package passed typecheck, lint and all 91 tests, and Android export succeeded.

Root typecheck and warning-free lint passed, along with the source approvals/custody and assessor-education audits, continuity rehearsal, migration check, planner PDF audit and publication build. The final server audit verified all 172 migrations; public performance budgets passed with 346,198 bytes of root-layout CSS and a 14,640,725-byte eager Worker graph. Shared source styles decreased by 143,878 bytes in total, including admin rules relocated to their existing protected boundary. These are code/build measurements, not measured user latency or Core Web Vitals.

The release task records subsequent deployment identities and affected HTTP/provenance checks. Browser visual review, a signed-in trade journey and a physical-device update are separate evidence and must not be claimed from HTTP or source tests.
