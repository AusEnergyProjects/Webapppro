# TLink council workspace

Implementation checkout: `C:\Webproject\aea-energy-council-community`, branch `codex/council-community`.
Built from live Sites version 758 source `c1af563504b26f76ba895fc9b72d80f8565b3f43` on 5 October 2026. The older council-portal checkout is preserved and is not the release base. The user has authorised matching GitHub and Sites publication; exact publication identity and live account checks are recorded in `C:/Webproject/outputs/tlink-portals-release.md` after deployment.

## Routes and access

- `/council`: verified Firebase sign-in and council invitation activation. Existing operations administrators with required MFA can provision councils.
- `/council/demo`: interactive fictional council profile, TLink outcomes, campaign/session editing and practice team controls. Official public community data is labelled separately.
- `/council/program/[code]`: published campaign landing page and explicit referral capture.
- `/api/council/*`: tenant-scoped membership checks, no-store responses, origin checks for mutations. Owner/editor/viewer permissions and atomic audit guards apply to writes. Team owners create email-bound invitations and share the council sign-in link; the workflow does not send invitation emails automatically.
- Migrations `0250_council_workspace.sql` and `0251_council_profile.sql` follow the current 0249 migration. The shared current ABN predicate is extracted unchanged into `trade-account-predicates.ts`.
- Public TLink entry defaults to TLink trades. The Dashboard selector on all four sign-in screens and signed-in headers links to trades, Admin, Creditex and Council. Authenticated availability is a read-only navigation hint; each destination enforces its existing permissions, verified identity and applicable MFA. Switching preserves the current trade business and protects unsaved audit/profile changes. It does not create memberships or change roles.
- New business registration supports trades only. Existing supplier records remain editable; the API rejects new supplier accounts and partner-type conversion. No existing account data is deleted.
- Council access for the existing support email is provisioned through the audited Admin council workflow, with a verified email-bound membership. There is no hard-coded email bypass or separate password.

Production owner access for `info@ausenergyassessments.com` was provisioned through that workflow on 5 October 2026, in the internal `TLink Council Preview` workspace covering 3805, 3806, 3977 and 3980. Its real authenticated dashboard opened successfully. This name does not represent a real council affiliation.

## Reporting boundaries

The workspace keeps three independent views: official community activity, recorded TLink participation, and explicitly tagged council campaign referrals. They are not added together. An enquiry carrying a campaign reference establishes attribution, not causal additionality. Registered businesses and completed upgrades do not measure employment created.

Council profiles retain name, logo, state, approved postcodes and colours. Day/night mode uses the existing TLink device preference. Postcode edits change the reporting area, not official municipal boundaries. Approved local business names, suburbs, postcodes and capabilities automatically appear in the council directory. Private street addresses, contacts, customer details and internal account identifiers do not.

TLink completed-work reporting uses supported job completion, net issued invoice value and immutable reviewed provider-acceptance evidence. Small customer cohorts and complementary breakdowns are protected. All-area enquiries are separately aggregated from active, nonwithdrawn public lead releases, excluding synthetic and private trade-created records. Monthly buckets use Australian local midnight including daylight saving. Contact keys are used only inside SQL for cohort protection and never returned.

## Official sources

### Victorian Energy Upgrades

Source: <https://veu.esc.vic.gov.au/vpr/s/public-registry>.

The adapter reuses the bounded public-registry session transport and verifies the report model, schema, locked `Approved` activity filter and activity/postcode measures. Aggregates reconcile to the source grand total; incomplete or changed responses fail closed. Queries use activity dates with calendar quarter, year or all-history scope. Decimal reported quantities are retained.

The main metric is estimated lifetime tonnes CO2-e based on the source's reported VEEC equivalent quantity. This is not measured annual emissions and approved activities do not prove registered certificate issuance. Public installer locality is unavailable.

Request-triggered checks use a one-day cache interval and bounded upstream deadline. Last-good data retains its source date and failure state. This is not a scheduled archive or a claim of continuously live installation reporting. The saved demo contains actual aggregates for 3805, 3806, 3977 and 3980, captured 5 October 2026, source refreshed 4 October 2026 Melbourne time. Other postcodes remain unavailable in that demo snapshot. Production authenticated queries support the current council scope.

### Clean Energy Regulator

Source: <https://cer.gov.au/markets/reports-and-data/small-scale-installation-postcode-data>.

Six official postcode datasets cover solar systems, solar capacity, heat pump water heaters, solar hot water, batteries and usable battery capacity. The retained publication is through 31 August 2026. Certificate quantities and installer locality are not published in these files. Installation counts are not unique homes; recent months can be revised. Storage starts July 2025.

The selector uses the latest 3 or 12 published months, or all published history, rather than implying current calendar coverage. All six files must validate together; missing cells remain unavailable. Bounded refresh checks run on request at most every 12 hours per cache location. The regional cache is evictable; this is not a durable daily archive. The demo reads the retained server-side official snapshot without upstream requests. `scripts/capture-council-community.mjs` refreshes the retained baseline explicitly.

CER cards and monthly charts show recorded subtotals with explicit postcode coverage when part of the selected area has no published figures. A missing postcode no longer hides the observations from the rest of the area. The API retains strict full-area `totals` and per-postcode nulls, alongside `reportedTotals`; monthly points carry strict `values`, `reportedValues` and metric-specific coverage. No observations remains unavailable, while a published zero remains zero. Compact and detailed views identify missing postcodes, and CSV exports distinguish recorded subtotals from full-area totals and include coverage. The 73-postcode production scope exposed this case because postcode 3920 is absent from all six retained CER files.

### Solar Victoria

