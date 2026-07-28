# AEA Energy and TLink forward roadmap

Status: current

Roadmap owner: product owner

Engineering owner: technical lead

Last reconciled: 29 July 2026

Baseline: [Complete current-state audit](./docs/audit/2026-07-21-complete-current-state/README.md)

## How this roadmap is used

The dated audit is the immutable evidence baseline. [Release truth](./docs/RELEASE_TRUTH.md) records the latest reconciled implementation and deployment state. The [next-task handover](./docs/HANDOVER_NEXT_TASK.md) contains one executable milestone. This roadmap contains only approved forward work and measurable gates.

Sequence is dependency based, not a calendar promise. A source change is not a release. A roadmap item is complete only when its required tests, release identity and runtime evidence are recorded.

## Product decisions

- TLink trade software costs A$0.
- Access is never granted by a payment, plan, seat, lead, job or quote state.
- A trade applicant must supply a checksum-valid Australian Business Number.
- A valid checksum is only an input check. An authorised reviewer must verify the business against an authoritative source before any trade workspace or trade API becomes available.
- Installer and supplier permissions remain role scoped. Licences, insurance, product evidence, privacy controls and jurisdiction rules remain separate approval gates where applicable.
- Household accounts remain free and private.
- Household planning remains independent, brand-agnostic and advisory. It is not represented as a NatHERS assessment, certificate, quote or savings guarantee.
- Household advice records owner or renter tenure separately from strata or common-property approval and supports several concurrent goals because authority, comfort, budget and upgrade sequencing can differ.
- TLink remains the authoritative trade record until an approved migration changes that boundary.
- Applied database migration history is immutable. Database change uses staged forward migrations: a compatible expansion before application activation, followed by a separately reconciled contract cleanup only after the new application is live.

## Current milestone: CUSTOMER-HOME-ADVISOR-01

Release status: local implementation from baseline `01a8d09022b086c771c938960efa8d9a333542d3`. The pre-change production baseline is Sites version 203 from that same commit. Deployment is not claimed until the final release identity is recorded in [release truth](./docs/RELEASE_TRUTH.md).

### Outcome

Make household planning clear enough for a first-time customer and useful enough for an experienced assessor without turning it into a product pitch or formal NatHERS assessment.

### In scope

- Retire the empty customer Home records navigation and dedicated page while preserving durable completed-project handovers and governance.
- Make all project stages accessible for preview.
- Collect tenure, several goals, detailed home facts and a broad budget band before generating advice.
- Give renters portable and removable actions separately from permission-dependent fixed work.
- Generate a private, independent starting plan that can be reordered, removed or supplemented with a bounded custom item.
- Keep draught-proofing, insulation, glazing and window coverings separate from customer selection through installer capability matching and accepted-work handoff.
- Use one optional evidence-upload area with safe-photo and privacy guidance.
- Require durable, explicit file-sharing consent and remove customer-authored filenames before any evidence reaches allocated installers.
- Keep private notes visible and validation beside the attempted action.
- Persist the expanded contract through forward migration `0081_customer_project_advisor.sql`, including an explicit unanswered state for ambiguous legacy tenure, retired budget and combined-category transforms, removal of household routines, protected evidence filenames and full matched-category preservation through CRM and work orders.

### Out of scope

- Formal NatHERS assessment, certification or formal evidence collection.
- Brand, product, installer or service-provider recommendations.
- Fixed price estimates or guaranteed savings.
- Legal tenancy or owners-corporation determinations.
- Unsafe customer inspection or advice to seal required ventilation.
- Deletion of completed-project handovers, warranties, corrections, consent events or audit history.
- Production deployment before the complete release gate passes.

### Acceptance gate

- No customer Home records route or navigation remains.
- Every project stage is a directly selectable accessible button.
- Multiple goals, tenure, budget and detailed home facts persist through the server allowlist.
- Plan items can be reordered, removed and added without accepting arbitrary markup or destinations.
- Customer plan wording remains independent, brand-agnostic and explicit about its limits.
- Quote preparation has four separate fabric categories, one upload input, visible private notes and no household access routine.
- Every attached file remains unavailable to installers without an active sharing receipt, and installer payloads use generic filenames.
- Focused domain, UI, persistence, compatibility and migration tests pass.
- `npm run validate` and `npm run build` pass on the exact release commit.
- GitHub and Sites source provenance match the release commit.
- Release truth records the saved Sites version, production deployment and dated responsive verification.

## Forward phases

### Phase 0: apply operating restrictions

Priority: P0

Audit source: RM-000 and RM-060

