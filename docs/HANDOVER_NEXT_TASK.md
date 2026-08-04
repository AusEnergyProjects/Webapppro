# Next task handover

Status: `TRADE-DOCUMENT-CONTROLS-AND-JOBS-45` validated release candidate

Prepared: 5 August 2026

Milestone ID: `TRADE-DOCUMENT-CONTROLS-AND-JOBS-45`

Working branch: `codex/sites-custom-domain-migration`

Previous production application source: `fcfca482b0f86413423af2af8c5ae77054e6186f`

Primary TLink recovery source: `b7e40751e2556ffc64e37704c641a6e917046bb6`

Released application source: `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c`

Current production: Sites version 282 from application commit `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c`

Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_fd653b2ad83c81918fd23a3366735271`

Deployment: `appgdep_6a71e7f3af3c81918f0f89a3e0354d36`

Production URL: `https://compare.ausenergyassessments.com`

Internal compliance URL: `https://compare.ausenergyassessments.com/creditex/compliance`

Sites provider URL: `https://aea-energy-comparison.info294029.chatgpt.site`

Environment revision: 19

## Active milestone contract

Outcome: restore one job per row with each value in its Dataforce-aligned
column, then make customer quote and invoice documents use an explicit saved
business identity, full-width positioned banner, clear tax, discount and
payment details, and an accurate owner-visible document preview without
changing an already issued document.

Owning workflow:

- the owner-scoped Jobs register in `InstallerCrmWorkspace`;
- business document identity, banner framing, payment details and previews in
  `TradeBusinessSettingsWorkspace`, `trade-profile` and an additive migration;
- immutable quote snapshots and customer PDF rendering in the trade quote
  server, panel and PDF generator;
- quick invoice calculation, storage, delivery and owner/customer presentation
  in the existing invoice workflow;
- affected layout rules in `src/app/globals.css`.

In scope:

- restore separate Dataforce-aligned Jobs cells, one job per row, horizontal
  scrolling, callable mobile values, company scoping and matching CSV order;
- make the issued-PDF download action visually consistent with adjacent actions;
- save customer-facing business name, phone, email and bank payment details
  separately from the TLink identity used to sign in;
- provide a bounded banner focal-position and scale control whose preview
  matches the full-width PDF crop;
- snapshot saved document identity, banner framing and payment details into new
  quote and invoice versions so historical output remains immutable;
- show subtotal, discount, GST and total explicitly in invoice authoring,
  storage, customer delivery and the Business settings document preview;
- remove the redundant customer-facing `Work`, `Always included` and
  `Your base scope` labels while retaining itemised scope and internal margin
  controls.

Out of scope:

- sending another production quote or invoice during release verification;
- proving Gmail or Outlook inbox receipt;
- SMS or payment initiation;
- Firebase identity deletion, physical erasure or account recovery;
- regulator submission, certificate creation, certificate trade or settlement;
- changing the internal compliance portal, governed calculation authority or
  tenant boundary;
- uploading production branding or changing live customer, business, quote,
  case, certificate or evidence data during release verification.

Acceptance criteria:

- the Jobs register renders one record per row with values in their declared
  columns at desktop and mobile breakpoints;
- customer-document contact values are independently editable, validated and
  tenant-scoped without changing login identity;
- owner preview and generated quote PDF use the same full-width banner crop and
  customer-facing identity;
- invoice totals reconcile exactly as subtotal minus discount plus GST equals
  total, with saved payment details shown only when configured;
- issued quote content remains byte-stable and only a new issue or invoice
  revision can adopt changed branding or payment settings;
- focused tests, migration replay, complete validation, production build, Sites
  bundle audit and rendered-PDF inspection pass.

Stop condition: stop if an issued quote changes after issuance, totals do not
reconcile, internal margin or protected data reaches a customer document,
customer-document settings can cross tenant boundaries, the job export order no
longer matches the register, or verification would send a message or mutate
production business, quote or invoice data.

## Release result

Application source `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c` is live as
Sites version 282. It contains primary TLink recovery commit
`b7e40751e2556ffc64e37704c641a6e917046bb6` plus the worker-safe legacy fallback
correction. Sites version 281 from `b7e4075` was superseded during release QA
after a pre-existing rollback-route failure was found. No migration was added.

The signed-in Business workspace presents Account, Appearance, Service areas,
Quote defaults, Notifications, Templates and Close account on one scroll page.
Fourteen controlled themes now govern the header, search, rail, buttons,
workspace and customer documents. Safe partial profile updates preserve omitted
notification and availability values. Jobs use the available width, retain the
company-scoped Dataforce register and callable phone values, and Schedule keeps
the permanent CRM navigation.

Quote issuance preflights the exact PDF before creating the immutable review
link. PDF generation falls back to worker-safe standard fonts if bundled font
assets cannot be loaded. Existing issued review, PDF and media reads accept only
the active customer token or current verified trade owner; customer mutations
remain token-bound. Provider submission now records `provider_accepted`, not
inbox delivery. The existing retained closure, token-revocation and tenant
boundaries remain unchanged.

The lead route and authorised relay now share a 20-second downstream timeout and
the outer health check allows 25 seconds. The no-index electricity rollback
route no longer reads from the worker filesystem; it returns a no-store 307 to
the deployed legacy asset, whose HTML has an explicit no-index directive.

`npm.cmd run validate` passed on exact source `9c278bb`: type checking,
warning-free lint, 31 of 31 integration tests, 1,466 main tests with 1,464
passed, 2 intentionally skipped and 0 failed, all 121 migrations, the
customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
The TLink recovery-focused set passed 104 of 104 before the final fallback
correction, and the fallback set passed 8 of 8 after it. `git diff --check`
passed. Experimental Node glob/type-strip and build-plugin timing notices were
non-failing toolchain warnings.

Release provenance:

- Application source: `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c`
- Primary TLink recovery source:
  `b7e40751e2556ffc64e37704c641a6e917046bb6`
- Archive `.openai/site-release-9c278bb.tar.gz`: 7,829,193 bytes, SHA-256
  `EC1B166DD9957DA17C4F889E4802C349A76A71454627769D12B5BFD5A1E503E2`,
  375 entries, all 121 migrations and zero CSV entries
- Saved version:
  `appgprj_6a550c378000819185caf094173422bb~appgver_fd653b2ad83c81918fd23a3366735271`
- Deployment: `appgdep_6a71e7f3af3c81918f0f89a3e0354d36`
- Sites version 282, environment revision 19
- Sites stored 361 files and 31,907,840 bytes with content hash
  `sha256:86f36c8d918da0ae1b634db811ed645a27d4a50a1a35acc0eba79d5e20488d96`

Signed-in custom-domain QA opened Jobs, Schedule, Business and one existing test
quote without saving or sending. Jobs rendered 8 company-scoped records across
the Dataforce-aligned register; the results region used 1,661 px of a 2,048 px
viewport. Schedule retained all 12 CRM tabs and showed the expected two test
appointments. Business showed all seven settings regions, local save actions,
14 themes and three border styles on one page. The existing customer review
rendered the exact $4,444.00 total, decision controls and no visible
compliance-partner name. Its PDF returned HTTP 200, `application/pdf`, 399,318
bytes and a valid `%PDF-1.7` header. Opening the review records the designed
daily `viewed` audit event, creating it once or reusing it for that day.

Public root, health, compare, gas, direct-trade and dashboard probes returned
HTTP 200. The version-281 audit found the inherited rollback route at HTTP 500,
which caused the final correction and version 282. After propagation, ten
consecutive custom-domain fallback probes returned HTTP 307 to the deployed
legacy asset and the target returned HTTP 200 with the no-index meta directive.
The final five-minute errors-only production Worker log returned zero events;
a subsequent five-probe sample again returned HTTP 307 with `no-store` and
`noindex, nofollow`, while the target and health endpoint both returned HTTP 200.

Release QA did not upload branding, save a theme or setting, add a recipient,
issue or send a quote, accept or decline a quote, close an account, or create or
change a customer, job, intent, case, evidence, certificate, submission, trade
or settlement record. No customer, business, quote version or commercial value
was changed.

Remaining controlled limitations:

- a real Resend production receipt and Gmail or Outlook inbox/client rendering
  remain unverified; the reported attempt failed inside quote preparation before
  provider submission, and no replacement email was sent during QA;
- the next authorised lead-delivery monitor run must confirm the new 20/25
  second timeout relationship against the live Google Workspace relay;
- unreferenced removed branding may remain in private object storage until a
  separately authorised retention policy exists; branding referenced by an
  issued document is deliberately retained for integrity;
- legacy issued quote versions created before migration `0120` do not have a
  frozen document snapshot and are reconstructed from their retained legacy
  record; every newly issued version uses the immutable snapshot contract;
- account recovery and physical record erasure are intentionally absent.

## Next five logical product steps

1. **Prove production quote delivery end to end:** run one controlled Gmail and one Outlook delivery through Resend, authenticate provider webhooks, show provider state and retries inside the quote activity, and keep `provider_accepted`, delivered, bounced and complained distinct.
2. **Approve one complete VEU, SRES and NSW governed bundle each:** retain exact current official-source bytes, effective dates, approved products and participants, evidence policy and calculation vectors under independent review, then exercise each through a manual non-submitting job.
3. **Configure one approved Australian production address provider:** reuse one signed address component for customer, service-site and New Job creation and edits while preserving the visible manual-review fallback.
4. **Complete immutable intent revision and case supersession:** cover address, activity, product and technician changes, linked-case supersession and a clear authorised return-to-installer path.
5. **Complete physical field and Dataforce acceptance:** publish governed forms into real test jobs, validate original bytes, GPS, EXIF and offline recovery on named iOS and Android devices, and reconcile the remaining Dataforce import fields without inventing columns.

## Previous released milestone

Status: `TRADE-BUSINESS-IDENTITY-QUOTE-DELIVERY-43` released and historical

Released application source:
`fcfca482b0f86413423af2af8c5ae77054e6186f`, deployed as historical Sites
version 280 through `appgdep_6a71bf0136dc81918e71ba815cddd0ff`.

Milestone 43 established one authoritative Business workspace, controlled
private branding, bounded service areas, immutable quote-document snapshots,
branded email and server-PDF delivery evidence, token-authorised customer
documents and retained soft account closure. Its full contract and release
evidence remain in `ROADMAP.md` and `docs/RELEASE_TRUTH.md`.

## Earlier released milestone

Status: `TRADE-MULTI-ACTIVITY-USABILITY-42` released and historical

Prepared: 4 August 2026

Milestone ID: `TRADE-MULTI-ACTIVITY-USABILITY-42`

Working branch: `codex/sites-custom-domain-migration`

Previous production application source: `c51934456c2248da4cfde9a0b759b70d69df56ee`

Released application source: `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`

Historical production: Sites version 279 from application commit `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`

Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_e113332d3dac8191bff9ed71b5d51487`

Deployment: `appgdep_6a7178bb43c08191b86b568dabd45b94`

Production URL: `https://compare.ausenergyassessments.com`

Creditex URL: `https://compare.ausenergyassessments.com/creditex/compliance`

Sites provider URL: `https://aea-energy-comparison.info294029.chatgpt.site`

Environment revision: 19

## Released milestone contract

Outcome: an installer can create one accurate scheduled certificate-work job
with a complete customer record and one or more compatible program activities,
then carry the same private job, activity, schedule and commercial context into
field work and the assigned compliance review without duplicate entry.

Owning workflow:

- guided customer, multi-activity, appointment and review capture in
  `TradeNewJobForm`;
- durable multi-activity planning intents in `trade-crm`,
  `trade-compliance-intent` and an additive migration;
- installer Jobs and Customers navigation in `InstallerCrmWorkspace`;
- appointment and quote handoff in `TradeScheduleWorkspace`;
- the shared `SiteDatePicker`, installer-visible compliance wording and focused
  regressions for each changed boundary.

In scope:

- keep existing-customer search available while showing the new-customer form
  by default and require a valid phone and email for every newly created
  customer;
- let one job contain multiple controlled program and activity selections,
  reject exact duplicates and retain one immutable planning intent per selected
  activity;
- keep the final review detail rich and show every selected program activity
  without implying that a certificate, rebate or governed case exists;
- keep date and time selection usable inside the viewport on desktop and mobile;
- retain the exact known Dataforce 23-column order while making the customer
  identity visible in the frozen leading job context and phone values directly
  callable;
- sort customers by first name then last name, expose filters for every customer
  directory category and show a date with the latest job;
- make in-product back navigation prominent and preserve the current filtered
  list state;
- expose quote status and direct view, revise and prepare-to-send actions from
  the schedule appointment workspace;
- remove the compliance partner name from installer and customer-facing TLink
  dashboard copy while preserving the internal authorised partner boundary.

Out of scope:

- activating an unverified government rule, evidence policy or calculator;
- calculating or creating a certificate from discovery-only catalogue data;
- sending a regulator submission, trade or settlement;
- adding or guessing Dataforce meanings that are absent from the supplied
  23-column export;
- provisioning an address-provider account or secret;
- changing the internal compliance partner organisation, access model or
  dedicated administrator portal;
- creating production customers, jobs, evidence or compliance cases during
  release verification.

Acceptance criteria:

- the new-customer fields are open by default and cannot submit without a valid
  email, phone and service address;
- a job can save two or more compatible controlled activities atomically and
  every activity remains independently identifiable for later audit;
- the shared date-time picker remains fully visible and keyboard-operable at
  the top and bottom of the viewport;
- the Jobs register still has exactly the supplied 23 headers in order and one
  job per row, while customer identity and callable phone values are usable
  without scrolling to the far-right columns;
- the customer directory defaults to first-name then last-name order, every
  shown category has a corresponding filter, and latest job includes its date;
- schedule appointment details provide safe paths into quote view, revision and
  send preparation without bypassing the quote preview and consent controls;
- installer and customer TLink dashboards contain no visible compliance partner
  name, while the authorised internal portal and tenant checks remain intact;
- type checking, lint, focused tests, migration replay, integration tests, the
  complete suite, production build and Sites bundle audit pass.

Stop condition: stop if multiple activities cannot remain atomic and
independently identifiable, if an existing tenant or actor boundary fails, if
the Dataforce 23-column contract changes, if migration replay diverges, or if
release verification would mutate production data.

## Release result

Released application source `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`
was deployed as Sites version 279. Primary implementation commit
`103439d03a5c322757cea27e77e8b147b6c85590` keeps new-customer entry open
beside existing-customer search, requires phone and email, and creates every
selected controlled activity in one atomic job transaction. Each activity
retains its exact program, activity, policy and later case identity across web
and mobile field capture. The installer Jobs register preserves the exact known
23-column Dataforce contract while showing identity first, callable contact
details, complete filters and explicit navigation. Customer A-to-Z sorting,
latest-job dates, schedule quote actions, the portalled date-time picker and
detail-rich multi-activity review are included.

The completion boundary now fails closed if any active governed case is missing
submitted evidence, if an evidence item has been superseded, or if photo proof
changes between preflight and the atomic transition. JSON control requests are
stream-bounded by actual bytes, and offline bootstrap companion rows are
restricted to the selected 500-job cohort with an overall fail-closed
cardinality limit.

A changed installation date now immutably supersedes each still-planned
activity intent and inserts its exact next revision in the same guarded
schedule transaction. Concurrent schedule writes roll back completely, while
case-linked intents remain date-locked.

CRM diagnostic `ce0996779818690751016dfd5b3efdd8e7c1586e` and guard correction
`82e0faf64906047a5f42fabf83c605edf320cb63` resolved a separate production
CRM schema-guard failure. Subsequent asset diagnostic
`eeb636665a21d230b7150e03d60f614b7f71b1db` isolated the remaining customer
asset failure to a seven-arm compound timeline query. Final commit
`13dbf2ddc4eea32c6a929ef15cb258a263ff99ea` executes the seven bounded
owner-, customer- and optional-site-scoped reads in one D1 batch, globally sorts
them by the unchanged API contract and returns at most 500 rows without
presenting partial history as complete.

`npm.cmd run validate` passed type checking, warning-free lint, 31 of 31
integration tests, 1,443 main tests with 1,441 passed, 2 intentionally skipped
and 0 failed, all 120 migrations through
`0119_trade_multi_activity_jobs.sql`, the customer-plan PDF audit, Vinext
production build and Sites server-bundle audit. The focused asset timeline suite
passed 9 of 9. Independent final review found no remaining P0, P1 or P2 defect.

Release provenance:

- Application source: `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`
- Archive `.openai/site-release-13dbf2d.tar.gz`: 7,781,979 bytes, SHA-256
  `D6AC82425EC5EE82B84318978177D49F0E41E54DF755094FEC935F7549FDAA67`,
  374 entries, all 120 migrations and zero CSV entries
- Saved version:
  `appgprj_6a550c378000819185caf094173422bb~appgver_e113332d3dac8191bff9ed71b5d51487`