Source: <https://www.solar.vic.gov.au/solar-homes-program-reporting>.

Verified public installations workbook: <https://www.solar.vic.gov.au/sites/default/files/2026-07/Solar-Victoria-installations-by-LGA-June-2026.xlsx>.

This is council/LGA data, not a postcode series. The workspace links the source and does not invent postcode rebate figures or add overlapping rebate counts to CER/VEU outcomes. A future LGA integration needs a verified council-to-LGA mapping; council display names or postcodes are insufficient.

## Demonstration and reports

- Map: defaults to usable public approved activities, with explicit choices for TLink heat, lifetime impact, solar, batteries and hot-water installations. Official ABS Postal Areas 2021 define shaded postcode regions on a shared blue-to-red scale, with clear outlines and numeric ranges for each colour band. Positive values are grouped by quintiles across all reporting postcodes; tied thresholds collapse, zeros remain blue and missing values remain grey. This makes skewed totals readable without changing the underlying values or recolouring when the map is panned. The bundled CC BY 4.0 geometry is simplified for display and loaded only for required postcode prefixes. Postal Areas approximate postcodes, not council or exact Australia Post delivery boundaries. A postcode without a published polygon retains its approximate centre marker. Compact labels show the postcode; selection, hover or keyboard focus reveals the full map value. Clicking a region or label opens its VEU totals and activity types, six CER installation/capacity measures and separate protected TLink results, with each source period retained. Drag the map or a postcode label to pan; clicks still open the postcode breakdown. Google camera events update overlays without writing stale positions back into the basemap. Scroll, Ctrl-wheel and trackpad wheel-pinch over the map zoom the map around the pointer without changing browser zoom; Google touch gestures, buttons and keyboard controls remain available. Search local trades or the paginated postcode table, select an area to focus the map, and toggle trade pins, heat and reporting postcodes. Pins never use private addresses.
- Profile: sample/uploaded logo, editable identity/postcodes, presets or custom colours, persistent header and day/night mode. Profile and campaign practice changes persist locally; team practice changes last for the current page visit.
- Calculator: existing governed rebate calculator embedded with Victorian defaults. Product calculations retain their existing register requirements; calculator results never change reporting totals.
- Exports: separate CSVs for TLink, official installations and public upgrade impact, with dates, scope, definitions and source evidence. The Reports view supports browser print/PDF. Printed reports expand source definitions, preserve stale-data notices, fit all 12 monthly chart values and use flowing pagination.

## Validation and release

Validation evidence is retained under `C:\Webproject\outputs\council-*`:

- `npm.cmd test`: 9,016 passed, 11 skipped, zero failures (9,027 tests). The final launcher extraction and demo postcode-limit fix were subsequently covered by the focused checks below.
- `node --experimental-strip-types --test test/council-*.test.mjs`: 148 passed, zero failures. Both public demo endpoints accept the same maximum of 100 recognized Victorian postcodes as profiles; 101 is rejected before reading the snapshot.
- Widget/privacy focused checks: 43 passed, including launcher persistence, storage-event sync, open/hide and cleanup.
- `npm.cmd run test:integration`: 37 passed, zero failures.
- `npm.cmd run typecheck` and ESLint over all changed TypeScript/JavaScript files: passed.
- `npm.cmd run db:check`: all 251 migrations passed. Source custody, assessor education, conversation quality, community responses, continuity rehearsal and customer-plan PDF audits also passed.
- `npm.cmd run build`: passed, including exact-migration server audit and unchanged public performance budgets. Wattzun route JavaScript is 346,738 bytes against a 347,000-byte limit. The council lazy entry and deferred public launcher avoid loading council features on public pages.
- Browser checks: official dataset totals and period selectors, map layers/trade search, logo/name/theme persistence, day/night, demo team invitation, real induction calculator, official CSV downloads, responsive 390px viewport and public launcher navigation. All six pages of the final A4 print/PDF were rendered and visually checked. Production council provisioning and authenticated live-tenant flows have not been exercised against the live database.

`npm.cmd run validate` has a pre-existing official-source approval failure, reproduced in the clean live-base checkout. All 36 evidence hashes match but their human review windows expired on 20 September or 1 October. The runtime excludes expired approvals; the council import graph does not depend on them. No approval was restamped or waived. This remains an unrelated audit failure and the scoped release receipt records it explicitly. The test-only mobile lint error was repaired by renaming a loader variable without changing assertions.

The shared ABN predicate extraction replaced the prior inline definition; affected test fixtures load that same authoritative implementation. Temporary comparison files were removed. No dependency versions or performance budgets were changed, and the old council checkout remains preserved.

The user's follow-up explicitly authorises Git and Sites publication and council access for `info@ausenergyassessments.com`. Production provisioning and authenticated live checks are only confirmed by the release receipt, not by local fixture tests.

The first live verification on Sites 759 found a production packaging defect: dynamic JSON imports still referenced absent source files, so both official-data endpoints returned 503 before loading their retained evidence. The correction lazily imports normal modules containing static JSON imports. The build audit now requires deferred emitted baseline modules and rejects the broken raw JSON paths. Both corrected public endpoints returned 200 in the actual built Cloudflare Worker; all 150 council tests passed. Corrective publication and live proof are recorded in the release receipt.

Trades, Admin, Creditex and Council now render the same full-width `TLinkWorkspaceBar`: business/council identity and welcome on the left, the dashboard selector at the right edge, and workspace management actions immediately before it. Responsive wrapping, theme colours and measured sticky offsets are shared; the replaced per-workspace selector rows were removed. Focused header, provider, selector and council checks passed 183/183.
