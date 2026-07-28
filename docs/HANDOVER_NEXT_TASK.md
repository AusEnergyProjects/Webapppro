# Next task handover

Status: active milestone

Prepared: 28 July 2026

Milestone ID: `FREE-ACCESS-ABN-01`

Audited baseline: `ff3c8efe3d5e501286d8e83e28086d6d4590be27`

Deployed application before this milestone: Sites version 199 from `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`

The [complete current-state audit](./audit/2026-07-21-complete-current-state/README.md) is the immutable baseline. [RELEASE_TRUTH.md](./RELEASE_TRUTH.md) owns current status and deployment identity. [ROADMAP.md](../ROADMAP.md) owns the approved sequence.

## Milestone outcome

Make TLink a single free trade operating system. A trade applicant supplies a checksum-valid ABN, remains pending while an authorised reviewer verifies the business against an authoritative source, and receives role-appropriate access only after approval.

No payment, plan, seat, lead, job, quote, invoice or provider state may grant product access.

## User outcomes

- A legitimate trade applicant can submit one clear application without entering card details or choosing a commercial plan.
- An applicant can see that review is pending without entering any trade workspace.
- A reviewer can inspect the supplied ABN, record the authoritative result and deliberately approve, request information or reject the application.
- An approved installer or supplier receives the correct free tools for its role.
- Changing the ABN immediately returns the account to review.
- Existing customer invoices and provider-neutral accounting records continue to represent work performed without affecting access.

## In scope

- Remove retired commercial-access routes, controls, copy and navigation.
- Remove commercial access decisions from entitlements, APIs, pages and administration.
- Use a staged expand, application and contract sequence to remove obsolete commercial account fields, tables and demo rows, based on the product owner's explicit statement that no real customer, trade or wholesaler accounts exist.
- Remove the unsafe live-identity synthetic generator and its commercial-state fixture.
- Keep isolated local scale benchmarking separate from identities and production data.
- Preserve the existing 11-digit ABN checksum validation.
- Save new applicants in a pending state.
- Add an explicit authoritative ABN review record with outcome, reviewer and decision time.
- Require active account status, approved review and correct role at every trade workspace and API.
- Reset review and access after an ABN change.
- Migrate existing trade accounts through an explicit reviewed rule with no commercial-state grandfathering.
- Remove obsolete commercial administration fields, filters, summaries, alerts and database-console descriptions.
- Update focused tests, current documentation and release integrity checks.

## Out of scope

- Activating any payment-provider path on Sites.
- Handling payment-card data in TLink.
- Provider onboarding or real customer transactions.
- Rewriting applied migrations.
- Changing household-account access.
- Replacing the existing role, tenant, privacy, licence or insurance controls.
- Deploying before the exact release commit passes validation.
- Altering any file in the dated audit snapshot.

## Required access state

| State | Allowed |
| --- | --- |
| Authenticated, no trade application | Application start and account-safe help only |
| Application submitted, ABN checksum valid, review pending | Application status and requested-evidence response only |
| More information required | Application status and bounded correction/evidence response only |
| Rejected, suspended or expired | Decision/status information and approved support path only |
| Active account, approved ABN review, installer role | Installer tools authorised by role and tenant |
| Active account, approved ABN review, supplier role | Supplier tools authorised by role and tenant |
| ABN changed after approval | Immediate return to pending review; trade tools denied |

## Data and audit requirements

- Keep the submitted normalized ABN and the authoritative review outcome.
- Record review status, source class, reviewer UID, reviewed time and a bounded reason or reference.
- Do not copy unnecessary registry personal data into TLink.
- Preserve an append-only decision event for approval, information request, rejection, reset and suspension.
- Prevent duplicate active business identities under the approved duplicate-ABN policy.
- Use additive migration `0079_trade_abn_access_gate.sql` to expand the access schema without breaking the previously deployed application, and preserve stable account identifiers.
- Keep job invoice totals and provider-neutral accounting status separate from product access.

## Implementation boundaries

- `src/app/api/trade-profile/route.ts` owns application input and checksum validation.
- Central server authorization owns the active, approved and role checks.
- Trade pages and APIs consume the central authorization result rather than reimplementing commercial rules.
- Administrator review uses one named domain action and writes the audit event atomically.
- The later contract cleanup does not rewrite applied migrations or delete legitimate jobs, invoices, provider-neutral accounting or audit records.
- Public and signed-in copy state only the free verified model.

## Acceptance criteria

- Invalid checksum ABNs fail before persistence.
- Valid checksum alone never grants trade access.
- A new application is pending by default.
- Every trade workspace and API denies pending, rejected, suspended and expired accounts.
- Approval requires an authorised reviewer and a complete review record.
- An ABN update resets review and access atomically.
- Installer and supplier permissions remain distinct.
- Admin pages contain no trade plan, price or commercial-access controls.
- Current operational source and documentation contain no retired trade charging model. Applied migration history, the immutable audit and Git history are historical evidence and are excluded.
- Legitimate customer invoice and payment terminology remains intact.
- No unsafe live-identity seed generator or commercial-state fixture remains.
- Focused success, denial, transition, duplicate and migration tests pass.
- Internal documentation links resolve.
- `npm run validate` and `npm run build` pass on the exact release commit.
- No deployment claim is made before exact Sites provenance and live verification are recorded.