- Deployment: `appgdep_6a7178bb43c08191b86b568dabd45b94`
- Sites version 279, environment revision 19
- Sites stored 360 files and 31,682,560 bytes with content hash
  `sha256:1630c642f67fb83d38fd428197e05e4ae32e4bad97c29eb111d6c090760d7dc3`

Signed-in QA exercised New Job without submission, the exact 23-column job
register and CSV contract, customer sorting, filters and callable contacts,
dated latest jobs, schedule quote access, the assigned internal compliance
workspace and the customer asset register. The final `/api/trade-assets`
request returned HTTP 200 under request/ray `a25b2c9d7a1275df`; the asset and
timeline UI rendered, and errors-only worker logs contained zero events. The
custom-domain health endpoint returned HTTP 200. No production customer, job,
business, intent, case, evidence, certificate, submission, trade or settlement
record was created or changed.

Superseded signed-in QA releases:

- Sites version 277 from `82e0faf64906047a5f42fabf83c605edf320cb63`:
  saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_3037473e40d88191817b148c76b46504`,
  deployment `appgdep_6a716eaea7a481919682286140434b24`, archive 7,791,568
  bytes with SHA-256
  `5634F3374E72FA45620F3FF0EA9178C3DD65090C283E9365E3B127FE9DCF06FC`.
- Sites version 278 from `eeb636665a21d230b7150e03d60f614b7f71b1db`:
  saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_1825408c19508191a3f8fc69e969d7ac`,
  deployment `appgdep_6a7172b2ed008191b9460a81e8296993`, archive 7,791,566
  bytes with SHA-256
  `D72C597AE7075C1FCE24EDBA3F2236966B9F3ADBA5B3366EACB42B0A9C25E8FA`.

## Earlier released milestone

Status: `TRADE-CREDITEX-OPERATING-ALIGNMENT-41` released and historical

Historical Sites version 274 provenance:

- Primary implementation source commit: `836bc779f33a5f77fc4a18a41227dc76dfbf9914`
- Installer-register corrective commit: `c32be214558dd1a20ccb26d04bcf7b054b00f110`
- Released application source commit: `c51934456c2248da4cfde9a0b759b70d69df56ee`
- Saved version:
  `appgprj_6a550c378000819185caf094173422bb~appgver_02f3ce1e33ec8191919abea0bc24f6ac`
- Deployment: `appgdep_6a7082f95d2881919e97336aa038fc5a`
- The baseline archive is 7,775,395 bytes with SHA-256
  `CD5CA5072B17BC6970CB6EDEE0CA1A3C29D195A535397A91C9A0794810975F9C`.
  Sites stored 359 files and 31,590,400 bytes with content hash
  `sha256:455c203ec7dfe5c21c5559453b33e4e7f1b92910412d9cd4130ac903ccb2aeb7`.
- The baseline production-schema regression reported 106 of 106 audit-group statements passed.

Remaining controlled limitation: production has no
`TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT` or
`TLINK_ADDRESS_AUTOCOMPLETE_TOKEN`. Manual address entry remains available,
but it is explicitly stored and shown to Creditex as `manual_pending_review`.

## Superseded next-five sequence after milestone 42

1. **Approve one complete VEU, SRES and NSW governed bundle each:** retain exact current official-source bytes, effective dates, product and participant registers, evidence policy and calculation vectors under independent review, then exercise every bundle through a manual non-submitting job.
2. **Complete immutable intent revision and case supersession:** extend the guarded planned-date revision path to address, activity, product and technician changes, then add linked-case supersession and a clear authorised return-to-installer path.
3. **Configure one approved Australian production address provider:** reuse the same signed address component for customer, service-site and New Job creation and edits while preserving the manual-review fallback.
4. **Complete the Dataforce field and import contract:** split Phone and Mobile into explicit durable fields and reconcile unresolved lifecycle, agent, client, submission and certificate mappings without adding unverified columns.
5. **Complete physical field acceptance and governed form publishing:** publish versioned compliance-managed forms into real jobs, validate original bytes, GPS, EXIF and offline recovery on named iOS and Android devices, and keep installer completion separate from audit acceptance.

## Earlier released milestone

Status: `TRADE-CREDITEX-JOB-HANDOFF-40` released and live

Prepared: 3 August 2026

Milestone ID: `TRADE-CREDITEX-JOB-HANDOFF-40`

Working branch: `codex/sites-custom-domain-migration`

Released application source commit: `a45f250ee805aac1545c8643726dfde3964de22b`

Previous production application source: `8baad519d763f0955e481a925ca9114b4d708653`

Historical production for milestone 40: Sites version 271 from application commit `a45f250ee805aac1545c8643726dfde3964de22b`

Production URL: `https://compare.ausenergyassessments.com`

Creditex URL: `https://compare.ausenergyassessments.com/creditex/compliance`

Sites provider URL: `https://aea-energy-comparison.info294029.chatgpt.site`

Production access: public comparison host with authenticated installer and Creditex workspaces

## Released milestone contract

Outcome: an installer creates one scheduled TLink job, optionally selects a
controlled government program and activity once, and carries that exact
pre-case intent through accepted-quote linking, on-site governed evidence
questions and the Creditex audit workflow without re-entering the same fields.

Owning workflow:

- guided installer job creation in `TradeNewJobForm` and `trade-crm`;
- the durable installer-to-Creditex pre-case intent contract;
- accepted-quote conversion in `trade-compliance`;
- installer job overview and Creditex planned-intake visibility;
- focused schema, contract, route and responsive regressions.

In scope:

- replace the evidence-and-invoice-heavy creation tail with a short
  program/activity and appointment flow;
- validate controlled program/activity identifiers, jurisdiction and service
  category server-side and retain an immutable catalogue snapshot;
- keep a non-program job path;
- keep regulated case creation behind an accepted commercial handoff and an
  independently governed published activity and evidence policy;
- preselect the governed activity from the saved intent when an exact current
  match exists;
- make every assigned planned job visible to the authorised Creditex
  organisation with its customer, service-site, installer, commercial,
  appointment and retained workflow details, while withholding authentication
  secrets and storage credentials;
- preserve the existing AEA Field governed-question and original-evidence
  custody path after the case is opened.

Out of scope:

- activating a government rule or evidence policy;
- claiming that a discovery catalogue template is an approved compliance rule;
- creating a certificate, regulator submission, trade or settlement;
- creating production test customers, jobs or compliance records;
- changing the customer enquiry, quoting, invoicing or external registry
  systems beyond the fields needed for this handoff.

Acceptance criteria:

- program and activity are controlled dropdowns, not free text;
- the activity determines the TLink work category and the service-site
  jurisdiction is validated;
- an appointment can be created with the assignee and start time while optional
  visit details stay progressively disclosed;
- one atomic write creates the customer, site, job, appointment and optional
  compliance intent;
- Creditex can see its assigned planned intents and open the complete authorised
  job audit workspace, while the installer sees the same program/activity on
  the job;
- accepted-quote case creation pins the exact governed version and marks the
  intent linked;
- no regulated action is enabled by a catalogue-only intent;
- desktop and mobile layouts remain usable without document-level horizontal
  overflow.

Validation:

- focused intent, migration, wizard, CRM, accepted-handoff, Creditex portal and
  field-contract regressions;
- type checking, warning-free lint, integration tests, full application tests,
  migration replay, production build and Sites bundle audit;
- signed-in installer and Creditex browser QA without creating production data.

Stop condition: stop if program/activity identity cannot remain stable across
the job and case, if an unauthorised organisation could see an intent, if the
flow would bypass accepted quote or governed policy controls, or if completion
would require production data or an external regulator submission.

## Released milestone 40 outcome

The installer New Job flow now has five short stages: Work, Customer, Program,
Appointment and Review. Certificate and support selection stays conditional on
the work type and service-site jurisdiction. Where a pathway applies, the
installer chooses controlled claim output, program and activity values. Where
it does not apply, the ordinary non-program job path remains available.

One guarded transaction creates or attaches the customer and service site,
creates the TLink job and appointment, and optionally writes an immutable
`tlink-creditex-job-intent-v1` planning snapshot. The snapshot retains the
selected catalogue version, program, activity, claim output, jurisdiction,
service category, installation date and installer/customer/job references. It
is planning evidence only and cannot create a regulated case or certificate.

Creditex now has a `Certificate-work register` containing every assigned
installer planning record from job creation onward. Authorised Creditex roles
can open the full customer, service-site, installer, commercial, appointment
and workflow audit projection. Authentication credentials, tokens, raw storage
keys and unrelated internal identifiers are not exposed. The installer sees
the same planned program and activity from the job.

Accepted-quote conversion revalidates the exact intent against a published,
effective governed program, activity and evidence policy before it creates a
case. A matching case pins the governed version and links the intent in the
same database batch. A stale or incompatible intent is visibly marked
`Re-plan required` and cannot silently create a case.

## Milestone 40 validation and release evidence

- Exact application commit `a45f250ee805aac1545c8643726dfde3964de22b`
  passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31
  integration tests, the complete application suite, all 117 migrations,
  customer-plan PDF audit, Vinext production build and Sites server-bundle
  audit.
- The final intent, migration, installer wizard, CRM, accepted-handoff,
  Creditex portal and field-contract regression set passed 105 of 105.
  Independent security, data-boundary and interface review findings were fixed
  before release.
- Archive `.openai/site-release-a45f250.tar.gz` is 7,758,795 bytes with
  SHA-256
  `23C885EF9D4BD11FA837107740E9B44381D0E8B71CA4432364F3531CFF148CC9`,
  369 entries and all 117 migrations.
- Saved Sites version
  `appgprj_6a550c378000819185caf094173422bb~appgver_1e6ba2c1ae64819197a3b33a13cbb364`
  reports exact source `a45f250ee805aac1545c8643726dfde3964de22b`,
  355 stored files, 31,518,720 stored bytes and content hash
  `sha256:28daf91f4202cf79d0c3c5ecbb7b4f42822bec6725644c3077423b3869e83e0e`.
- Deployment `appgdep_6a701f23b43c8191ab61ef23e35166de` succeeded
  as Sites version 271 with environment revision 19.

## Milestone 40 live production evidence

- Signed-in installer QA opened the dashboard and New Job flow without
  submitting it. All five stages, controlled certificate/support selector,
  customer selection, appointment controls and review boundary rendered with
  no document-level horizontal overflow.
- The default energy-assessment work type correctly offered only `No government
  certificate or support activity`; program and activity choices remain
  conditional until the installer selects compatible certificate-generating
  work and a service jurisdiction.
- Signed-in Creditex QA recovered the existing administrator session and loaded
  `Compliance case control`, the permanent compliance navigation and the
  `Certificate-work register`. The assigned-work queue reported 0 jobs and no
  production record was created.
- Desktop and compact homepage checks kept the corrected shared heading and all
  navigation destinations reachable without document-level horizontal
  overflow. Browser image capture timed out, so this release retains live
  rendered-DOM, width and interaction evidence rather than a new screenshot
  artifact.

## Milestone 40 important limits and unverified areas

- The 32 program pathways and 212 activity templates are controlled planning
  catalogue records, not independently approved government rules.
- This release did not directly re-query production governed program, activity,
  evidence-policy or case counts. It created no production data, and the live
  Creditex assigned-work register reported 0 jobs.
- No certificate, regulator submission, trade or settlement is created. No
  single public authoritative API contract has been verified for every
  Australian certificate calculation.
- A changed job, service site or installation date does not yet create an
  automatic replacement intent. The current system detects the mismatch,
  displays `Re-plan required` and blocks case linking.
- Pre-case Creditex audit exposes authorised photo and file metadata. Original
  governed evidence bytes remain available only after case creation through
  the existing protected evidence viewer.

## Previous released milestone

Status: `CREDITEX-GOVERNED-SOURCE-INTAKE-39` released and live

Prepared: 3 August 2026

Milestone ID: `CREDITEX-GOVERNED-SOURCE-INTAKE-39`

Working branch: `codex/sites-custom-domain-migration`

Released application source commit: `8baad519d763f0955e481a925ca9114b4d708653`

Primary application source commit: `8baad519d763f0955e481a925ca9114b4d708653`

Previous production application source: `37776ed557d7c0a25d92698f52e87cf59cee05b6`

Prior production for milestone 39: Sites version 270 from application commit `8baad519d763f0955e481a925ca9114b4d708653`

Production URL: `https://compare.ausenergyassessments.com/creditex/compliance`

Sites provider URL: `https://aea-energy-comparison.info294029.chatgpt.site`

Production access: public host with an authenticated Creditex portal

## Released milestone 39 outcome

Outcome: an authorised Creditex operator can capture an exact official source into governed draft-only custody, and an independent reviewer can inspect the same retained bytes before any artifact or rule binding can be approved.

Owning workflow and files:

- official-source custody and target projection: `src/lib/creditex-official-source-custody-server.ts`;
- protected list and upload route: `src/app/api/creditex/official-sources/route.ts`;
- protected retained-byte route: `src/app/api/creditex/official-sources/[id]/route.ts`;
- operator workbench and responsive presentation: `src/components/CreditexOfficialSourceWorkbench.tsx` and its module stylesheet;
- Creditex workspace mount and role-aware navigation: `src/components/CreditexCompliancePortal.tsx`;
- focused custody, route, review and portal regressions under `test/`.

In scope:

- list only the signed-in organisation's governed source artifacts and their current independent review state;
- supply server-controlled draft targets for program, activity, evidence-policy and calculator bindings;
- upload exact official bytes through the existing multipart custody boundary and show the server-computed SHA-256 and byte count;
- download exact retained bytes only after organisation scoping, R2 retrieval, byte-length comparison and SHA-256 verification;
- present the current official URL beside the retained artifact so a reviewer can compare both;
- preserve artifact review before binding review, different-identity review and verified-governance requirements;
- keep every record draft-only and every publication, certificate, submission, trade and settlement action blocked.

Out of scope:

- publishing a government rule, activity version, evidence policy or calculator;
- accepting a source without a named independent reviewer;
- creating live regulated jobs, certificates, submissions, trades or settlements;
- treating the research source index as governed custody;
- claiming complete VEU, TESSA, REC Registry or other program rule coverage;
- creating production test data during release QA.

Acceptance criteria:

- an empty governed inventory is clearly displayed as zero and is not populated with research-only references;
- target selectors come from owner-scoped server data and contain only draft records;
- uploads retain exact bytes, compute the hash on the server and return explicit current artifact and binding decisions;
- retained-byte download fails closed for missing, altered or wrong-organisation R2 objects;
- the capturer cannot review the artifact or its binding, and binding approval remains unavailable until the artifact has a current independent approval;
- no rule activation, policy publication, certificate action or external send is introduced;
- desktop and compact layouts remain readable with no document-level horizontal overflow.

Validation:

- focused official-source custody, route, review, portal and workspace tests;
- type checking, warning-free lint, integration and full application tests;
- all migrations, customer-plan PDF audit, Vinext production build and Sites bundle audit;
- authenticated empty-state and permission-boundary browser QA without uploading production data.

Stop condition: stop if source bytes cannot be independently inspected, exact-byte integrity cannot be proven, owner scope is ambiguous, a target is not draft-only, or completion would require production data or a regulator submission.

The [complete current-state audit](./audit/2026-07-21-complete-current-state/README.md) remains the immutable evidence baseline. [RELEASE_TRUTH.md](./RELEASE_TRUTH.md) owns released implementation status and deployment identity. [ROADMAP.md](../ROADMAP.md) owns approved forward sequencing. Sites version 270 was the production identity for milestone 39. The governed inventory verified during that release was 0 published programs, 0 activity versions, 0 evidence policies and 0 regulated cases.

## Milestone 39 validation and release evidence

