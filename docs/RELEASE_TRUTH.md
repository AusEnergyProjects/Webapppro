# TLink and AEA release truth

Status: current repository snapshot

Truth owners: product owner and technical lead

Last reconciled locally: 29 July 2026

Deployment evidence last verified: 29 July 2026

This is the only current implementation and release-status document. The [dated complete audit](./audit/2026-07-21-complete-current-state/README.md) is the immutable evidence baseline. [ROADMAP.md](../ROADMAP.md) owns forward sequence. [HANDOVER_NEXT_TASK.md](./HANDOVER_NEXT_TASK.md) owns one executable milestone.

## Identity

| Layer | Identity | Status |
| --- | --- | --- |
| Audited repository baseline | `ff3c8efe3d5e501286d8e83e28086d6d4590be27` on `codex/sites-custom-domain-migration` | Verified by the 21 July audit |
| ABN schema expansion source | `7ebcb1905d3c28245fbcfede55525e0cfee8df8a` on `codex/abn-schema-expand` | Validated, pushed to GitHub and Sites managed `main` |
| Reviewed-ABN application activation | `481401d98ef2c0b294252a4cabeebc74eba40a52` | Validated and pushed to GitHub |
| Reviewed-ABN merged release | `fb9c80fb73bf2a0b5d461ed2ecbfa28df6022c71` | Preserves expansion and activation ancestry; Sites version 201 |
| Free-access application and contract source | `698a5057cc384d43112e5ccff38a99effbb01fa8` | Validated, pushed to GitHub and Sites managed `main`; Sites version 202 |
| Pre-advisor repository and production baseline | `01a8d09022b086c771c938960efa8d9a333542d3` | Documentation-only child of the application source; pushed to GitHub and live as Sites version 203 |
| Pre-advisor Sites deployment | Sites version 203 at `https://compare.ausenergyassessments.com` | Historical pre-change production identity |
| Customer home advisor application source | `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` | Validated on the exact clean commit and pushed to GitHub and Sites managed `main` |
| Current production application | Sites version 204 from `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` at `https://compare.ausenergyassessments.com` | Saved-version provenance, public deployment, environment revision 19 and live checks verified on 29 July 2026 |
| Contract cleanup | `0080_retire_legacy_trade_commercial_data.sql`, SHA-256 `2CA1A250D9B6C637010480DEE0528906A932F40835EFBC786D90AD561CE99BA4` | Deployed from `698a5057cc384d43112e5ccff38a99effbb01fa8` |

The additive schema expansion, reviewed-ABN application, authorised contract cleanup and customer home advisor are production. Sites version 204 is the exact customer-advisor application source. Public health and the preparation guide return `200`, the retired Home records route returns `404`, and recent production worker-error logs are empty. Earlier free-access and integration boundary checks returned `200`; retired membership, billing, referral and payment-link routes returned `404`; and an unauthenticated trade CRM request returned `401`. No real signed-in account was used or fabricated, so an end-to-end approved-account journey remains unverified.

## Current product model

AEA and TLink contain four connected products:

1. Household energy planning and comparison, including electricity, gas, NEM12 processing, guides, scenarios, rebates and assessment intake.
2. A protected marketplace connecting reviewed household opportunities with approved installers and suppliers.
3. Free TLink trade software for CRM, customers, jobs, scheduling, quotes, forms, field work, assets, handover, invoices, integrations and teams.
4. The AEA Field iOS and Android client for assigned encrypted offline work.

TLink trade software costs A$0. Access has no recurring fee, seat charge, lead charge, job charge, quote charge or payment-card requirement. Customer invoices and job-payment records are operational business records only. They cannot grant, rank or expand TLink access.

## Trade access policy

- A trade applicant must sign in with a verified account email and provide required business and contact details.
- The application rejects an ABN that does not pass the 11-digit checksum.
- A valid checksum does not prove that the applicant owns or represents the business.
- A new or changed ABN remains pending until an authorised reviewer checks it against an authoritative source.
- The reviewer records the outcome, reviewer identity and decision time.
- Trade workspaces and APIs require an active account, an approved business review and the appropriate role.
- Changing the ABN resets the review and removes trade access until a new approval.
- Licence, insurance, accreditation, supplier evidence and jurisdiction checks remain separate controls where the workflow requires them.
- No commercial, invoice, provider-payment or legacy account field can grant trade access.

The deployed `FREE-ACCESS-ABN-01` implementation enforces this policy across signup, server authorization, administration, data and tests.

## Customer home advisor release