## Validation commands

Run focused tests selected by the implementation owner, including:

```powershell
npm.cmd test -- test/direct-trade-entitlements.test.mjs
npm.cmd test -- test/direct-trade-dashboard.test.mjs
npm.cmd test -- test/direct-trade-partners.test.mjs
npm.cmd test -- test/customer-property-arrivals.test.mjs
npm.cmd test -- test/admin-operations.test.mjs
npm.cmd run db:check
npm.cmd run audit:links
npm.cmd run validate
npm.cmd run build
```

The test runner may execute a wider set than the named files. Report the observed totals rather than assuming filtering behavior.

## Current local implementation state

The compatibility expansion is live as Sites version 200 from pushed commit `7ebcb1905d3c28245fbcfede55525e0cfee8df8a`. It changes only `0079_trade_abn_access_gate.sql`, adds four reviewed-ABN projection fields, two indexes, the append-only review ledger and protective triggers, and leaves the version 199 runtime compatible. The reviewed-ABN application is committed as `481401d98ef2c0b294252a4cabeebc74eba40a52`, merged with the expansion release ancestry at `fb9c80fb73bf2a0b5d461ed2ecbfa28df6022c71`, and is live as Sites version 201. The contract cleanup is committed as `698a5057cc384d43112e5ccff38a99effbb01fa8`, live as Sites version 202 through deployment `appgdep_6a68be4006188191aa338c4438757e62`, and active at environment revision 19 after all 16 observed Stripe, Square and retired paid-plan runtime keys were removed.

The last complete validation before the staged split was:

- `npm.cmd run validate`: passed, including 35 integration tests, 717 full-suite tests with 715 passed and 2 intentionally skipped, all 80 migrations replayed, and the production build.
- `npm.cmd --prefix mobile run typecheck`: passed.
- `npm.cmd run benchmark:scale`: passed at 500,000 isolated in-memory rows with all guarded p95 values below 75 ms.
- `npm.cmd run audit:links`: nonzero because 7 external provider or network probes failed or timed out; 170 of 177 destinations were reachable or accepted and 16 were classified separately as automation-blocked.

The expansion commit passed `npm.cmd run validate`, including all 80 migrations and the production build. The application activation passed type checking, warning-free lint, 29 integration tests, 718 full-suite tests with 716 passed and 2 intentionally skipped, all 80 migrations and the production build. The exact contract commit `698a5057cc384d43112e5ccff38a99effbb01fa8` passes the complete integrated `npm.cmd run validate` gate: type checking, warning-free lint, 30 integration tests, 719 full-suite tests with 717 passed and 2 intentionally skipped, all 81 migrations and the production build. Mobile type checking passes. The isolated 500,000-row benchmark passes all 75 ms p95 guards. The external link audit checked 169 destinations: 166 were reachable or accepted, 15 were separately classified as automation-blocked, and 3 failed or timed out.

The product owner stated on 28 July 2026 that the environment contains working-demo data only and no real customer, trade or wholesaler accounts. Migration `0079_trade_abn_access_gate.sql` is intentionally additive: it performs no row deletion, column removal, table drop or provider cleanup. After the reviewed-ABN application became live, forward contract migration `0080_retire_legacy_trade_commercial_data.sql` used that explicit authorisation to remove the retired plan and billing columns, legacy payment, membership, referral and feature-grant tables, and Stripe/Square integration rows. Focused preservation checks retain account identities, jobs, quotes, invoices, provider-neutral accounting, calendar and append-only ABN review records. The contract is deployed. Managed live D1 schema and rows cannot be queried independently through the available Sites controls, so the database claim is based on exact migration provenance, successful deployment, clean worker logs and local D1 reconciliation rather than a separate live-table export.

## Release and stop conditions

Stop if:

- the authoritative ABN source or reviewer authority is unavailable;
- a route cannot be brought under the central approved-account boundary without changing an unrelated domain;
- live reconciliation shows that a contract-cleanup target contains legitimate customer, job, invoice, accounting or audit records;
- a provider or production action requires owner identity, legal acceptance or card details;
- complete validation fails;
- the exact source, saved version and deployment cannot be reconciled;
- the change would alter the immutable audit snapshot.

All three exact saved-version gates are complete: expansion at version 200, reviewed-ABN application at version 201, and contract cleanup at version 202. Public health and information routes pass, retired routes are absent, unauthenticated access is denied and the payment boundary is visible. The signed-in approved-account journey remains unverified because the owner confirmed there are no real accounts and no account was fabricated for release evidence. Record every later identity and deviation in `RELEASE_TRUTH.md`.

## Next five logical product steps

1. **Withdraw the generic Database Console:** replace broad catalogue and generic mutation access only with justified least-privilege diagnostics and named domain repair actions.
2. **Owner export and restore proof:** produce encrypted owner-held data and object exports and complete an isolated restore reconciliation.
3. **Ownership and privileged-access baseline:** name accountable owners, establish two-human administration, MFA, recovery and route authorization evidence.
4. **Owner-controlled platform foundation:** approve the target architecture and provision reproducible development, staging and production foundations.
5. **Migration and core-workflow proof:** rehearse data migration and validate the selected customer, trade, field and provider journeys before cutover.