- Exact application commit `8baad519d763f0955e481a925ca9114b4d708653` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete application suite, all 115 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The integrated custody, review, workbench, portal, pilot, policy, readiness, calculation and interchange set passed 86 of 86. Independent final review found no remaining blocker against exact-byte replay verification, same-reviewer retained-byte access receipts, authorised-role inventory access, immutable completed decisions and authoritative cursor pagination.
- Archive `.openai/site-release-8baad51.tar.gz` is 7,736,223 bytes with SHA-256 `BDBED88DB3F6675DFB0AD4BF133651F9B4609DA0432F42390DD591D5715205A8`.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_2deae2c2caa081919a369e1cd193bd5d` reports exact source `8baad519d763f0955e481a925ca9114b4d708653`, 351 stored files, 31,406,080 stored bytes and content hash `sha256:6cf77082dca1a638dc78e094791cd712f2417fdb17bd86c9a0ba772aa041d978`.
- Deployment `appgdep_6a6fc16429e88191af41bbf10fb18a6a` succeeded as Sites version 270 with environment revision 19.

## Milestone 39 live production evidence

- Signed-in Chrome QA loaded the existing Operations workspace and its zero-case privacy-minimised queue, then opened the permanent `Official sources` tab without changing identity or creating data.
- The contextual heading changed to `Official source custody`. The governed workbench rendered the exact-source capture form, server-controlled draft-target selector, current-government-link field, citation, exact-file input, optional HTTP metadata and retained-source register.
- Production correctly reported `0 shown of 0 records`, no eligible draft target, disabled `Retain source`, and disabled previous and next pagination. No research-only link was promoted into governed custody.
- At a 390 by 844 responsive override, all four compliance tabs, the complete source workbench, zero state and disabled safety controls remained reachable. The override was cleared after QA.
- The compare-platform homepage at the same responsive override showed `Scroll for more options`, kept `Start` visible and retained all seven navigation destinations. At the default viewport the cue remained hidden while the complete navigation stayed available.

## Milestone 39 important limits and unverified areas

- Exact official VEU, NSW TESSA and REC Registry source bundles have not yet been retained or independently approved in production.
- The workbench is draft-only custody. It cannot publish a rule or policy, execute a calculator, create a certificate, send a regulator file, trade or settle.
- A real Creditex reviewer identity still needs to exercise the retained-file download, artifact decision and binding decision sequence against an authorised non-production fixture before the first production policy review.
- TESSA and REC authenticated uploads, regulator acceptance receipts and rejection payloads remain unavailable; no public authoritative certificate-calculation API contract has been verified.

## Released milestone 38 outcome

The shared compare-platform navigation no longer clips its first destinations. `Start` now begins at the visible scroll origin, all seven existing destinations remain ordered, and layouts up to 1320 pixels move navigation onto a clear full-width row with a visible `Scroll for more options` cue and right-edge continuation fade. The cue is associated with the navigation for assistive technology, compact layouts retain horizontal snap access, and the page itself does not overflow.

Exact application commit `37776ed557d7c0a25d92698f52e87cf59cee05b6` passed the complete `npm.cmd run validate` gate, including 31 of 31 integration tests, the full application suite, all 115 migrations, customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The focused navigation suite passed 21 of 21. Local responsive measurements at desktop, approximately 390 pixels and approximately 320 pixels had zero document-level overflow and kept `Start` visible before scrolling and `Assessments` reachable at the scroll end.

Archive `.openai/site-release-37776ed.tar.gz` is 7,717,752 bytes with SHA-256 `ED56FF26BE5E160878D8A72E022B703CCEC952058687FD66A7962CB51D269030`. Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_ea8944a8b6d08191bf7b8fd3237619c4` reports exact source `37776ed557d7c0a25d92698f52e87cf59cee05b6`, 351 stored files, 31,303,680 stored bytes and content hash `sha256:bdd4fb3fe2ccad379fe6afc94f5ae92470213388ba2f9c236708b8cffbab0aed`. Deployment `appgdep_6a6fb33354ac8191beb6ef116cbe9bca` succeeded as Sites version 269 with environment revision 19.

## Released milestone 37 outcome

The next five Creditex priorities are now integrated as one synthetic, fail-closed preflight:

1. AEA Field can capture an exact manual-evidence prompt on its dedicated compliance lane, retain original upload bytes in R2, calculate SHA-256 server-side, inspect capture time, EXIF and GPS, recover multipart and offline uploads, and bind every receipt to the exact device, job, form version and prompt. User sign-out attempts server revocation before local purge, and a server-side revocation forces sign-out on the next successful sync.
2. Manual forms compose an immutable, independently approved government minimum with a separately editable Creditex operational layer. Creditex can add instructions and additional prompts, but cannot remove, weaken, replace or reorder a government minimum. Exact bytes, hashes, effective dates, dual control and compare-and-swap locking are enforced before approval.
3. Synthetic manual jobs and the VEU pilot now share one owner-scoped register, populated advanced-search facets and complete audit workspace while preserving the exact 23 supplied Dataforce columns and one row per job.
4. Every one of the 212 controlled activity templates has one deterministic calculation-readiness result. Six SRES technologies expose a protected estimate; 206 pathways remain visibly blocked or non-executable and no certificate action is enabled.
5. VEU, NSW TESSA and REC Registry boundaries now have explicit blocked descriptors and preflight status. No exact external serializer, regulator request, certificate creation, trade or settlement action is exposed without retained official dictionaries, independent approval and accepted external receipts.

This is a production-quality synthetic test foundation, not a claim that every government rule, certificate calculation or regulator connector is complete. The simple installer path remains: select a controlled program and activity, use its pinned evidence form, capture each requested item once, resolve visible failures, then hand the complete immutable job to Creditex for audit.

## Milestone 37 owning workflow and files

- Manual field capture, R2 custody, replay protection and physical acceptance: `src/lib/creditex-manual-field-server.ts`, `src/lib/creditex-manual-field-acceptance-server.ts`, `src/app/api/creditex/manual-field/**`, migration `0112_creditex_manual_field_capture.sql` and the matching AEA Field mobile modules.
- Unified exact register and audit projection: `src/lib/creditex-synthetic-job-register-server.ts`, `src/app/api/creditex/synthetic-job-register/route.ts`, `src/components/CreditexVeuPilotWorkspace.tsx`, `src/components/CreditexManualJobAuditWorkspace.tsx` and migration `0113_creditex_synthetic_register.sql`.
- Government-minimum and Creditex-layer composition: `src/lib/creditex-manual-policy-merge.ts`, `src/lib/creditex-manual-policy-merge-server.ts`, its protected route and migration `0114_creditex_manual_policy_merge.sql`.
- National calculation and interchange readiness: `src/lib/creditex-calculation-coverage.ts`, `src/lib/creditex-interchange-preflight.ts`, `src/lib/creditex-tessa-csv.ts`, `src/lib/creditex-rec-bulk-upload.ts` and their protected readiness routes.
- Regression evidence: the Creditex manual-field, acceptance, policy-merge, register, calculation-coverage, interchange, schema-guard and mobile capture, upload-recovery and sign-out suites.

## Milestone 37 safety boundaries

- Every new manual-form, manual-job, capture and register path remains `synthetic_test`. It cannot create or mutate a regulated case, certificate, regulator submission, trade or settlement.
- The server hashes and inspects original uploaded bytes. Client-authored filenames, hashes, coordinates, timestamps or completion claims are never treated as proof.
- Required GPS fails closed when absent, mocked or when reported location accuracy is worse than 100 metres. Physical acceptance remains separate from emulator or source validation.
- A government minimum must come from a published, effective, independently approved policy record. With the current governed inventory at zero, production form approval remains blocked.
- Creditex instructions are operational additions only. They never become a private government rule pack.
- The register contains only the exact Dataforce columns. Program, activity, custody and governance detail remains in filters and the audit workspace.
- TESSA and REC entries are readiness descriptors only. There is no exact approved parser, serializer, bulk download or live-send control in this release.
- Deterministic estimates remain preflight values. They cannot register, issue, trade or settle a certificate.

## Milestone 37 validation and release evidence

- Exact corrective application commit `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,355 main tests with 1,353 passed, 2 intentionally skipped and 0 failed, all 115 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The AEA Field mobile suite passed 20 of 20, together with mobile type checking and lint. Android and iOS Expo exports completed. Android still reports the unresolved `android.googleServicesFile: "./google-services.json"` warning, so native Firebase signing and physical-device acceptance are not claimed.
- The final D1 register-facet correction passed its focused 5-test set and retained exact facet counts, labels, parent relationships and empty-value exclusion across seven read-only grouped queries in one transactional batch.
- Archive `.openai/site-release-5d4b540.tar.gz` is 7,703,920 bytes with SHA-256 `f1ce735aed060d55e8461814707f53da22fb8845820629b96b6124db541fa989`, 365 entries, all 115 migrations and zero CSV entries.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_95cd969101b08191b89b03aaea09e827` reports exact source `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb`, 351 stored files, 31,303,680 stored bytes and content hash `sha256:b0d80a9e5d0c61084a227f8661df5d0366845ee5ac298c4a671a3eae753126a9`.
- Deployment `appgdep_6a6fa22d2bb48191b8bd5fd8317cbe9f` succeeded as Sites version 268 with environment revision 19.

## Milestone 37 live production evidence

- Signed-in Chrome QA loaded 300 of 300 VEU pilot jobs with the exact 23 Dataforce headers, 23 sortable columns and one job per row.
- Global all-field search reduced the register to the exact requested job and restored the complete register. The compact drawer exposed stored-value source, program, activity, installer, technician, status and postcode filters.
- The App Id sort menu closed after an outside click. Double-click opened the complete audit workspace, including customer, job, appointment, files and photos, compliance status, program controls and original-evidence custody surfaces.
- Evidence reported 32 controlled program pathways and 212 activity templates, with the editable form starter, manual-job and installer-preview surfaces present. No production form or job was created during QA.
- Calculators reported 212 covered templates, 6 executable estimates, 206 blocked or non-executable pathways and 0 enabled certificate actions. Connectors reported 5 blocked descriptors, 0 serializers and 0 external sends, with no send, submit, trade or certificate-creation button.
- The compact mobile layout retained navigation, global search and the right-edge filter drawer without document-level horizontal overflow; the wide register kept its own horizontal scroller.
- Sites Worker error-only logs returned zero events after the signed-in checks. Browser logs contained only Chrome-extension asynchronous message-channel closures with no application stack.

Sites version 267 contained the complete milestone implementation from `8c29808a9f4a80acc8e7f2304c4b49268f4f2c49`, but signed-in QA found that production D1 rejected the compound seven-arm facet query and the pilot failed closed. No data mutation was involved. Version 268 replaces that query with seven exact grouped statements executed through one transactional D1 batch; the same signed-in route then loaded successfully.

## Milestone 37 important limits and unverified areas

- No named physical iOS or Android device has completed the online, offline, multipart, GPS, EXIF, retry, R2 restore and sign-out matrix.
- Native Firebase configuration, platform signing, distribution, device accessibility and background-upload acceptance remain incomplete.
- The real governed inventory remains 0 published programs, 0 activity versions, 0 complete evidence policies and 0 regulated cases, so no government minimum is yet approved into a production form.
- No exact approved TESSA v1.7 or REC Registry dictionary, parser, serializer, bulk export, rejection map or accepted external receipt is retained. The ESC VEU authorised API contract and sandbox remain unavailable.
- Only 6 of 212 pathways expose deterministic SRES estimates. The remaining 206 are blocked or non-executable until exact source assets, lookups, independent formula approval and oracle reconciliation exist.
- Production certificate creation, regulator submission, trading and settlement remain disabled.

## Superseded next-five sequence after milestone 37

1. **Add automatic intent revision and return workflow:** create a new immutable planning version when the job, service site, activity or installation date changes, supersede the prior version visibly, and let Creditex accept or return the exact current plan without weakening the accepted-quote or governed-policy gate.
2. **Approve the first governed VEU, SRES and NSW bundles:** retain the complete current official source bytes, effective periods, product and participant snapshots, formulas and evidence requirements under two-person review, then publish one bounded activity chain per program.
3. **Bind dynamic compliance forms into AEA Field:** render the case-pinned government minimum plus editable Creditex operational prompts, declarations and signatures with controlled conditional logic, offline capture and immutable version identity.
4. **Enforce evidence-complete job gates:** prevent installer completion and Creditex submission readiness until every required question, original file, photo metadata, geolocation rule, declaration and signature passes the pinned policy, while keeping correction instructions simple.
5. **Complete Creditex pre-case evidence operations:** add audited original-byte access where authority permits, operational notifications, Dataforce import mapping and bounded legacy backfill so Creditex can manage real volume without creating certificates or external submissions prematurely.

## Released milestone 36 outcome

Creditex now has a national synthetic manual-test lab for all 32 controlled Australian program pathways and all 212 controlled activity templates. An administrator, case manager or reviewer can select any catalogued activity, generate an editable starter form, add and reorder installer prompts, lock an exact test-ready form version, create a synthetic manual job and move it through field testing, audit, changes required, passed and archived states.

The form builder supports photo, document, text, number, controlled select, declaration checkbox, date and signature prompts. Each prompt can record capture timing, minimum and maximum files, permitted MIME types, original-file retention, metadata retention and GPS requirements. Jobs pin the exact activity snapshot, form bytes and SHA-256 so a later form edit cannot silently change work already under test.

Creditex operational instructions remain separate from government rules. A prompt can be identified as a government-requirement candidate only when it carries an HTTPS official source, title, version, clause and exact SHA-256. This lab cannot publish that candidate as government policy. The independently governed evidence-policy workflow remains the authority for government requirements.

## Milestone 36 owning workflow and files

- Manual evidence contracts and validation: `src/lib/creditex-manual-evidence-lab.ts`.
- Owner-scoped form, job and append-only event operations: `src/lib/creditex-manual-evidence-lab-server.ts`.
- Protected same-origin API: `src/app/api/creditex/manual-evidence-lab/route.ts`.
- Creditex operator and installer-preview interface: `src/components/CreditexManualEvidenceLab.tsx` and `src/components/CreditexManualEvidenceLab.module.css`.
- Storage and runtime protection: `drizzle/0111_creditex_manual_evidence_lab.sql`, `db/schema.ts` and `src/lib/creditex-schema-guards.ts`.
- Regression evidence: `test/creditex-manual-evidence-lab.test.mjs`, `test/creditex-schema-guards.test.mjs`, `test/creditex-operations-control.test.mjs` and `test/creditex-veu-pilot.test.mjs`.

## Milestone 36 safety boundaries

- Every form and job is `synthetic_test`; real customer aliases are rejected and no regulated case, evidence object, certificate, submission, trade or settlement is written.
- Draft forms are editable. Locked form versions are immutable and must be cloned before change. Started jobs retain their pinned form and activity snapshots.
- A ready-for-audit response snapshot cannot be modified during approval. Only an administrator or reviewer can require changes or pass a test, at both API and database boundaries.
- Required counts, file counts, MIME types, typed answers, GPS, metadata, original-file and review-note requirements fail closed.
- The lab records filenames and capture checks only. Physical file bytes, camera capture, EXIF, offline sync and R2 storage are not represented as accepted.
- The exact 23-column Dataforce register and its CSV contract remain unchanged.

## Milestone 36 validation and release evidence

- Exact application commit `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,289 main tests with 1,287 passed, 2 intentionally skipped and 0 failed, all 112 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The final manual-evidence, schema-guard, VEU-pilot and operations-control set passed 62 of 62. Independent release review found no P0 or P1 blocker. Its one database review-role hardening finding was corrected and covered by a regression test before release.
- Archive `.openai/site-release-ecec39a.tar.gz` is 7,629,648 bytes with SHA-256 `2BAFF556C8F963612F6FC4878326C2A1924B38F0AB8E5D1046B00C5ED2044F53`, 361 entries, all 112 migrations and zero CSV entries.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_e42b1932db8481918304dad9fcf28bd2` reports exact source `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f`, 347 stored files, 30,883,840 stored bytes and content hash `sha256:ac05eacd1792bacdb6b5ef4e0dae86149f8cb484678401061e86ca96ddce69cd`.
- Deployment `appgdep_6a6f4c3dc8b88191a33403ba9acbd5d9` succeeded as Sites version 266 with environment revision 19.

## Milestone 36 live production evidence

- Signed-in Chrome QA loaded the Evidence workspace with catalogue metrics for 32 controlled program pathways and 212 controlled activity templates, two controlled catalogue selectors, the original-evidence custody boundary and no application alert.
- Form builder, Manual jobs and Installer preview all rendered. The manual-job panel exposed a synthetic-only job creator and the preview rendered the TLink Field handoff without creating a production record.
- The exact 300-job register still opened, and Advanced search exposed its compact right-edge drawer with installer, activity, review, evidence and the existing Dataforce-equivalent filter families.
- At 390-pixel and 320-pixel responsive overrides the document width equalled the viewport width. Wide controls used bounded internal horizontal scrolling instead of document overflow.
- Browser review found zero application errors. Three Chrome-extension asynchronous message-channel closures were excluded because they carried no application stack.

## Milestone 36 important limits and unverified areas

- The starter generator is available for every activity, but exact government evidence requirements are not automatically published into forms until retained source bytes and independent evidence-policy approval exist.
- Production QA did not create a synthetic form or job. The complete create, lock, field-test, review, change and pass loop is proven by the owner-scoped database and API regression suite rather than a new production row.
- Original photo and document bytes, EXIF, GPS, device identity, offline recovery, upload recovery and R2 restore remain outside this manual simulator.
- Manual test jobs do not yet appear in the main 23-column Jobs register or full job-audit workspace.
- TESSA, ESC VEU and REC Registry interchange remains disabled. Certificate creation, submission, trading and settlement remain disabled.

## Superseded next-five sequence after milestone 36