`CUSTOMER-HOME-ADVISOR-01` is deployed from exact application commit `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` as Sites version 204. It retires the dedicated customer Home records page and navigation while retaining completed-project handovers, warranty and correction integrity, consent events and administrator governance.

The project intake now:

- records owner or renter tenure separately from strata or common-property approval;
- accepts several goals and detailed home facts;
- uses a broad budget band only to sequence investigation;
- treats `Not sure` as useful information;
- generates an independent, brand-agnostic and editable starting plan;
- supports drag ordering, accessible arrow ordering, removal and bounded custom steps;
- preserves draught-proofing, insulation, glazing and window coverings through installer capability matching and accepted-work handoff;
- removes the household access-routine question;
- uses one optional evidence upload with durable sharing consent, generic installer filenames and safe-photo and privacy guidance;
- keeps private notes visibly editable; and
- places validation beside the customer action.

The flow is not a NatHERS assessment, certificate, formal evidence workflow, quote or savings promise. Forward migration `0081_customer_project_advisor.sql` adds and backfills the multi-goal projection, resets retired demo budgets, converts the old combined fabric category across matching and operational records, preserves complete matched-category lists through protected CRM enquiries and work orders, separates legacy strata approval from tenure, forces ambiguous legacy tenure back to an unanswered owner-or-renter choice, removes household occupancy from project context and anonymises stored evidence filenames without rewriting applied history.

## Local validation evidence

The last complete shared-worktree validation was recorded before the release was split into compatible expansion, application activation and contract cleanup:

- `npm.cmd run validate`, including type checking, warning-free lint, 35 integration tests, 717 full-suite tests with 715 passed and 2 intentionally skipped, all 80 migrations replayed against a fresh local D1 database, and the production build.
- `npm.cmd --prefix mobile run typecheck`.
- The isolated `DatabaseSync(":memory:")` benchmark with 100,000 rows in each of five datasets. All guarded queries remained below the 75 ms p95 threshold; reviewed-supplier catalogue first-page p95 was 0.118 ms and deep-cursor p95 was 0.127 ms in the final recorded run.
- The audit snapshot contains exactly 22 nonempty Markdown reports with an H1 and balanced fences. Its redundant duplicate archive is excluded from public source; the two user-profile path roots in the manifest were generalised to `%USERPROFILE%` before publication without changing a substantive finding.

The exact expansion commit `7ebcb1905d3c28245fbcfede55525e0cfee8df8a` passed `npm.cmd run validate`, including all 80 migrations and the production build. The application activation passed type checking, warning-free lint, 29 integration tests, 718 full-suite tests with 716 passed and 2 intentionally skipped, all 80 migrations and the production build. The exact contract commit `698a5057cc384d43112e5ccff38a99effbb01fa8` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 30 integration tests, 719 full-suite tests with 717 passed and 2 intentionally skipped, all 81 migrations and the production build. Mobile type checking passes. The isolated 500,000-row benchmark passes every 75 ms p95 guard; reviewed-supplier first-page p95 is 0.168 ms and deep-cursor p95 is 0.124 ms.

Exact application commit `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` passes 174 of 174 integrated focused customer-project, quote-preparation, capability-matching, consent, compatibility, operational-category and Home-record retirement tests. The complete `npm.cmd run validate` gate passes on that clean commit: type checking, warning-free lint, 32 integration tests, the full 755-test suite with 753 passed and 2 intentionally skipped, all 82 migrations against a fresh local D1 database, and the production build. `git diff --check` also passes. Desktop and 375-pixel browser checks confirm the redesigned Home, Goals, Plan, Work and Privacy stages, accurate progress, no preselected goal, explicit preservation or refresh of an edited plan, one evidence-upload boundary, action-local validation, the separate preparation guide and no mobile horizontal overflow. Sites version 204 has matching saved-source provenance; public health, the new guide and signed-out project entry return `200`, the retired Home records route returns `404`, and the recent worker-error query returns zero events.

The external link audit is not green: 166 of 169 destinations were reachable or accepted, 14 were separately classified as automation-blocked, and 3 provider or network probes failed or timed out. Those failures do not change the source validation result and remain external evidence gaps.

The product owner stated on 28 July 2026 that the environment contains working-demo data only and no real customer, trade or wholesaler accounts. Existing field-pilot recruitment code remains an inactive future workflow and was not activated or populated by this release. Migration `0079_trade_abn_access_gate.sql` adds only the reviewed-ABN projection, indexes and append-only decision ledger. It is deployed and performs no row deletion, column removal, table drop or provider cleanup. Deployed forward contract migration `0080_retire_legacy_trade_commercial_data.sql` uses that explicit authorisation to remove only retired commercial fields, tables and Stripe/Square integration rows after the reviewed-ABN application became live. Its preservation test retains account identities, jobs, quotes, invoices, accounting, calendar and ABN review records. Sites environment revision 19 contains zero Stripe or Square keys after the 16 observed retired keys were removed. Deployment and worker-log evidence is clean, but independent direct querying of the managed live D1 schema and rows remains unavailable; external provider registrations also remain unknown.