- Keep payment initiation and checkout absent from Sites, exclude payment providers from the active integration model, and retain only inert webhook acknowledgements while any external registration remains unreconciled.
- Withdraw the generic Database Console and replace it only with named, least-privilege diagnostics or domain repair commands where justified.
- Complete FREE-ACCESS-ABN-01.

Exit gate: production-safe negative checks prove that blocked payment and generic database mutation paths are unavailable, and approved ABN review is enforced at every trade entry boundary.

### Phase 1: establish ownership and recoverability

Priority: P0

Audit source: RM-010 and RM-020

- Name legal, billing, data, security and release owners.
- Maintain at least two human administrators for every production component.
- Obtain complete owner-held exports of relational data and private objects.
- Restore into an isolated owner-controlled environment.
- Reconcile schema, row counts, identifiers, monetary aggregates, audit chains and object hashes.
- Approve recovery and data-loss objectives from measured restore evidence.

Exit gate: two successive protected exports and one isolated restore reconcile without changing production.

### Phase 2: resolve privacy, industry and product authority

Priority: P0

Audit source: RM-030

- Confirm the legal entity and data-controller boundaries.
- Approve privacy notices, consent, retention, deletion, breach and overseas-disclosure rules.
- Define the exact evidence required for ABN, licence, insurance, accreditation and supplier review.
- Remove or block any public service or claim that lacks current authority.

Exit gate: each released workflow and material claim has an accountable owner, jurisdiction, evidence source and review date.

### Phase 3: make source and release truth verifiable

Priority: P1

Audit source: RM-040 and RM-065

- Maintain the dated audit as immutable history.
- Keep one concise release truth, one forward roadmap and one executable handover.
- Reconcile all migration files, journal entries and applied-state evidence.
- Generate route, schema and release inventories where practical.
- Fail validation on broken internal links, contradictory current status or missing release provenance.

Exit gate: exactly one current authority exists for each status subject, all retained routes have owners or retirement contracts, and migration provenance is complete.

### Phase 4: provision the owner-controlled production target

Priority: P0

Audit source: RM-050 and RM-060

- Select a managed modular-monolith target from approved requirements.
- Provision separate development, staging and production accounts through infrastructure as code.
- Use managed PostgreSQL, versioned object storage, owner-controlled identity and secrets, durable jobs, observability and tested recovery.
- Select an Australian region where approved requirements demand it.
- Establish MFA, session revocation, break-glass access, CSP and explicit route authorization.

Exit gate: an empty staging environment can be recreated from reviewed configuration and two administrators can operate and recover it.

### Phase 5: migrate data and prove core workflows

Priority: P0

Audit source: RM-070 and RM-080

- Build restartable full and delta imports for all authorised relational and object data.
- Preserve stable IDs, timestamps, integer-cent values and immutable event chains.
- Prove the selected customer, trade, admin and field workflows end to end.
- Activate only providers with accountable ownership, sandbox evidence, reconciliation and recovery procedures.

Exit gate: repeated migration rehearsals produce no unexplained variance and every launch-critical workflow passes authorization, privacy, accessibility and provider acceptance.

### Phase 6: operate, cut over and retire safely

Priority: P0

Audit source: RM-085, RM-090, RM-100 and RM-110

- Establish service objectives, durable telemetry, alerting, capacity tests and recurring restore drills.
- Run shadow parity against production-safe representative workflows.
- Use a bounded cutover with an explicit abort threshold and rollback window.
- Retain the source only for the approved fallback and records period.
- Revoke obsolete credentials and decommission only after reconciliation and owner approval.

Exit gate: cutover evidence, rollback proof, archival custody and post-cutover monitoring are complete.

## Next five logical product steps

1. **Evidence confidence and provenance:** mark important facts as customer-reported, photo-supported, document-supported or unknown and expose how confidence changes advice.
2. **Postcode and climate-aware sequencing:** adjust shading, airflow, draught, insulation and system priorities through a bounded Australian climate mapping without making a formal NatHERS claim.
3. **Room-by-room comfort profile:** collect only the seasonal symptoms and room-use details that materially change the plan.
4. **Renter and strata permission pack:** export portable actions, requested permissions and owner or owners-corporation works as separate neutral lists.
5. **Household and assessor usability pilot:** test the full flow with representative householders and experienced assessors and repair the highest-friction accessibility and comprehension findings.

## Global stop conditions

Stop the affected work when:

- an action could expose or irreversibly alter production customer, trade or evidence data;
- complete export or restore evidence is unavailable;
- a provider, legal or industry decision requires an authorised human;
- an ABN review cannot be supported by an authoritative source;
- an access-control or tenant-boundary test fails;
- migration reconciliation has an unexplained variance;
- the release commit, artifact and deployment identity do not match;
- rollback cannot be completed inside the approved window;
- a public claim or regulated workflow lacks current authority.