1. **Connect the physical field-test path:** bind locked manual-form prompts to AEA Field test-device capture, original bytes, EXIF, GPS, device identity, offline queue, retry and R2 restore, then record named physical acceptance.
2. **Merge government policy without weakening it:** render independently approved government evidence requirements as immutable fields, layer editable Creditex instructions and additional operational prompts above them, and show an exact version diff before a form can be locked.
3. **Unify manual jobs with the Creditex audit workflow:** project synthetic manual jobs into the existing register, advanced filters and full audit workspace without changing the exact 23 Dataforce columns or allowing a synthetic row into regulated tables.
4. **Build regulator interchange dry runs:** implement exact NSW TESSA v1.7 CSV preflight and download, separate REC Registry SGU and SWH/ASHP bulk packs, and a disabled ESC VEU API adapter with immutable manifests, receipts and rejection reconciliation. Keep every live send disabled.
5. **Complete source-approved calculation coverage:** retain exact formula assets and lookup snapshots, author independently reviewed calculators and golden vectors, and run a complete 212-activity regression before enabling any expected-entitlement result.

## Released milestone 35 outcome

Creditex now has one national calculation-readiness workspace across 32 controlled Australian government program pathways and 212 controlled activity templates. Every activity declares exactly one calculation or administration pathway, including deterministic estimate, governed formula review, official registry, project method, not commenced, closed or non-certificate administration. Unsupported and unapproved paths fail visibly closed instead of returning a misleading zero.

The released SRES estimator covers 2026 through 2030 solar photovoltaic, wind, hydro, registered solar water heater, air-source heat pump and eligible solar-battery expected entitlements. It uses exact base-10 arithmetic, official final-step rounding, controlled inputs, source and effective-period identifiers, a complete calculation trace and deterministic input, trace, output and receipt hashes. Expected STCs remain separate from any future registry-accepted quantity.

## Milestone 35 owning workflow and files

- National program and activity coverage: `src/lib/australian-government-program-catalogue.ts` and `src/lib/australian-certificate-calculation-catalogue.ts`.
- Deterministic STC estimates: `src/lib/creditex-stc-estimator.ts`, `src/lib/bounded-json-request.ts` and `src/app/api/creditex/stc-estimates/route.ts`.
- Operator workflow: `src/components/CreditexVeuPilotWorkspace.tsx` and `src/components/CreditexVeuPilotWorkspace.module.css`.
- Regression evidence: `test/australian-government-program-catalogue.test.mjs`, `test/australian-certificate-calculation-catalogue.test.mjs`, `test/creditex-stc-estimator.test.mjs`, `test/creditex-stc-estimate-route.test.mjs` and `test/creditex-veu-pilot-workspace.test.mjs`.

## Milestone 35 safety boundaries

- The estimator returns an expected entitlement only. It cannot create, validate, register, trade or settle a certificate and cannot promise a customer rebate.
- VEU, ESS, PDRS, ACCU, LGC, REGOs, ACT EEIS and SA REPS remain non-executable unless their exact governing source bytes, formula assets and independent approvals exist.
- Closed and future activities are explicitly unavailable, not presented as formula-pending or current.
- The protected estimate route is authenticated, role-controlled, same-origin, no-store, streaming-body bounded to 16 KiB and non-mutating.
- No undocumented regulator endpoint is called. Registry, portal, CSV and partner connectors remain controlled disabled contracts.
- The Jobs register retains only the exact 23 supplied Dataforce columns; national programme and calculation fields remain in the calculation and audit workspaces.

## Milestone 35 validation and release evidence

- Exact application commit `5eab88950c1047746484ce2ab4880d8e32be824a` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,281 main tests with 1,279 passed, 2 intentionally skipped and 0 failed, all 111 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The focused national catalogue, estimator, protected route and operator-workspace suite passed 34 of 34. Independent final review found no remaining P1 or P2 defect and reconciled six live REC Registry oracle vectors.
- Archive `.openai/site-release-5eab889.tar.gz` is 7,598,597 bytes with SHA-256 `402682B1F6BB535EA63FDA1DA26B4D9A37D351445457C75A3612B86FDCB32C6F`, 360 entries, all 111 migrations and zero CSV entries.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_123d03e2e4b08191b196236068cca9b0` reports exact source `5eab88950c1047746484ce2ab4880d8e32be824a`, 346 stored files, 30,638,080 stored bytes and content hash `sha256:7ee3e873e71c98c648f2fba25ae6d0b83c30eb47b7a6a17bea2c422c14abd0dc`.
- Deployment `appgdep_6a6f2bac3b588191bb64b2b29c6e1b1b` succeeded as Sites version 265 with environment revision 19.

## Milestone 35 live production evidence

- Signed-in Chrome QA confirmed the 10-installer, 30-technician and 300-job VEU pilot still loads, with the exact 23 Dataforce headers and no added register column.
- Search, Refresh and Advanced search computed to the same 28-pixel height, border, background, text colour, font weight and radius in collapsed and expanded states. Advanced search exposed one drawer and the Status menu closed after an outside click.
- The Calculators panel reported 212 activities, including 6 estimate-available activities and 131 governed-formula-review activities, with zero certificate actions.
- Live calculations returned 45 expected STCs for the default PV vector and 164 expected STCs for a 40 kWh battery with a 1 May 2026 safety-certification date.
- NSW PDRS BESS3, BESS4, BESS5 and V2G1 showed `Activity Not Commenced`, WH1 showed `Activity Closed`, and current unapproved NSW formulas remained blocked.
- At actual 390-pixel and 320-pixel CSS widths there was no document overflow, the table retained its own horizontal scroll and the calculator stacked into one readable column.
- Browser review found only Chrome-extension asynchronous-channel warnings and no application exception.

## Milestone 35 important limits and unverified areas

- No single national government calculation API or documented public certificate-write API was found. TLink therefore needs effective-dated local rule assets, official calculator or registry reconciliation and separately authorised submission adapters.
- Exact current VEU, SRES and NSW source bytes are not yet retained in R2 with approved hashes and supersession links.
- Official participant, product, licence, recall, suspension, postcode-zone and model-register snapshots are not yet imported and independently approved.
- VEU, ESS and PDRS formula drafts, eligibility history and cross-claim logic remain non-executable.
- TESSA CSV v1.7, the current ESC VEU API pack and REC Registry bulk-upload adapters are not implemented.
- Physical iOS, Android, offline, GPS, EXIF, upload-recovery and R2-restore acceptance remain incomplete.
- External certificate creation, submission, trading and settlement remain disabled.

## Active milestone 37 contract

### One user outcome

Connect one locked manual form to the AEA Field test-device path and prove that the original bytes, capture time, device identity, EXIF, GPS, offline queue, retry and R2 restore all reconcile to the exact synthetic job and prompt without weakening a government requirement or enabling a real certificate action.

### Stop condition

Stop and open a new milestone before any real customer evidence, regulated case, certificate action, undocumented external integration, formula activation without retained exact bytes and independent approval, new paid service or change to tenant, identity or payment boundaries. Do not claim physical acceptance until the named iOS, Android, offline, metadata, GPS, upload-recovery and R2-restore matrix passes.

## Released milestone 34 outcome

Creditex now has an exact Dataforce job-list surface and governed authoring foundations without adding TLink-only fields to the operator register or enabling any regulated external action. The register exposes the exact 23 Dataforce headers in the exact Dataforce order, one job per row and one controlled row action embedded inside `App Id`. TLink governance fields remain available in the complete job audit workspace.

The released operator workflow provides:

- one desktop toolbar line ordered Density, all-field search, Search, Refresh and Advanced search, with every control 28 pixels high;
- the rightmost Advanced search control opening the compact right-edge drawer and restoring focus after close;
- compact 320-pixel and 390-pixel layouts that stay on one line with no document overflow;
- one exact 23-column Dataforce display, import, export and copy projection;
- one table-owned vertical and horizontal scroll surface, with no document-level desktop overflow;
- menu dismissal after outside action, Escape or selection;
- global all-field search and the complete double-click audit workspace;
- corrected official VEU version dates, with version 25 effective from 21 July 2026 and version 24 effective from 30 June 2026;
- explicit as-of and effective-window lookup approval and materialisation;
- append-only legacy mapping authoring and independent review; and
- draft-only calculator and golden-vector authoring whose vectors remain `not_run`.

## Milestone 34 owning workflow and files

- Exact register and responsive toolbar: `src/components/CreditexVeuPilotWorkspace.tsx` and `src/components/CreditexVeuPilotWorkspace.module.css`.
- Dataforce contract: `src/lib/creditex-dataforce-job-csv.ts`.
- Effective-dated lookup review: `src/lib/creditex-source-lookup-review-server.ts`.
- Legacy mapping authoring and review: `src/lib/creditex-legacy-mapping-authoring-server.ts`, `src/lib/creditex-legacy-mapping-guards.ts` and their protected routes.
- Calculator authoring: `src/lib/creditex-calculator-authoring-server.ts`, `src/lib/creditex-calculator-authoring-guards.ts` and its protected route.
- Schema and deployment-parser correction: `db/schema.ts`, migrations `0109` and `0110`, and `src/lib/creditex-schema-guards.ts`.

## Milestone 34 safety boundaries

- User-facing register columns are the exact 23 Dataforce columns only. TLink compliance and governance dimensions remain in the audit workspace rather than becoming extra register columns.
- Lookup approval is append-only, independently reviewed, explicitly as-of dated and constrained by authoritative effective windows.
- Mapping authoring cannot infer an unmapped source field or target path and cannot invoke Dataforce, Runabout or a registry.
- Calculator authoring remains draft-only. Test vectors remain `not_run`; no protected runner, approval or execution surface is exposed in this release.
- No mapping or calculator endpoint can create a certificate, submission, trade or settlement.
- The controlled VEU population remains synthetic and cannot become regulated work.

## Milestone 34 validation and release evidence

- Primary application commit `58b92e1f859c62de00e4d8bda11624ab3f1633b8` passed the complete application review. Corrective application commit `31b152933273db33bfa866bdbc491f6fdc35360a` moved calculator trigger installation into the existing prepared-statement schema-guard path after Sites migration parsing rejected trigger bodies containing internal semicolons.
- Exact corrective commit `31b152933273db33bfa866bdbc491f6fdc35360a` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,267 main tests with 1,265 passed, 2 intentionally skipped and 0 failed, all 111 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The targeted operations, calculator and schema suite passed 49 of 49. Independent migration and final review reported READY with no P1 or P2 defect.
- Corrected archive `.openai/site-release-31b1529.tar.gz` is 7,575,785 bytes with SHA-256 `0AE7AA64CE6D9B93D0A0D6DA65CEC1F11F1ADA8D4D1451E60EEDDD2AF38D87C5`, 360 entries, all 111 migrations, zero CSV entries and zero `CREATE TRIGGER` statements in `0110_creditex_calculator_authoring.sql`.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_aa8d0183098881918f1fe626a7deb951` reports 346 stored files, 30,535,680 stored bytes and content hash `sha256:7add92fd081d36220e266666533ce162585bcf23531889182f7abbbd982a8ea2`.
- Deployment `appgdep_6a6f09034b10819187e46054254b06b2` succeeded as Sites version 264 with environment revision 19.
- Sites version 263 was saved from `58b92e1f859c62de00e4d8bda11624ab3f1633b8`, but deployment `appgdep_6a6f0208b8208191ba75d01cd0b659d8` failed before activation with `incomplete input: SQLITE_ERROR`. Sites version 262 remained live, no production change occurred and version 263 was not redeployed.

## Milestone 34 live production evidence

- Signed-in administrator QA confirmed 10 of 10 installers, 30 of 30 field technicians, 300 of 300 jobs and all 34 activity families.
- The register rendered the exact 23 Dataforce headers in order, 23 cells per row and 300 controlled row actions. TLink-only governance fields were absent from the register and available inside the audit workspace.
- At desktop size, the table owned its 3,540 by 9,576 scroll area with no document overflow. At 320 and 390 pixels the toolbar remained one line with no document overflow.
- The toolbar stayed on one line in the order Density, search field, Search, Refresh and Advanced search, with every control 28 pixels high.
- Global search for `I01-T01` returned 10 of 10 jobs; reset restored 300 of 300.
- Advanced search opened exactly one dialog containing 25 controlled selects, focused Close first and returned focus to Advanced search on close. A column sort menu closed on outside action.
- Primary tabs remained at approximately 53 pixels and pilot tabs at approximately 143 pixels across every panel. Double-click opened the complete audit workspace.
- Browser review found only Chrome extension asynchronous-channel warnings and no application exception.

## Milestone 34 important limits and unverified areas

- Exact v24 and v25 source bytes have not yet been retained in R2, hash-verified and independently approved.
- The first official participant, product, licence, recall and suspension cohort has not yet been imported and approved.
- Physical iOS, Android, offline, upload-recovery and R2-restore acceptance remain incomplete.
- Calculator drafts and authoritative golden vectors remain unapproved and cannot execute.
- The first mapping artifact and authorised Dataforce-bound parallel receipt remain incomplete. Runabout and registry sandbox contracts remain unavailable.
- External certificate creation, submission, trading and settlement remain disabled.

## Prior released milestone 33 outcome

Creditex now has the governed approval and parallel-operation foundations needed to move retained government material, operational lookup snapshots, physical-device custody evidence, official formulas and exact Dataforce references through independent review without allowing an unapproved item to become a rule, eligibility result, certificate, submission, trade or settlement.

The released operator workflow also closes the presentation defects raised during production review:

- Operations, VEU test pilot and Government rules keep one dark visual system and one fixed 36-pixel primary tab bar in the same position;
- Pilot control, Jobs, Sources, Lookups, Evidence, Calculators and Connectors keep one clear, fixed 35-pixel inner tab bar in the same position on every panel;
- the Jobs toolbar is ordered Density, all-field search, Filters and Refresh, with every control 28 pixels high;
- the global search covers every populated scalar job, customer, site, installer, technician, work and appointment field;
- advanced search is a compact right-edge drawer and the removed installer/activity-family bottom rail does not return;
- column option menus close on outside action, Escape or selection; and
- the full job audit workspace now uses the same dark palette, with independent scrolling for its main record and compliance rail.

The five governed foundations delivered in this milestone are:

1. an append-only official-source approval bridge with exact R2 object, SHA-256, binding, reviewer separation and current-approval checks;
2. an operational-lookup approval bridge that verifies every row hash, row count and aggregate records hash before materialisation;
3. tester-authored physical-custody acceptance with a distinct governance decision, exact artifact hashes and append-only database protection;
4. a deterministic version-2 exact-decimal calculator engine with canonical receipts and contract hashes; and
5. exact, case-sensitive Dataforce Job ID and App ID bindings with immutable server-generated comparison receipts and insert-time approval guards.

## Milestone 33 owning workflow and files

- Portal and dark workspaces: `src/components/CreditexCompliancePortal.tsx`, `src/components/CreditexVeuPilotWorkspace.tsx`, `src/components/CreditexOperationsWorkspace.module.css`, `src/components/CreditexEvidencePolicyGovernance.module.css` and `src/components/CreditexVeuJobAuditWorkspace.module.css`.
- Source and lookup approval: `src/lib/creditex-source-lookup-review-server.ts` and the protected official-source and lookup review routes.
- Field custody: `src/lib/creditex-field-custody-acceptance-server.ts` and its protected API route.
- Calculator: `src/lib/creditex-calculator-engine.ts`.
- Dataforce parallel operation: `src/lib/creditex-parallel-reconciliation-server.ts` and `src/app/api/creditex/parallel-reconciliation/route.ts`.
- Schema: `db/schema.ts`, `src/lib/creditex-schema-guards.ts` and migrations `0106` through `0108`.

## Milestone 33 safety boundaries

- Approval is append-only and requires a governance identity distinct from the retained-source or tester identity.
- Withdrawing the latest approval blocks subsequent activity use, lookup materialisation and calculator execution; insert-time guards close the approval-withdrawal race.
- Physical-custody acceptance proves only the exact tester artifact reviewed. It does not generalise to an untested device, operating system, offline path or field activity.
- Calculator receipts are deterministic and immutable, but no official VEU formula has yet been independently approved for certificate estimation.
- Dataforce reconciliation is non-evidentiary and exact-reference bound. It cannot create a certificate, regulator submission, trade or settlement.
- Runabout and registry interfaces remain unconnected, and real regulated work remains disabled.

## Milestone 33 validation and release evidence

- Exact application commit `11b06b88d68609a9fcf254877a4afe379a95f8b3` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,244 main tests with 1,242 passed, 2 intentionally skipped and 0 failed, all 109 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The integrated Creditex suite passed 110 of 110 tests; the UI suite passed 40 of 40. Independent security review approved the source, lookup, custody, calculator and Dataforce boundaries with no P1, P2 or P3 blocker. Independent UI review passed the corrected contrast and compact-control gates.
- Local archive `.openai/site-release-11b06b8.tar.gz` is 7,544,418 bytes with SHA-256 `E0F5B94C49CCA3776F3CEE2734C076F33F2E59324A301A211A7F55A6B94BACE4`, 358 archive entries and all 109 migrations.
- Saved Sites version `appgprj_6a550c378000819185caf094173422bb~appgver_f2d304f9c9b481919b8d9588f0ef034f` reports exact source `11b06b88d68609a9fcf254877a4afe379a95f8b3`, 344 stored files, 30,412,800 stored bytes and content hash `sha256:60ede71e262e365ed8aa39fced47e8a550623266d6636ef8c326a821efdadb3c`.
- Deployment `appgdep_6a6edfb2b8e08191b295825c3db65d4d` succeeded as Sites version 262 with environment revision 19.
- Signed-in production QA confirmed all three primary tabs at the same 52.7-pixel top position, all seven pilot tabs at the same 142.7-pixel top position, a working all-field technician-code search returning 10 of 300 jobs, 28-pixel Density/Search/Filters/Refresh controls, compact right-edge filtering, outside-click sort dismissal and the dark double-click audit workspace.
- The audit main pane and compliance rail exposed independent vertical scrolling. Recent Worker logs contained no Creditex failure; the only error in the review window was an unrelated existing `/api/trade-job-notifications` HTTP 500 from the Direct Trade dashboard.