## Active deployed platform

The last verified deployed topology remains:

- Web and API runtime: OpenAI Sites using a Vinext Cloudflare Worker build.
- Relational data: Sites binding `DB`, implemented with Cloudflare D1.
- Private evidence objects: Sites binding `EVIDENCE`, implemented with Cloudflare R2.
- Authentication: Firebase Authentication with application roles and tenant controls in D1.
- Source record: GitHub.
- Operational relay: Google Apps Script and Google Workspace.
- Active public deployment target: Sites.
- Inactive deployment targets: Netlify and Vercel.

Logical binding access does not prove independent ownership of a Cloudflare account or resource. Ownership, complete export, off-platform backup, point-in-time recovery, transfer and workspace-loss behavior remain unproved.

## Verified deployed capability at the audit baseline

The 21 July audit reconciled these capability groups to deployed source:

- Native electricity and gas comparison plus the noindex electricity rollback route.
- Household accounts, project planning and protected opportunity intake.
- Installer and supplier profiles, verification, marketplace and catalogue flows.
- Installer CRM, customers, sites, assets, jobs, scheduling, quotes, invoices, field work, handover and team workflows.
- Owner-scoped integrations, provider-reconciliation foundations and the AEA Field sync contract.
- Restricted administration, operational notifications, pagination, search, query telemetry and saved Jobs and Customers views.
- Sites version 204 free reviewed-ABN application, contract cleanup, customer home advisor and current release documentation, including the earlier owner Database Console.

The audit recommends withdrawing the generic Database Console because broad catalogue access and generic mutation bypass domain services. That withdrawal is forward work and is not claimed complete here.

## P0 operating restrictions

- The current source contains no payment initiation or checkout route and excludes payment providers from the active integration and callback models. Legacy webhook endpoints acknowledge without reading the request or mutating state. Re-enablement requires written OpenAI and legal determination for the exact flow or migration to an approved host.
- The application must not collect or process payment-card data.
- No provider is treated as production ready from source configuration alone.
- The generic Database Console should not be expanded. Its withdrawal is the first administration-safety milestone after free-access cleanup.
- The specifically authorised demo-only commercial cleanup uses separate forward migration `0080_retire_legacy_trade_commercial_data.sql` after the expansion and application were live and reconciled. Any other production-data deletion remains prohibited without exact scope and evidence.

## Current unknowns and blockers

- Legal, billing and administrative ownership of every Sites, D1, R2, Firebase and provider component.
- Complete relational and object export, owner-held backup and isolated restore.
- Approved privacy, residency, retention, regulated-service and public-claim boundaries.
- Current Firebase MFA, revocation, recovery and authorised-domain settings.
- Complete provider account, scope, webhook, quota, reconciliation and recovery evidence.
- Durable application telemetry, approved service objectives, load evidence and disaster-recovery exercises.
- Physical iOS and Android distribution, signing, device and accessibility acceptance.
- Full WCAG 2.2 AA evidence.

These remain `UNKNOWN` or `BLOCKED`. Source code and passing local tests cannot close them.

## Validation and release contract

Before this document can claim a new deployment:

1. Focused tests for the changed access, ABN, admin, migration and documentation boundaries pass.
2. `npm run validate` passes on the exact commit.
3. `npm run build` passes on the exact commit.
4. The final diff contains only authorised changes and no secrets, generated credentials or customer data.
5. The exact commit is pushed to the approved source branch.
6. A Sites version is saved from that exact commit.
7. Only the saved version is deployed.
8. Public health, relevant signed-in journeys, authorization denials, responsive behavior and provider-error evidence are checked.
9. This identity table is updated with the exact source, saved version, deployment, environment revision, checks and known deviations.

Until all nine steps are evidenced, the correct status is local implementation or validated source, not deployed.

## Release policy

- Preserve the compatibility electricity route until its approved stability and parity gate passes.
- Publish only validated commits to GitHub and the approved host.
- Never publish credentials, synthetic account output, secrets or customer data.
- Do not edit applied migration history. Use immutable staged forward migrations: a compatible expansion first and a separately approved, reconciled contract cleanup later.
- Keep the dated audit immutable. Correct current truth here and add new release evidence rather than rewriting the audit snapshot.
