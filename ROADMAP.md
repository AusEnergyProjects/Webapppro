# AEA Energy and TLink forward roadmap

Status: current

Roadmap owner: product owner

Engineering owner: technical lead

Last reconciled: 28 July 2026

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
- TLink remains the authoritative trade record until an approved migration changes that boundary.
- Applied database migration history is immutable. Database change uses staged forward migrations: a compatible expansion before application activation, followed by a separately reconciled contract cleanup only after the new application is live.

## Current milestone: FREE-ACCESS-ABN-01

Release status: the additive ABN schema expansion is committed and pushed as `7ebcb1905d3c28245fbcfede55525e0cfee8df8a` and is live as Sites version 200. The free reviewed-ABN application is committed as `481401d98ef2c0b294252a4cabeebc74eba40a52`, merged with the expansion release ancestry at `fb9c80fb73bf2a0b5d461ed2ecbfa28df6022c71`, pushed to GitHub, and live as Sites version 201. The authorised demo-only contract migration `0080_retire_legacy_trade_commercial_data.sql` passes the complete local release gate and awaits its own exact commit and deployment.

### Outcome

Remove the retired trade charging model and make reviewed business identity the only entry gate to the free role-appropriate trade system.

### In scope

- Remove obsolete commercial-access routes, controls, copy and navigation.
- Remove retired plan and billing controls from trade administration.
- Remove retired commercial-access dependencies from active reads and schema definitions. After the additive expansion and reviewed-ABN application are live and verified, apply a separate contract migration that deletes the retired demo-only commercial columns, tables, payment-provider connections, checkout/event/allocation rows and access records under the product owner's explicit no-real-accounts declaration.
- Require a checksum-valid ABN when a trade application is submitted.
- Create or update the applicant in a pending state.
- Require an authorised manual ABN review against an authoritative source.
- Record the review outcome, reviewer and decision time without storing unnecessary source material.
- Deny every trade workspace and trade API until the account is active and the review is approved.
- Reset approval and revoke trade access when the ABN changes.
- Preserve legitimate jobs, customer invoices and provider-neutral accounting records. Keep them separate from TLink access.
- Remove the unsafe live-identity synthetic generator and its commercial-state fixture. Retain only isolated local benchmark tooling that cannot target production identities or shared data.

### Out of scope

- Activating payment initiation while the application remains on Sites.
- Provider onboarding, real card processing or accounting-provider activation.
- Rewriting applied migrations.
- Broad redesign of trade workflows.
- Production deployment before the complete release gate passes.

### Acceptance gate

- New applicants cannot enter a trade workspace before approval.
- Invalid ABNs are rejected by checksum validation.
- A reviewer cannot approve an application without recording the authoritative review result.
- An ABN change returns the account to review and immediately removes trade access.
- Existing approved accounts follow an explicit reviewed migration rule, with no silent grandfathering from a commercial state.
- Admin screens contain no trade plan or commercial-access controls.
- Current operational source and documentation contain no retired trade charging copy or access decision. Applied migration history, the immutable dated audit and Git history are excluded from this scan.
- Legitimate invoice and customer-payment terms remain intact and cannot grant product access.
- Focused access, ABN, admin and migration tests pass.
- `npm run validate` and `npm run build` pass on the exact release commit.
- Release truth records the exact commit, deployment and dated live verification. Until then, the milestone is not deployment verified.

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

1. **Withdraw the generic Database Console:** replace broad catalogue and generic mutation access only with justified least-privilege diagnostics and named domain repair actions.
2. **Owner export and restore proof:** produce encrypted owner-held data and object exports and complete an isolated restore reconciliation.
3. **Ownership and privileged-access baseline:** name accountable owners, establish two-human administration, MFA, recovery and route authorization evidence.
4. **Owner-controlled platform foundation:** approve the target architecture and provision reproducible development, staging and production foundations.
5. **Migration and core-workflow proof:** rehearse data migration and validate the selected customer, trade, field and provider journeys before cutover.

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