## Milestone 33 important limits and unverified areas

- Exact current VEU source bytes have not yet been retained in TLink R2 and independently approved through the new bridge.
- Authorised participant, product, licence, recall and suspension snapshots have not yet been imported and approved.
- Physical iOS, Android, offline, upload-recovery and R2-restore acceptance remain incomplete.
- Approved official formulas and authoritative golden vectors remain 0.
- Runabout and registry sandbox contracts remain unavailable, and routine Creditex use still requires named individual MFA accounts rather than the shared bootstrap administrator.

## Prior released milestone 32 outcome

Creditex now has the controlled post-acceptance intake foundations needed to receive an installer job, stage legacy Dataforce records, retain official-source and evidence bytes, review effective-dated operational facts and compare external references without claiming a real certificate outcome. Government and regulators remain the sole rule authority; Creditex administers, audits and submits within those rules.

The released operator workflow provides:

- a dark, full-viewport job register with table-owned scrolling and a compact right-edge advanced-search drawer;
- installer and VEU activity filtering only inside advanced search, with the fixed bottom activity-family rail removed;
- heading menus that close after sort selection, outside pointer action or Escape and restore focus;
- one exact 23-column Dataforce interchange contract for filtered CSV export and stage-only CSV import;
- UTF-8 BOM, CRLF and spreadsheet-formula-safe exports, with a 20,000 matching-row export ceiling;
- exact-header, 5 MiB and 2,500-row import limits, duplicate detection and no silent coercion;
- a governed post-quote-acceptance installer intake with dependent Program, Activity, Product category and Scenario selectors;
- immutable accepted-scope hashes derived from the accepted commercial handoff at the application boundary;
- manual official-source byte custody in R2 with asserted government URL, SHA-256, pending-review state and no automatic activation;
- evidence-object integrity receipts, effective-dated staged lookup snapshots and non-evidentiary external-reference comparisons; and
- fail-closed schema preflight before the trigger installation that protects synthetic and regulated records.

The supplied private Dataforce export remained local. It proved an exact 23-header, 849-row, zero-rejection, zero-duplicate and exact cell-preserving round trip with SHA-256 `22470CED083B3BAA4571108E34B5F91BD89154AD8381B54B693B3F9BDEF9BF31`; it was not uploaded, committed, packaged or published.

## Milestone 32 owning workflow and files

- Register and interaction: `src/components/CreditexVeuPilotWorkspace.tsx` and `src/components/CreditexVeuPilotWorkspace.module.css`.
- Dataforce interchange: `src/lib/creditex-dataforce-job-csv.ts`, `src/lib/creditex-dataforce-import-server.ts` and `src/app/api/creditex/dataforce/route.ts`.
- Post-acceptance intake: `src/components/TradeComplianceIntake.tsx`, `src/lib/trade-commercial-handoff.ts`, `src/lib/trade-commercial-handoff-server.ts`, `src/lib/creditex-compliance-server.ts` and `src/app/api/trade-compliance/route.ts`.
- Source, evidence, lookup and comparison foundations: `src/lib/creditex-official-source-custody-server.ts`, `src/lib/creditex-evidence-integrity-server.ts`, `src/lib/creditex-operational-lookup-server.ts` and `src/lib/creditex-parallel-reconciliation-server.ts`.
- Schema: `db/schema.ts`, migrations `0100` through `0105`, and `src/lib/creditex-schema-guards.ts`.
- Sites migration packaging and audit: `build/sites-vite-plugin.ts` and `scripts/audit-sites-server-bundle.mjs`.

## Milestone 32 safety boundaries

- CSV import is stage-only. It cannot create or mutate a customer, job, regulated case, certificate, registry submission, trade or settlement.
- Manual official-source custody stores asserted provenance and bytes as pending review; it does not establish that the source is current, official or approved.
- R2 evidence receipts prove stored-object integrity only. They do not prove physical capture, device provenance, GPS truth or activity compliance.
- Operational lookups are staged and effective-dated but the authorised government adapters and approval mappings are not connected.
- The accepted-scope hash is application-derived and is not yet enforced by a database constraint.
- One active compliance case per work order remains enforced, so a combined VEU and STC claim cannot yet be represented.
- Parallel references are caller-supplied and non-evidentiary until they are bound to immutable legacy imports and authorised registry responses.
- External certificate creation, registry submission, trading and settlement remain disabled.

## Milestone 32 live production evidence

- Signed-in production opened as `AEA Creditex administrator · Admin` and rendered all 300 isolated synthetic jobs.
- Live D1 exposed 202 application tables. `compliance_cases` exposed 21 columns including `commercial_handoff_id`, `accepted_quote_version_id` and `accepted_scope_sha256`.
- The dark full-screen register, narrow advanced-search drawer, one installer selector, one activity selector, absent bottom activity rail and closed-after-sort heading menus were visually verified.
- The Lookups and Evidence panels own their vertical scrolling; the Evidence panel reported a 895-pixel viewport and 913-pixel scroll extent with `overflow-y: auto`.
- A live filtered export produced 300 rows and the exact 23 Dataforce headers with zero formula-leading cells; SHA-256 `E1399F3F3146C8AF361FC1E59DD094CB2704F7ABC5F4D6C11B757D8F11F9E2CC`, 167,159 bytes.
- The Sites worker error-only query after deployment returned zero events.

## Milestone 32 validation and release evidence

- Exact primary application commit `c423f3c3938b43bf92c8ec98d285b49e63024ee6` passed the complete release gate and was saved as Sites version 260.
- Version 260 deployment `appgdep_6a6eb18712108191ab4ebab327e75df7` technically succeeded but was operationally blocked because the package omitted migrations `0100` through `0105`. The session request entered the unpreflighted guard batch; D1 rejected a trigger that referenced a missing table and rolled back the batch, so no new schema triggers persisted.
- Corrective commit `d441d41cad4d5299a882e73ea006a963fa360cf4` packages and audits all 106 migrations and preflights the new Creditex schema before any trigger batch.
- `npm.cmd run validate` passed type checking, warning-free lint, 31 of 31 integration tests, the complete 1,220-test main suite with 1,218 passed and 2 intentionally skipped, all 106 migrations through `0105_creditex_parallel_reconciliation.sql`, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The focused compliance suite passed 62 of 62 tests. `git diff --check` passed. Independent review reported no P0 or P1 defect.
- Local archive `.openai/site-release-d441d41.tar.gz` is 7,511,787 bytes with SHA-256 `FFBDCAFEA54E7FF72AD1E8E19B0983193E8C554583E3248129CD5E9FEAAE8CB1`, 355 archive entries and all 106 migrations.
- Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_138b4cc8cf988191a4f3e4be4404a6d6` reports exact source `d441d41cad4d5299a882e73ea006a963fa360cf4`, 341 stored files, 30,177,280 stored bytes and content hash `sha256:9b6fd4e639695ea43eb2623fb495b680c6130e7d1539abb3c645b0291898c2b1`.
- Sites version 261 deployment `appgdep_6a6eb97d1978819180b729e922f33971` succeeded with environment revision 19.

## Milestone 32 important limits and unverified areas

- The real governed inventory is still 0. No activity, evidence policy, calculator or regulated case is approved for live use.
- The schema preflight proves required objects and columns exist but does not fingerprint every index, trigger or CHECK definition; partial schema drift remains a P2 risk.
- Exact authorised source approval, operational government adapters, physical AEA Field custody, an independently approved calculator, immutable legacy-import binding and an authorised registry sandbox remain incomplete.
- Routine Creditex use still requires named individual accounts, least privilege and MFA rather than the shared bootstrap administrator.

## Prior milestone 31 outcome

Creditex now has a more readable and compact full-viewport VEU operator workspace while preserving TLink's owner scope, private-data controls and fail-closed government compliance boundaries. The controlled dataset remains 10 synthetic installer companies, 30 assignment-only field technicians and 300 synthetic jobs across all 34 represented VEU activity families.

The released operator workflow provides:

- one readable 12-pixel compact table row per job, 49 data columns plus one action column, 41 verified server-sortable fields and one controlled menu on every heading;
- table-owned vertical and horizontal scrolling without page-level desktop overflow;
- compact and comfortable density controls;
- a 19-rem advanced-search drawer with Job, installer, VEU activity, review state and evidence state together as quick filters;
- secondary advanced-search groups collapsed initially, with the former installer roster removed from the bottom of the workspace;
- column menus that close after sorting, outside pointer action or Escape and return focus to their heading;
- Dashboard plus all 34 VEU activity-family tabs along the bottom;
- Dataforce-style Customer Details, Job and Appointment context menus from right click, the row action control or keyboard;
- Job Summary, Appointments, Actions, Questions, Quote and Invoice, Calculations, Transactions, Files, Issues, Emails and History routes;
- Appointment Summary, Actions, Questions, Certificate Submissions, Decommissioning, Correspondence, Audit and History routes;
- Copy Row, truthful disabled Copy Selection, Print and Print Preview actions;
- a full-viewport double-click record workspace with collapsible navigation and compliance rails;
- owner-scoped customer, private notes, service address, installer account, technician, work, appointment, job, source, lookup, evidence, calculator, connector and audit facts;
- media presence, metadata, GPS and original-hash indicators derived only from bounded authoritative evidence facts; and
- job-level regulated-case, compliance-evidence and submission-item counts rather than run-level substitutes.

Part `6` remains one official VEU family among many. Categories and scenarios remain separate governed dimensions. `6(23)` was only an informal example and has no privileged implementation path.

The official source register now records Victorian Energy Upgrades Specifications version 25 as effective from 21 July 2026, keeps version 24 as superseded comparison material and records both Part 6 branches in version 25. It does not treat 30 September 2026 as a separate instrument. Government and regulator sources remain the only rule authority.

The installer-dashboard integration is currently a proposed post-quote-acceptance handoff, not released runtime behavior. TLink will derive accepted job, site, jurisdiction, date and scope facts server-side, then expose controlled Program, Activity, Product category and Scenario choices tied to an effective source version. One active case per work order and the zero-program fail-closed state are mandatory boundaries.

## Prior milestone 31 owning workflow and files

- Schema and migration: `db/schema.ts`, `drizzle/0099_creditex_synthetic_pilot.sql` and `src/lib/creditex-schema-guards.ts`.
- Pilot contracts and server: `src/lib/creditex-veu-pilot-contract.ts`, `src/lib/creditex-veu-pilot-server.ts` and `src/app/api/creditex/pilot/route.ts`.
- Register and drawer: `src/components/CreditexVeuPilotWorkspace.tsx` and `src/components/CreditexVeuPilotWorkspace.module.css`.
- Full record workspace: `src/components/CreditexVeuJobAuditWorkspace.tsx` and `src/components/CreditexVeuJobAuditWorkspace.module.css`.
- Portal: `src/components/CreditexCompliancePortal.tsx`.
- Government-source reference: `src/lib/australian-government-program-catalogue.ts`.
- Official-source register: `docs/compliance/AUSTRALIAN_PROGRAM_SOURCE_REGISTER.md`.
- Proposed installer handoff contract: `docs/compliance/CREDITEX_OPERATING_MODEL.md`.
- Tests: `test/creditex-veu-pilot.test.mjs`, the Creditex portal and operations suites, and the Australian programme catalogue suite.

## Prior milestone 31 safety boundaries

- All pilot companies, technicians, customers, sites, appointments and jobs are visibly synthetic and isolated from regulated workflow.
- Same-origin Firebase identity and active Creditex membership checks precede every dashboard and record read.
- Job detail requires an active organisation-owned synthetic run, a synthetic trade account, an assignment-only technician and an active owner-scoped synthetic work order.
- Private customer, installer and service-site data is loaded only after the scoped job identity is established.
- Raw evidence envelopes, storage keys and direct file bytes are not returned to the operator workspace.
- Audit writes require a successfully matched authoritative detail response and an allowed role.
- The pilot creates no regulated case, certificate, submission, trade or settlement.
- External submission, forced compliance, Dataforce import and Runabout import remain disabled.

## Prior milestone 31 production evidence

- Signed-in production QA at 2048 by 927 pixels loaded the complete 300-job queue with no page-level overflow and a readable 12-pixel table type size.
- The advanced drawer measured 303.2 pixels, exposed Job, installer, VEU activity, review state and evidence state as quick filters, and started with every secondary group collapsed.
- Installer `I01` returned 30 matching jobs. Combining installer `I01` with Part `6` returned one matching job, and clearing filters restored 300 jobs.
- The workspace contained exactly one installer selector and one VEU activity selector. The former installer roster was absent, while Dashboard plus all 34 activity-family tabs remained.
- The Job ID column menu closed on outside pointer action, Escape and a selected sort action. Escape and sort selection restored focus to the originating heading.
- The final version-259 drawer showed `All VEU jobs` without the crowded count badge.

## Prior milestone 31 validation and release evidence

- Exact application commit `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete main suite, all 100 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The focused Creditex pilot suite passed 15 of 15 tests. `git diff --check` passed.
- Independent final review reported no P0 or P1 defect.
- Primary application commit `96ecb9698943445c57ba7f4caec99ff3839d3499` became intermediate Sites version 258 through deployment `appgdep_6a6e507b745881919113bda7403f8081`.
- Final local archive `.openai/site-release-19a1e0b.tar.gz` is 6,894,158 bytes with SHA-256 `605BEE1AC610C7D4F82BD9CEBD5C2706B55BFB7F73B2640D1D5FBB6F041B21FF`.
- Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_195313bad4888191a7b5472c6b215cc5` reports exact source `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1`, 178 stored files, 18,780,160 stored bytes and content hash `sha256:81e8a258e445954acf669266c31c6fd7141d591925ff30148b6f70c4118172e9`.
- Sites version 259 deployment `appgdep_6a6e5248b7048191acfe5904b1d4628b` succeeded with environment revision 19.

## Prior milestone 31 limits and unverified areas

- Exact authorised VEU source bytes, hashes, effective periods, the Version 24 to 25 clause diff and current accredited-provider portal artefacts are not yet retained and independently approved inside TLink.
- The post-acceptance installer handoff is a documented contract only. It is not active runtime behavior while the governed programme inventory remains empty.
- Live participant, accreditation, licence, product, recall and suspension sources are not connected.
- Physical-device evidence capture, original-byte restoration, offline recovery, GPS and metadata custody are not yet proven for a selected real activity.
- Verified formulas and approved golden vectors remain 0. No VEEC quantity or rebate is calculated.
- Registry, Dataforce and Runabout connectors remain dry-run or disabled. No external request was sent.
- The shared `info@ausenergyassessments.com` account remains a bootstrap administrator. Routine Creditex operations require named individual users and least privilege.
- The two bounded job-detail reads are not one D1 snapshot. This is acceptable for the immutable synthetic pilot, but regulated cutover needs an explicit consistency contract.

## Stop conditions

Stop before any regulated-case onboarding when:

- an exact current instrument and its effective dates are not retained and independently verified;
- an activity category and scenario combination is inferred rather than sourced;
- an authorisation, tenant-isolation or synthetic-leakage guard fails;
- original photo bytes, hashes, capture time, timezone, device provenance, location accuracy and controlled metadata cannot be retained together;
- a calculator would use unverified equations, tables, units, caps or rounding;
- a connector would assert a regulator response without an authorised request and immutable response artifact; or
- D1 and R2 ownership, backup, export, recovery and restore remain unproved for regulated evidence.

## Superseded next-five sequence before milestone 32

1. **Retain and independently approve the exact VEU source pack:** retain the authorised bytes, hashes, effective periods, Version 24 to 25 clause diff, Part 6 branch-trigger semantics and current accredited-provider portal artefacts before publishing any governed activity.
2. **Implement the direct-trade post-acceptance handoff:** remove compliance selection from initial job setup, derive accepted job facts server-side, add the controlled installer panel and enforce one active case per work order while the zero-program state remains fail-closed.
3. **Connect authoritative operational lookups:** add effective-dated participant, product, licence, recall and suspension snapshots with source timestamps and fail-closed rechecks.
4. **Prove AEA Field evidence custody:** complete real-device iOS, Android, offline, original-byte, metadata, GPS and R2 restore evidence for one independently approved activity.
5. **Run one verified end-to-end parallel activity:** reconcile an independently approved calculator, golden vectors, authorised Dataforce and Runabout mappings and a registry sandbox or approved interface without touching real certificate inventory.

## Superseded next-five sequence after milestone 35

1. **Retain and approve the exact current rule packs:** store the exact VEU v24/v25, SRES law and register, and NSW ESS/PDRS source bytes in R2 with SHA-256, effective dates, supersession links and named independent approvals.
2. **Replace manual inputs with official effective-dated lookups:** import participant, product, licence, recall, suspension, postcode-zone and model-register snapshots so supported installer choices become authoritative dropdowns.
3. **Implement reviewed VEU and NSW calculation drafts:** transcribe VEU, ESS and PDRS formulas with premises-history and cross-claim eligibility, deterministic receipts and regulator-oracle golden-vector reconciliation while keeping activation independently gated.
4. **Build authorised submission interchange:** implement TESSA CSV v1.7 import, export and preflight, then obtain the current ESC VEU API pack or sandbox and REC Registry bulk-upload contract before enabling controlled adapters.
5. **Connect installer cases to field evidence custody:** bind post-acceptance job creation to the selected program and activity, generate its evidence template, and complete named iOS, Android, offline, GPS, EXIF, upload-recovery and R2-restore acceptance.

## Prior released milestone record: `CUSTOMER-TRADE-LOCALITY-24`

Status: released implementation milestone

Released application commit: `399b04f4a5d680080610f9e88b994506bb60c16f`

Released application: Sites version 242, saved version `appgprj_6a550c378000819185caf094173422bb~appgver_bc9f3157a9e88191881c5989f7de7ba0`, deployment `appgdep_6a6cc08dc6f881919a349de607f5a8a9`

The release keeps installer-request consent and validation beside submission, aligns the shared customer navigation, adds reciprocal TLink and Australian Energy Assessments branding and discloses only a current-consented immutable suburb, postcode and state opportunity snapshot to eligible installers. Migration `0092_trade_opportunity_matching_locality.sql` added the bounded locality and consent-receipt contract. The focused set passed 96 of 96 tests and the complete validation gate passed all 93 migrations through `0092`, the production build and Sites bundle audit. Live verification did not create a new production opportunity, so a version-242 locality-bearing row and business email remain intentionally unverified. This milestone was superseded as the current production identity by the Creditex foundation, the signed-in Creditex operations portal in version 248, the evidence-policy governance system in version 249 and the government-activity workflow in version 251.

## Prior released milestone record: `CUSTOMER-ACCOUNT-TRUST-23`

Status: released implementation milestone

Prepared: 31 July 2026

Released application commit: `da4fa911c0b6c7f520e266259af8882b95aaf14a`

Released application for this milestone: Sites version 241 from application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`

## Current milestone outcome

Make the remaining household ventilation questions answerable without technical building knowledge, make the email account form visibly usable, and make the Firebase customer-verification return refresh the trusted account identity instead of relying on a stale token.

## Customer and trade outcomes

- Public `/plan` and the signed-in project builder now ask the same plain question: whether a kitchen exhaust fan or rangehood and a bathroom exhaust fan are fitted.
- The choices are kitchen, bathroom, no kitchen or bathroom fan, and `Not sure`. The household is explicitly told that it does not need to know where a fan vents or whether it has a shutter or damper.
- Legacy discharge and damper answers are retained only as a conservative `Not sure` migration when no newer explicit fan answer exists.
- Technical discharge-path confirmation is deferred to a property manager or suitably qualified trade only when moisture, steam or smells do not clear.
- Every email-account input, including the password, is a visible full-width control with a persistent eight-character requirement.
- Create-account and sign-in choices are equal-width responsive tabs with a clear selected state, hover and keyboard focus treatment.
- Customer verification uses Firebase's hosted action handler with an authorised current-origin return to `/account?verification=complete`.
- On return, focus or visibility refresh, the customer identity is reloaded and a fresh ID token is obtained before a verified state is trusted.
- Verification-send failure is reported as failure instead of being silently represented as successful delivery.
- Existing trade signup and verification behavior was not changed by this customer-only milestone.

## Integrity and communication design

- One shared home-feature taxonomy drives the public and private planners, evidence readiness, report projection and deterministic advice.
- The simplified question records only what an ordinary household can safely see. It does not imply that fan discharge or airtightness has been checked.
- Legacy technical answers are never guessed into a specific modern fan selection.
- Firebase remains the verification-code processor. The application supplies the bounded return URL, then refreshes provider state and the token before server-backed account data is trusted.
- Account status messages distinguish information, success and error and keep field errors associated with the relevant control.
- The customer helper is imported only by the customer account panel and dashboard. The trade signup source content remains identical to the prior release.

## Acceptance and release evidence

- Exact application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a` passed the complete release gate.
- The integrated focused customer taxonomy, decision-support, account UI and verification set passed 72 of 72 tests. Independent account and verification review passed 18 of 18 tests, trade-isolation review passed 25 of 25 tests, and type checking passed.
- `npm.cmd run validate` passed, including type checking, warning-free lint, the integration and full test suites, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the nine-page customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- `git diff --check` passed. An independent final read-only review reported no actionable defect.
- GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA.
- Sites version 241 was saved directly from the exact managed source commit and deployed publicly. No local release archive was uploaded or supplied for this release, so archive size, archive hash, stored-file count, stored bytes and package content hash are not claimed.
- Live public production verification confirmed the simple fan question and absence of customer-facing discharge-path and damper questions.
- Live account-entry verification measured a visible 364 by 48 pixel password control and equal 175 by 46 pixel tabs at the desktop viewport, with no horizontal overflow.
- The live `/account?verification=complete` route rendered the customer account entry rather than an application route error.
- Local 390 by 844 visual inspection confirmed responsive tab and password-control layout.
- A new provider email was not sent during release QA, so newly generated email receipt and action-code processing remain unverified.
- The Sites Worker error-only query returned zero events. Release verification made no production data mutation.

## Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Current executable application commit: `da4fa911c0b6c7f520e266259af8882b95aaf14a`
- Sites application version: 241
- Sites saved-version identity: `appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7`
- Sites production deployment: `appgdep_6a6caabc547c81919c4642b1f7cfcde1`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites access: public custom domain
- Sites environment revision: 19
- D1 migration count: 92, through `0091`
- Immutable audit changes: none
- Working-demo data changed during release verification: none

## Known release risk

The shared household taxonomy, account presentation, customer verification settings, trusted-state refresh and live return route passed automated and production presentation checks. Release QA did not create a new account or send a verification email, so provider inbox receipt and a fresh end-to-end email action remain unverified. Existing trade verification debt identified during review is outside this customer-only milestone and was not changed or represented as fixed. No local archive or Sites package metrics were supplied for this source-only save. Production provider inbox receipt and hosted row counts remain unverified.

## Stop conditions

Stop the affected path when:

- public and signed-in planners present different exhaust-fan choices;
- a household is required to know fan discharge, backdraft-damper or self-sealing details;
- a legacy technical answer is guessed into a specific modern household answer;
- the password control is clipped, transparent, too small or not associated with its requirement;
- account tabs do not expose a selected state or become uneven or unusable at a supported viewport;
- a customer verification link returns outside the authorised current site or a verified account is trusted before Firebase identity and token refresh;
- verification-send failure is represented as successful delivery;
- live verification would send to an unapproved recipient or mutate new demo data;
- the release source, saved version and public deployment cannot be reconciled; or
- a change would alter the immutable dated audit.

## Prior released milestone: `CUSTOMER-PLAN-TRADE-ENQUIRY-22`

### Outcome

The prior release added the privacy-first `Enquire with verified trades` bridge, preserved every public planner selection through account entry, added precise gas hot-water and reported electrical-phase choices, and placed authorised customer identity first for connected trade leads. Its technical exhaust-discharge and damper questions are superseded by the plain household fan question in `CUSTOMER-ACCOUNT-TRUST-23`; the enquiry bridge, hot-water, electrical and connected-lead contracts remain active.

### Historical release identity

- Application commit: `b40c101939eec44b178b34ccb6397a989d2467d0`
- Sites version: 240
- Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40`
- Deployment: `appgdep_6a6c971b63988191a92e4031fc74692b`
- Environment revision: 19

## Prior released milestone: `CUSTOMER-TRADE-CONTACT-21`

### Outcome

The prior release replaced shortlist and quote-acceptance language with one contact-only customer choice, committed the exact one-business contact handover atomically, added owner-scoped new-lead Work updates, collapsed lead cards, aligned quote fields and returned Continue navigation to the active project step. Those privacy, contact and navigation contracts remain active beneath the public-plan enquiry and connected-lead presentation added by the current milestone.

### Historical release identity

- Application commit: `97e6c7356483706e8e978ab53b842a9e41152f7e`
- Sites version: 239
- Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c`
- Deployment: `appgdep_6a6c7cb6d6e0819187e9566a452e6850`
- Environment revision: 19
- Local archive: `aea-sites-97e6c73.tar.gz`, 7,127,725 bytes, SHA-256 `BF9EAAE34B1FBB197C30AF94F0ADB9DBE92BBC347F8B60424C6D0444D9FCD7DF`
- Sites package evidence: 321 stored files, 27,985,920 bytes, content hash `sha256:8554bdbdbcc6c54afc9b04cb4d37b96d7ab423ed2ed64d591247bfa3ee6c6136`

Signed-in production verification confirmed three unread new-lead bell items, default-collapsed lead cards, exact expansion, the top-level Quotes centre and contact-only connected state. Production provider inbox receipt and hosted row counts remained unverified.

## Earlier released milestone: `CUSTOMER-QUOTE-COMMS-20`

### Outcome

The prior release added the top-level customer Quotes centre, exact quote deep links, customer and trade quote emails, trade Work updates, retry-safe quote submission and a concurrency-safe one-business claim. Its customer-visible shortlist and acceptance sequence is superseded by `CUSTOMER-TRADE-CONTACT-21`; its durable delivery and immutable quote-submission contracts remain active.

### Historical release identity

- Application commit: `35552796048df63c03409d03401d33a47f326434`
- Sites version: 238
- Saved version: `appgprj_6a550c378000819185caf094173422bb~appgver_c9b4dbcee8408191a3fdce1aaef5548d`
- Deployment: `appgdep_6a6c5f96df388191a5e68ffd53fb68b0`
- Environment revision: 19

The historical release used acceptance wording for its one-business selection. Current customer and trade surfaces use contact-only wording, and the retained internal accepted identifier is compatibility state rather than commercial acceptance.

## Earlier released milestone: `CUSTOMER-INSTALLER-HANDOFF-19`

### Outcome

Make one customer confirmation complete the installer handoff quickly and visibly: save the private request, share the complete privacy-safe plan plus every customer-uploaded photo with each exact allocated installer, and send durable email alerts to both operations and the allocated businesses.

The request must not look frozen while background matching and delivery continue. The customer-facing response must finish after the authoritative request and durable follow-up work are recorded, not after external email providers, administrator webhooks or installer allocation have completed.

### Owning workflow and expected files

- Customer request and durable follow-up: `src/app/api/customer-projects/route.ts`, opportunity allocation helpers, notification delivery helpers, `worker/index.ts` and an additive D1 migration if required.
- Evidence and full plan delivery: `src/app/api/customer-project-evidence/route.ts`, `src/app/api/trade-opportunities/route.ts`, the authoritative customer-plan document and PDF projection, and installer Leads UI.
- Customer progress feedback: the saved-project advisor component and its feature-local styles.
- Tests: focused customer-submit, evidence authorization, plan projection, admin delivery, business delivery, worker and UI contracts.

### In scope

- Treat the final confirmed installer request as explicit consent to share every active photo uploaded to that project with exact allocated installers while the match remains active. Uploaded PDFs and other documents retain their separate explicit sharing choice because their contents cannot be automatically privacy-filtered.
- Reconcile older matching demo projects through the same project-level request consent without manufacturing synthetic production rows.
- Present every shared photo in the lead and provide a protected download for every shared document.
- Present the complete ordered privacy-safe customer plan in the lead and provide its complete installer-safe PDF, not a three-step extract.
- Record durable allocation, operations-email and business-email work before returning success.
- Drain newly recorded work immediately outside the customer response and retain the scheduled worker as the recovery path.
- Send an operations email for every new customer installer request and one business email for each new eligible allocation.
- Keep provider idempotency, bounded retry, bounce and complaint suppression, delivery events and recipient revalidation.
- Show immediate, accessible progress feedback with clear stages, elapsed-time reassurance and a success transition.
- Measure and record the production request duration with a dedicated working-demo fixture only when the live test can avoid real customer or business impact.

### Out of scope

- Releasing customer identity, exact address, contact details, private notes, room names, routines, permission notes, adviser identity or meter data before separate direct-contact approval.
- Changing reviewed-ABN access or the exact allocated-installer authorization boundary.
- Creating real customer, trade, wholesaler or administrator accounts.
- Broad CRM redesign, unrestricted messaging, quoting automation or pilot execution.
- Netlify deployment or changes to the immutable dated audit.

### Acceptance criteria

- Submission returns without awaiting installer allocation, the administrator webhook, Resend or another external provider. Automated timing contracts prove those slow dependencies cannot extend the customer response.
- The confirmation button changes immediately to an accessible multi-stage progress state. A request taking longer than eight seconds explains that it is still working, and success or failure appears inside the same dialog.
- Every active customer-uploaded photo is counted and available to each exact eligible allocation after submission. Documents already explicitly approved for installer sharing remain available, while private documents remain owner-only. Authorization tests deny unrelated, expired, inactive, unreviewed and unallocated installers.
- The installer receives the complete canonical privacy-safe plan in order, including every controlled roadmap step, plus a protected full-plan PDF.
- The plan and evidence projection excludes identity, exact location, contact, private notes, room names and routines, permission notes, adviser identity and review text, customer-written arbitrary items, original evidence filenames and meter data.
- A durable operations email and durable business email are queued automatically after submission. Immediate background draining and scheduled recovery are both covered, provider failures remain observable, and duplicate requests cannot duplicate deliveries.
- Desktop, mobile, keyboard and assistive-status behavior pass focused UI checks.
- The exact application commit passes `npm.cmd run validate`, `npm.cmd run build`, migration replay, Sites bundle audit, `git diff --check`, GitHub reconciliation, Sites save and production deployment.

### Smallest validation set

- Focused evidence, full-plan, notification, allocation, timing and modal-progress tests during implementation.
- Fresh SQLite and Cloudflare D1 migration replay for every additive migration.
- Complete `npm.cmd run validate`, explicit `npm.cmd run build` and `git diff --check`.
- Signed-in production verification of the request dialog and the allocated installer Leads view when a safe working-demo fixture is available.
- Provider delivery ledger and worker error inspection without exposing recipient addresses or message content.

### Acceptance and release evidence

- Exact application commit `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb` records the authoritative customer request and durable operations, allocation and business-email work before returning HTTP `202`.
- The customer response does not await Resend, the administrator webhook or installer allocation. Immediate Worker draining uses `waitUntil`, and the scheduled Worker retains the recovery path.
- Explicit installer-request consent promotes every active project image that existed at the request boundary. Arbitrary PDFs and other documents retain their separate explicit sharing choice.
- The allocated reviewed installer receives every authorised evidence card plus the complete ordered privacy-safe plan, protected preview and protected PDF. Identity, exact location, contact, private notes, routines, permission notes, adviser identity, customer-written arbitrary items, filenames and meter data remain excluded.
- The dialog reports checking, plan save, per-photo upload progress and request dispatch. It adds reassurance after eight seconds, a longer-delay message after 25 seconds, blocks duplicate close or resubmit while busy, and preserves partial upload success.
- Backend-focused dispatch, timing, notification and property-arrival tests pass 32 of 32. The complete non-release-integrity suite passes 941 tests: 939 passed, 2 intentionally skipped and 0 failed.
- Type checking, warning-free lint, all 89 migrations through `0088_customer_opportunity_dispatch_jobs.sql`, the tagged-PDF audit, Vinext production build and Sites server-bundle audit pass. `git diff --check` passes.
- GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA.
- Local archive `aea-sites-059f2ff.tar.gz` is 7,107,950 bytes with SHA-256 `D32307C4B0FABF955FB4CF878CBD31290F053E06BA3CA67A92DBFBED6FD262E4`.
- Sites stored 318 files, 27,873,280 bytes with content hash `sha256:6c489fbaa560f2df5dc6cb9d807d1ae7c1d7b7a752632909bc45bc1f71a9c090`.
- Sites version 236 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8` and deployed as `appgdep_6a6c3b56a1b881919e82e97eaa286bc4` with environment revision 19.

### Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Current executable application commit: `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb`
- Sites application version: 236
- Sites saved-version identity: `appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8`
- Sites production deployment: `appgdep_6a6c3b56a1b881919e82e97eaa286bc4`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 89
- Immutable audit changes: none
- Working-demo data changed during release verification: none before the bounded signed-in acceptance check

### Known release risk

Automated privacy, authorization, idempotency, retry, progress, full-plan and complete-evidence contracts pass. Live provider inbox receipt and signed-in production presentation remain acceptance checks until they are exercised with the existing working-demo data. Provider configuration alone is not delivery proof.

### Stop conditions

Stop this milestone when:

- the complete plan or evidence cannot be shared without exposing a prohibited private field;
- a background task cannot be made durable before the customer response;
- the requested email needs a new paid provider, account or unapproved recipient;
- an authorization, tenant or reviewed-ABN test fails;
- a migration would need to rewrite shared history or populate synthetic accounts;
- live testing would affect a real customer, trade or administrator; or
- the release source, archive, saved version and production deployment cannot be reconciled.

## Prior released milestone: `INSTALLER-ENQUIRY-PACK-18`

### Outcome

Application commit `eeba3679c30789cfe2e633a913a18492270fcc3e` established the bounded privacy-safe enquiry pack, consent-gated evidence presentation, exact-allocation evidence authorization, direct Leads notification link and durable business-notification ledger through `0087_trade_opportunity_notifications.sql`. It passed its complete release gate and was deployed as historical Sites version 235 through `appgdep_6a6c0908063081919b2e985a27141e34`.

Those enquiry-pack, protected-evidence and notification-ledger contracts remain active underneath version 236. Milestone 19 supersedes only the first-three-step presentation, partial image-sharing behavior and request-latency boundary.

## Prior released milestone: `CUSTOMER-INSTALLER-SUBMIT-17`

### Outcome

Make the final installer-response confirmation one authoritative action. Exact application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b` passed the complete release gate and was deployed as historical Sites version 234 through `appgdep_6a6bf3695b6081918ce2a9dd77bc3869`. Documentation checkpoint `2b7805d193cfa6ec04858caee0a6715d36fe0b1d` recorded that release before version 235 superseded it.

Those single-transaction contact, project-transition, consent and opportunity-creation contracts remain active underneath version 236.

## Prior released milestone: `CUSTOMER-INSTALLER-PHOTOS-16`

### Outcome

Remove trigger-amplified false conflicts and let each guided photo prompt hold several independent photos. Exact application commit `5acc4ccf37acd608dc437d3a074410b1d840f706` passed the complete release gate and was deployed as historical Sites version 233 through `appgdep_6a6be56ca9ac8191918423bd57f0a05d`. Documentation checkpoint `a0a438271b03936e3972383e5586c2a12caa51aa` recorded that release before version 234 superseded it.

Those multi-photo, private-evidence, trigger-safe change-count and per-photo control contracts remain active underneath version 236.

## Prior released milestone: `CUSTOMER-PLAN-DURABILITY-15`

### Outcome

Make plan completion durable and understandable: keep guided photos visible where customers added them, preserve safe resumable evidence handling, make deletion recoverable, turn plan history into a useful comparison and check-in tool, submit installer requests from one confirmation, and deliver worker-safe accessible PDF and email reports.

Implementation commit `e74278c8b62c569541ea84b5a431917d03a1c13a` completed the product slice. Its first saved Sites version 231 failed before public activation because a private Next Fontkit bundle referenced `__dirname`; version 230 remained live. Corrective child `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` replaced that private boundary with public `@pdf-lib/fontkit`, added a post-build Sites bundle audit and became the executable source for version 232. Documentation checkpoint `2c55430757c316b4045e3edd9a26263a24793f14` recorded that release before version 233 superseded it.

### User outcomes

- A newly selected guided photo immediately shows a local preview, filename and saving state in the exact card where it was added.
- A saved photo stays visible after reload with replace and remove controls; if work choices change, the photo remains visible under a clearly labelled earlier-selection group.
- Guided evidence is not silently duplicated as generic evidence.
- A draft that is being deleted cannot still look active, accept new uploads or open through a stale continue link; recoverable cleanup can be finished from the dashboard.
- Customers can compare two plain-language roadmap versions, download a private-safe comparison, record private before-and-after observations and restore an earlier roadmap only as a new draft version.
- Missing private contact details save and the installer request submits from one confirmation, with one bounded authoritative conflict recovery rather than a second customer step.
- PDF and email delivery retain the premium visual hierarchy, embedded fonts, semantic lists and links. Unsupported scripts receive a clear fail-before-save response rather than corrupted visible text.

### In scope

- In-place pending and saved guided-photo previews, save or upload status, replacement, cancellation and removal.
- Stable capture slots, metadata stripping, resumable multipart private evidence uploads and compare-and-swap retake or removal.
- Retained guided evidence after work choices change, without duplicating generic evidence or supporting PDFs.
- Durable `deleting` state, frozen evidence writes, retryable D1 and R2 cleanup, and deletion-aware dashboard and direct-route behavior.
- Plain-language revision history, two-version comparison, privacy-filtered export, private outcome check-ins and guarded draft-only restore.
- One-confirmation private-profile save and installer request with a single bounded conflict recovery.
- Embedded Liberation Sans, tagged-document foundations, semantic lists and links, WCAG AA small-copy colours and fail-before-save unsupported-text handling.
- Public worker-safe `@pdf-lib/fontkit` plus a production bundle guard against `__dirname` and the private Next Fontkit marker.
- Migration `0085_customer_evidence_resumable_retake.sql` and the focused evidence, deletion, history, request, email and PDF regressions.

### Out of scope

- The deferred household and experienced-assessor field pilot.
- Real Gmail or Outlook desktop delivery acceptance and independent assistive-technology or PDF/UA conformance.
- Customer-visible crop, blur, redaction or annotation.
- Restoring a browser `File` object after a full reload without customer reselection.
- Rendering CJK, Arabic, Devanagari, Vietnamese or other scripts not covered by the current embedded fonts.
- Editable revision names or private revision notes.
- New provider configuration, live installer-request submission or mutation of working-demo evidence during release verification.
- The five forward product steps recorded below.
- Changes to the immutable dated audit or a Netlify deployment.

### Privacy and safety boundaries

- Evidence remains same-origin authenticated, owner scoped, private by default and unavailable to installers unless the customer explicitly marks it for the existing allocated-installer sharing boundary.
- Image metadata is stripped before durable storage; uploads remain bounded to 12 files of 8 MB and expired sessions cannot revive a deleted or deleting project.
- Retake and removal require the exact observed evidence revision so a stale browser cannot overwrite a newer file.
- Deletion freezes new evidence writes before cleanup and never treats a partially cleaned project as active again.
- Comparison exports exclude exact address, room names, evidence filenames, private notes and custom roadmap wording.
- Restoring a roadmap cannot replace project identity, private notes, evidence, quotes, installer activity or contact-release state.
- Contact details remain private platform data until the customer separately approves a named installer handover.
- A PDF with unsupported text fails before save and does not emit replacement characters or a partially corrupted document.

### Acceptance criteria

- Pending, saved and earlier-selection guided photos remain visible in the matching guided-photo section with accurate state and controls.
- Resumable sessions, stable capture slots, stale-revision rejection and deleting-project upload denial pass focused server and UI regressions.
- Deleting projects stay excluded from active totals, recommendations, continue links and editable detail routes until cleanup finishes.
- Version comparison, export, private check-ins and restore preserve all excluded private and installer state.
- Profile save and request submission use one confirmation and one bounded authoritative conflict recovery without replaying project, evidence or request writes.
- Focused PDF and email correction tests pass 18 of 18; type checking, warning-free lint, 31 integration tests, 914 total tests with 912 passed and 2 intentionally skipped, all 86 migrations, the Vinext production build, bundle audit and diff hygiene pass.
- Every page of the nine-page tagged-PDF audit is visually clean and contains no clipping, overlap, missing glyph, harsh corner or footer defect.
- GitHub, Sites managed source, saved version 232 and the public deployment resolve to exact corrective application commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`.
- Live signed-in inspection loads the saved roadmap, comparison and check-in UI and shows a selected working-demo photo directly beneath its matching guided prompt without mutating it.

### Stop conditions

Stop the affected path when:

- an evidence write could cross owners, bypass the private default, exceed the upload limits, retain unsafe metadata or resume after deletion starts;
- a stale retake, removal, deletion cleanup, profile update or request could overwrite newer state;
- deleting a draft could expose it as active, silently abandon private objects or allow a normal edit route;
- a comparison export or restore could include or overwrite excluded private or installer state;
- an unsupported script could produce corrupted or partially saved customer output;
- a generated Sites server bundle contains `__dirname` or the private Next Fontkit marker;
- live verification would replace or remove a working-demo photo, save profile data or submit an installer request;
- the release commit, GitHub branch, Sites source, archive, saved version and deployment do not reconcile;
- the immutable audit would change; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

### Release evidence

The exact application source passed:

```powershell
node --test test/customer-plan-pdf.test.mjs
npm.cmd run audit:sites-server-bundle
npm.cmd run validate
git diff --check
```

Observed results:

- implementation commit: `e74278c8b62c569541ea84b5a431917d03a1c13a`;
- failed non-live Sites version 231: saved identity `appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda`, deployment `appgdep_6a6bcf5c0f7c8191b877d27581f9d82e`, failure `__dirname is not defined`; it never became public and version 230 remained live;
- corrective executable application at that release: `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`;
- focused PDF and email correction set: 18 of 18 passed;
- integration suite: 31 of 31 passed;
- complete test suite: 914 total, 912 passed, 2 intentionally skipped and 0 failed;
- type checking and warning-free lint: passed;
- migration verification: all 86 migrations through `0085_customer_evidence_resumable_retake.sql` passed against fresh SQLite and Cloudflare D1 paths;
- PDF audit: nine visually clean pages, tagged-document foundation present, document format `2026-07-31-tagged-plan-pdf-v6`, unsupported scripts fail before save;
- Vinext production build, the Sites bundle audit and `git diff --check`: passed with no `__dirname` or private Next Fontkit marker;
- GitHub `main`, the working branch and Sites managed `main`: exact application SHA `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`;
- local release archive: `aea-sites-7e1f0a8.tar.gz`, 7,085,796 bytes, SHA-256 `9555352A7F723A615F2D97E2BFEE736DCD6D491C4189B5E100D179D7CB121974`;
- Sites stored archive: 311 files, 27,760,640 bytes, content hash `sha256:e48b4226de4114a1c68ab45ed29021778470a3333b477a44131f07b080e5f2f0`;
- Sites application version 232: saved identity `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8`, production deployment `appgdep_6a6bd28a71888191be19f89db9b82ca5`, environment revision 19;
- live signed-in inspection loaded the saved roadmap, two-version comparison, privacy-filtered export action and private check-in UI;
- a selected working-demo photo remained visibly named with `Added privately to this draft` in its matching guided card; and
- no working-demo photo, project, profile or installer request was saved, replaced, removed or submitted. The post-deployment Sites Worker error-only query returned zero events.

### Released implementation state at version 232

- GitHub branch: `codex/sites-custom-domain-migration`
- Implementation commit: `e74278c8b62c569541ea84b5a431917d03a1c13a`
- Corrective application commit at release: `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`
- Sites application version: 232
- Sites saved-version identity: `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8`
- Sites production deployment: `appgdep_6a6bd28a71888191be19f89db9b82ca5`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 86
- Immutable audit changes: none
- Working-demo data changed during live verification: none

### Known release risk at version 232

The last recorded exact production-only `npm audit --omit=dev` result reports six existing advisories: one low and five high. The package installation used for the worker-safe Fontkit correction reported 23 advisories across the full development tree, but no automatic audit fix was run and that broad count is not substituted for a fresh production-only audit. Dependency remediation remains a separate bounded patch with the complete validation and live-release gates.

## Prior released milestone: `CUSTOMER-INSTALLER-REQUEST-14`

The prior release established explicit completed-stage styling and the focused private installer-request dialog with protected recovery. Its exact application commit was `2607cc53f2e4c79546701e29d3d182fde4670952`, deployed as Sites version 230 through deployment `appgdep_6a6b5469c8bc81919f0e2c9ef22da602`. Documentation baseline `8a3a38c2e68de30f77720be0800acf6119fb32f0` recorded that checkpoint. Those contracts remain active underneath version 236.

## Prior released milestone: `CUSTOMER-ROADMAP-CONTEXT-13`

The prior release established the authoritative pre-roadmap home and work context, goal-derived priorities, `What shaped this roadmap` summary and non-duplicated quote-preparation stage. Its exact application commit was `0db488f325a79e22d126aace75647715b59c96f9`, deployed as Sites version 229 through deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24`. Documentation-only child `f4dbde8b742ece96e44f5a941f26bc712b0f82f8` recorded that checkpoint without changing the executable application. Those contracts remain active underneath version 236.

## Earlier released milestone: `CUSTOMER-PROJECT-CLEANUP-12`

The earlier release established compact project controls and guarded permanent deletion for unused private drafts. Its exact application commit was `da35ce60295d6c7150cddd9b35e33fcf64c8521b`, deployed as Sites version 227 through deployment `appgdep_6a6b22db21c48191a2dedbdbf05274ef`. Documentation-only child `563a4d805d9c6443096d5c73317ec18fc56f041e` recorded that checkpoint without changing the executable application. Those controls remain active underneath version 236.

## Earlier released milestone: `CUSTOMER-PLAN-TRUST-11`

The earlier release established the shared premium preview, duplicated bottom actions, guided private photos, bounded revision compare and restore through `0084_customer_plan_revision_restore.sql`, tagged-PDF foundations through format `2026-07-30-tagged-plan-pdf-v3` and adaptive email compatibility. Its exact application commit was `bc427d295b3106907904a3c0b7bf9f2945561cd1`, deployed as Sites version 224 through deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2`. Documentation-only child `23594c2b61dec855aeba0a10ba5a28eb3aeaf692` was later published as historical Sites version 225 without changing that executable application. Those contracts remain active underneath version 236.

## Earlier released milestone: `CUSTOMER-PLAN-SPACING-10`

The earlier release established consistent spacing and rounded surfaces throughout the premium PDF and email. Its exact application commit was `e74c2d95889a381cb3bb434607bc6584e54cf722`, deployed as Sites version 222 through deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28`. Documentation-only child `c2599eb5bedb11b1648da2b4a60e11b242cb2abb` was later published as historical Sites version 223 without changing the executable application. Those visual contracts remain active underneath version 236.

## Earlier released milestone: `CUSTOMER-PLAN-TECH-PRESENTATION-09`

The earlier release established the exact-brand technical presentation, truthful completed-plan signals and single household or professional evidence boundary. Its exact application commit was `f401575a5bf463b85c7688424db0b99dddd220c5`, first deployed as Sites version 220 through deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f`. Those contracts remain active underneath the later spacing and trust releases.

## Earlier released milestone: `CUSTOMER-PLAN-PREMIUM-REPORT-08`

The earlier release established the shared premium PDF, responsive email HTML and plain-text hierarchy while retaining the reliable non-mutating native attachment path. Its exact application commit was `fb6cacf8b0309a3fc26b40a43da5b025050d22d2`, first deployed as Sites version 218 through deployment `appgdep_6a6a11c02e088191bb27cc302c8b35af`. Documentation-only child `a92e18b9ea79b53eaf6eda8665f37ec02c861972` was recorded as historical Sites version 219 without changing that executable application. The shared report projection and privacy boundaries remain active underneath the later technical presentation and spacing releases.

## Earlier released milestone: `CUSTOMER-PLAN-NATIVE-PDF-07`

The prior release established the reliable non-mutating browser-native PDF attachment path. Its exact application commit was `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642`, first deployed as Sites version 216 through deployment `appgdep_6a69f763e0b08191b6ac8539e0828d84`. Its delivery mechanism remains active underneath the premium report presentation.

## Earlier released milestone: `CUSTOMER-PLAN-DIRECT-PDF-06`

The prior direct-PDF release used a client worker and produced a valid PDF from the public planner. Its exact application commit was `d5c675a5ceffa6e924df033e8cb8b505bb4d6336`, first deployed as Sites version 214 through deployment `appgdep_6a69e79a91548191987f12631559cb1f`. The signed-in action was not exercised during that release and later failed the product-owner operational check: it saved the project and could process or upload pending evidence before generating the PDF, then relied on a delayed hidden-link click. It is superseded by `CUSTOMER-PLAN-NATIVE-PDF-07`.

## Earlier released milestone: `CUSTOMER-PLAN-PRO-PRINT-05`

The prior release added the optional self-declared professional review and bounded everyday-action section. Its exact application commit was `ee75aadfd6800c01b92532b2d376a4a1e33c9d74`, first deployed as Sites version 212 through deployment `appgdep_6a69c4f838bc8191a0e050da219ab4a6`. Its temporary-frame browser-print mitigation passed source-level gates but was superseded after the product owner reproduced a Chrome freeze.

## Earlier released milestone: `CUSTOMER-PLAN-EVIDENCE-04`

The prior release established the shared categorized fourteen-question home-detail taxonomy, explicit `Not sure` handling, private-by-default evidence scope, bounded plan history and one concise privacy-filtered report across email and print. Its exact application commit was `6540ee671e64dbfdf80592283a1954b2ff482355`, first deployed as Sites version 210 through deployment `appgdep_6a695ca742d081918d73196751713f98`.

## Earlier released milestone: `CUSTOMER-PLAN-DECISION-03`

### Milestone outcome

Turn the current household plan into a decision-ready, independently useful document without implying a site assessment, authenticated assessor review or savings guarantee.

The milestone completes the four post-context product priorities:

1. explain why each controlled plan item appears, what remains unknown and what could change its position;
2. show no more than three safe, material next questions, with `Not sure` always valid;
3. add a private customer-owned review worksheet that clearly labels feedback as `Recorded by you`; and
4. produce one privacy-filtered independent plan brief for accessible preview, email and A4 print or browser PDF.

It also removes the visible product drift reported in the same customer journey:

- reinforce readable project-preparation guide paragraphs on the navy canvas;
- make the draft save-status message readable and announce changes accessibly;
- replace the stale public `/plan` recommendation contract with the current canonical advisor options and generator; and
- provide an accessible email-recipient dialog plus `Print or save PDF` action from the signed-in plan step.

### User outcomes

- A household can understand the controlled evidence behind each recommendation without being shown a false numerical confidence score.
- At most three unanswered questions identify the next information that could materially change safety, permission or plan order.
- A customer can privately record questions, feedback they heard and proposed changes without the system claiming that an assessor authored or verified them.
- Accepting a recorded proposal does not silently change the plan. A customer must explicitly add it as a private plan step.
- A verified signed-in customer can save the exact current draft, enter one confirmed recipient and request one independently useful plan email.
- The email response says `Accepted for delivery`; it does not claim inbox delivery.
- The same privacy-filtered document appears in a high-contrast A4 print view that supports printing or the browser's Save as PDF action.
- The public quick planner uses the same canonical goals, tenure, approval, budget, home-feature and recommendation boundaries as the signed-in advisor.
- Private project labels, exact location, room routines, filenames, account contact data, private notes, customer review text and arbitrary permission text do not enter the independent brief.

### In scope

- Bump the versioned customer plan contract while preserving edited legacy plans through the existing conflict boundary.
- Add bounded, controlled rationale and next-question derivation.
- Extend the existing owner-scoped advisor-profile JSON with at most twenty private review items.
- Keep review kinds, targets and statuses allowlisted and text capped at 500 characters.
- Add a shared privacy-filtered plan-document projection with escaped inline HTML and plain text.
- Add authenticated, owner-scoped email delivery with explicit recipient confirmation, strict single-address validation, idempotency and a fail-closed five-attempt hourly rate limit.
- Reuse the configured email delivery provider. Do not add a new provider or send a release-test email to a real address.
- Add an accessible modal with focus management, Escape close, focus return and live status.
- Add an A4 print surface generated from the same saved plan projection.
- Reconcile the public quick planner and account handoff with the current canonical plan engine.
- Add focused domain, privacy, route, provider, accessibility, responsive and contrast regression tests.

### Out of scope

- The deferred household or experienced-assessor field pilot.
- Remote assessor invitations, authenticated assessor identity, external editing, access tokens or reviewer credentials.
- Professional evidence review, verification or a claim that an attachment has been assessed.
- A formal NatHERS assessment, NatHERS certificate, energy rating, equipment sizing or legal approval.
- Brands, provider ranking, current market prices, savings promises or finance advice.
- A server-side browser or a binary PDF generation dependency. A4 print plus browser Save as PDF is the bounded PDF path.
- Real customer, trade, wholesaler or assessor account creation.
- Installer opportunity, direct-contact, payment or subscription changes.
- Changes to the immutable dated audit.
- Netlify deployment.

### Privacy and safety boundaries

- Guidance and next questions are derived only from controlled inputs and fixed internal guide destinations.
- `Not sure` is useful evidence and never blocks saving or submission.
- Questions must not ask a person to climb a roof, enter a roof space, remove electrical covers, block required ventilation or perform unsafe inspection.
- Review text remains customer-owned private project data. It never enters installer opportunity output, permission packs, email, print or public planner URLs.
- Only the owning active customer can read or write the saved plan used for delivery.
- Email delivery accepts one normalized address, requires a verified account and explicit confirmation, and fails closed when rate-limit storage or provider configuration is unavailable.
- Custom plan text and private plan notes are omitted from the independent brief. The brief reports omitted counts without copying the wording.
- The report is an independent home energy plan prepared from customer selections. It is not a completed site assessment, quote, legal permission decision or savings promise.

### Acceptance criteria

- Every canonical generated plan item has bounded `Based on`, `Still uncertain` and `Could change if` guidance.
- Next questions are deterministic, unique, fixed-destination, safe and capped at three.
- Review-item normalization enforces kinds, targets, statuses, length and count; invalid targets do not create an assessor identity or verification state.
- Submitted-project locking and duplicate-before-revision behaviour remain intact.
- Review text cannot enter installer opportunity, permission-pack or independent-brief output.
- The plan email API rejects missing consent, unverified identity, inactive account, wrong ownership, archived projects, multiple or malformed recipients, oversized bodies, unavailable rate limiting and unavailable provider configuration.
- No automated test or live release check sends an email to a real address.
- The print surface uses the exact saved ordering and controlled current plan content, is keyboard reachable and renders on A4 without the application shell.
- The public `/plan` and signed-in advisor produce the same canonical item sequence for equivalent controlled input.
- Project-preparation paragraphs and the draft status meet readable contrast and mobile layout requirements.
- Focused tests, the full validation gate, all migrations, production build, diff hygiene, source provenance and desktop plus 390 px live checks pass.

### Stop conditions

Stop the affected path when:

- actual remote assessor access or identity is required;
- arbitrary review, project or permission text could escape into installer or shared output;
- an accepted review changes the plan without a second explicit customer action;
- an unsafe question or blocking guess would be introduced;
- legacy edited plan items would be lost during version regeneration;
- provider configuration, rate-limit storage or source provenance cannot be verified;
- a change would create or use a real account for release testing;
- the release commit, GitHub branch, Sites source, archive and saved version do not reconcile;
- a change would alter the immutable dated audit; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

### Release evidence

The exact application source passed:

```powershell
node --experimental-strip-types --test test/customer-plan-decision-support.test.mjs test/customer-plan-sharing.test.mjs test/customer-advisor-contract.test.mjs test/customer-project-advisor-ui.test.mjs test/customer-project-advisor.test.mjs test/home-energy-plan.test.mjs test/dark-canvas.test.mjs test/direct-trade-enquiry.test.mjs test/service-reminder-delivery.test.mjs test/site-navigation.test.mjs
npm.cmd run validate
npm.cmd test
npm.cmd run test:integration
git diff --check
```

Observed results:

- focused plan, privacy, provider, accessibility and navigation review set: 51 of 51 passed;
- complete suite: 784 tests, 782 passed, 2 intentionally skipped and 0 failed;
- integration suite: 31 of 31 passed;
- type checking: passed;
- warning-free lint: passed;
- migration verification: all 83 migrations passed on fresh SQLite and Cloudflare D1 paths;
- Vinext production build: passed;
- `git diff --check`: passed;
- GitHub and Sites managed source branch: exact application SHA `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e`;
- Sites application version: 208, deployment `appgdep_6a6943bcb758819196c764370a2b683a`, public, environment revision 19;
- required Sites delivery and limiter configuration names are present; secret values were not read or reproduced;
- live public `/plan` exposes the reconciled seven-part advisor intake and controlled question-led result;
- the live guide paragraph colour is `rgb(185, 204, 215)` on the navy canvas with no horizontal overflow;
- the live print route contains the ordered plan, decision questions, guide links and browser Print or Save as PDF action;
- representative local A4 output was inspected across four pages with complete cards, visible links, clean page breaks and no application shell;
- no real account was created or used, no working-demo data changed and no release check sent an email.

The authenticated email route and signed-in sharing UI were verified through owner-scope, privacy, provider, idempotency, limiter, modal and projection regressions. Live delivery was deliberately not exercised because the release boundary prohibits sending a test message to a real address.

### Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e`
- Sites application version: 208
- Sites application deployment: `appgdep_6a6943bcb758819196c764370a2b683a`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 83
- Immutable audit changes: none
- Demo data changed during live verification: none

## Prior released milestone: `CUSTOMER-ADVISOR-CONTEXT-02`

### Milestone outcome

The administrator notification inbox now keeps an expanded case open and at its prior visible position when the automatic audited read-state update refreshes and reorders the queue.

The household project builder also completes the next four advisor priorities:

1. controlled evidence-source confidence and provenance;
2. postcode and state based broad climate sequencing;
3. room-by-room comfort evidence that changes advice only when the concern and use period belong to the same room; and
4. a renter, owner and strata permission checklist derived from tenure, approval context, the current plan and remaining evidence questions.

The result remains an independent, brand-agnostic planning workflow. It is not a NatHERS assessment, legal permission decision, quote, fixed-price estimate or savings promise.

### User outcomes

- An administrator can open an unread case without the case collapsing or jumping away when the read update completes.
- Explicit close and resolve remain deliberate actions.
- A deliberate queue, search, category, priority, status or assignee change resets the open-case boundary instead of keeping an out-of-filter record visible.
- A household can label each important controlled fact as not known, customer reported, photo available for review or document available for review.
- Evidence labels describe the available source only. They do not claim that a file is attached to the fact, professionally reviewed or verified.
- A valid matching postcode and state produce a broad planning profile that can change whether shading or building-shell investigation appears first.
- Invalid, non-residential or postcode/state-mismatched input produces no climate profile.
- A household can add up to twelve private room profiles using controlled room types, concerns and use periods.
- Same-room hot daytime evidence can lead with shade and solar control. Same-room cold overnight evidence can lead with safe draught and insulation investigation.
- Private room names and routines do not enter the installer opportunity.
- Renter-portable and reversible actions appear before permission-dependent fixed work.
- The customer can build and preview a five-section property-permission checklist before downloading it.
- A customer-selected permission class cannot remove a mandatory licensed trade or site check.
- Arbitrary permission titles, identifiers and note wording remain inside the signed-in project. The shareable checklist uses controlled text and private-note reminders.
- Every generated evidence, climate and room step links to a plain-language explanation.

### In scope

- Stabilise the expanded case in `AdminNotificationInbox` across audited background refreshes.
- Add a small pure state helper for queue pinning and explicit reset semantics.
- Add regression tests for reordering, filter-boundary updates, unavailable cases and deliberate filter changes.
- Add `customer_projects.advisor_profile` as additive JSON text through `0082_customer_advisor_profile.sql`.
- Persist and hydrate the advisor profile through create, update, list and duplicate project paths.
- Add server normalization for evidence sources, climate, rooms and permission items.
- Keep a maximum of twelve rooms, sixty characters per private room name and controlled values for room type, concern and use period.
- Keep a maximum of thirty permission items and controlled classifications.
- Generate the permission pack from tenure, strata context, current plan, evidence gaps and customer classifications.
- Keep authoritative safety rules in their controlled section even when customer classification differs.
- Replace arbitrary shareable permission text with controlled reminders.
- Derive installer opportunity context from broad climate, controlled room-type and concern aggregates, and known or unknown source counts.
- Preserve the exact-postcode allocation boundary while returning an empty postcode to installers before contact release.
- Add preparation-guide sections for evidence, broad climate and room comfort.
- Correct guide paragraph contrast on the navy customer canvas.

### Out of scope

- Professional review or verification of household evidence.
- Formal NatHERS climate zones, ratings, certificates or equipment sizing.
- Legal advice or proof that owner, agent, strata or owners-corporation permission has been granted.
- Brand, product, provider or installer ranking.
- Current market-price estimates or guaranteed savings.
- Automatic access for an assessor.
- Creation of real customer, trade, wholesaler or assessor accounts.
- Generic Database Console withdrawal.
- Changes to the immutable dated audit.
- Netlify deployment.

### Advisor and privacy boundaries

- Use `independent home energy plan`, not `NatHERS assessment` or `NatHERS certificate`.
- Treat `Not sure` as valid information.
- Do not infer attachment review, professional validation or proof from a customer source selection.
- Do not tell customers to enter roof spaces, climb roofs, remove electrical covers or block required ventilation.
- Keep room names, room use periods, permission titles, permission notes, exact location and project-private notes out of installer opportunity payloads.
- Keep arbitrary permission wording out of the shareable checklist.
- Use controlled aggregates only where installer matching needs them.
- Keep the permission checklist as a question and review aid. It does not grant permission or replace licensed or site-specific advice.
- Use broad climate only to order investigations. It does not size equipment or predict savings.

### Data and compatibility requirements

- `customer_projects.advisor_profile` is additive JSON text with default `{}`.
- The forward migration is `0082_customer_advisor_profile.sql`. Applied migration history remains unchanged.
- That prior release's plan version was `2026-07-29-evidence-climate-advisor`.
- The prior `2026-07-29-home-advisor` plan version is legacy and regenerates through the existing edited-plan conflict boundary.
- Server normalization derives climate from the stored postcode and state. Client-supplied climate text is not authoritative.
- Invalid evidence-source, room, concern, use-period and permission values fall back to controlled safe states.
- Room concerns affect plan sequencing only when the relevant concern and use period occur in the same room.
- User classification is supplementary. It cannot replace an authoritative permission or licensed-site-check rule.
- API writes remain owner scoped and preserve backward compatibility for rows without an advisor profile.
- Duplicate projects preserve the normalized advisor profile without creating installer disclosure.

### Acceptance criteria

- The first unread demo case remains expanded and first in the visible queue after its automatic audited read update.
- That case no longer shows its `Mark read` action after the update, while `Close case` remains available.
- Manual filter changes reset the pinned case.
- Evidence labels make no unsupported review or attachment claim.
- Valid postcode and state input produce one bounded planning profile; invalid or mismatched input produces none.
- Hot daytime and cold overnight rules do not cross-correlate separate rooms.
- Room and permission limits are enforced by server normalization.
- Renter-portable actions precede fixed or permission-dependent work.
- The permission pack contains five controlled sections and retains authoritative safety rules.
- Malicious or private permission titles, notes and identifiers are not copied into the pack.
- Installer opportunity output excludes private room and permission content.
- Focused tests, full validation, all migrations, the production build, diff hygiene, source provenance and live checks pass.

### Validation commands and observed results

The exact application commit passed:

```powershell
node --experimental-strip-types --test test/admin-notification-inbox-stability.test.mjs test/customer-advisor-contract.test.mjs test/customer-project-advisor-ui.test.mjs test/customer-project-advisor.test.mjs
npm.cmd run validate
node --experimental-strip-types --test
git diff --check
```

Observed results:

- focused advisor and administrator regression set: 38 of 38 passed;
- integration suite inside the release gate: 32 of 32 passed;
- full suite: 770 tests, 768 passed, 2 intentionally skipped and 0 failed;
- type checking: passed;
- warning-free lint: passed;
- migration verification: all 83 migrations passed on fresh SQLite and Cloudflare D1 paths;
- Vinext production build: passed;
- `git diff --check`: passed;
- application source and Sites managed branch: exact SHA `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77`;
- Sites application version: 206, deployment `appgdep_6a68ff2f45d08191aec1274c14168407`, public, environment revision 19;
- public health, guide, signed-out customer route and administrator shell: HTTP 200;
- signed-in customer verification: all five steps selectable; evidence labels, room profile, broad climate, editable plan and five-section permission preview present;
- responsive verification: desktop guide contrast is readable; the 390 by 844 computed layout has no horizontal overflow;
- signed-in administrator verification: one working-demo notification changed from unread to read, stayed expanded and retained its first visible position;
- no real account was created or used.

The Sites error-only query returned three informational canceled `/api/electricity-plans` health-monitor invocations and no exception message attributable to the newly checked release routes. The monitor cancellation remains a separate operational observation, not a passing end-to-end electricity-plan provider check.

### Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77`
- Sites application version: 206
- Sites application deployment: `appgdep_6a68ff2f45d08191aec1274c14168407`
- Production URL: `https://compare.ausenergyassessments.com`
- D1 migration count: 83
- Immutable audit changes: none
- Demo data changed during live verification: one notification read-state only

### Release and stop conditions

Stop the affected work when:

- evidence wording would imply professional review that did not occur;
- broad climate wording could be mistaken for a NatHERS result;
- room or permission text could disclose private household information to installers;
- a customer classification could remove a mandatory safety or licensed-site check;
- advice could encourage unsafe inspection, blocked ventilation or unauthorised fixed work;
- a change would create or use a real account for release testing;
- the release commit, GitHub branch, Sites source, archive and saved version do not reconcile;
- a change would alter the immutable dated audit;
- a legal, regulated-service, privacy, provider or account-ownership decision requires an authorised human.
