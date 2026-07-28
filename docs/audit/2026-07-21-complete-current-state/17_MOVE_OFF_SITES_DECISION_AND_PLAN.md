# Move-off-Sites decision and reversible migration plan

## Verdict

`MIGRATE THE COMPLETE PRODUCTION APPLICATION`

Move the complete production application—public frontend, authenticated frontend, API/Worker, scheduled work, D1 data and R2 objects—to owner-controlled hosting. Preserve the current modular application and provider-neutral integrations; this is a controlled platform migration, not a product rewrite. A strictly informational, non-transactional public page may remain on Sites temporarily only if it contains no customer/business records, authentication, uploads, private workflows or transaction-enabling links and has an explicit owner-approved end date.

The immediate reason is not that Cloudflare Workers, D1 or R2 are inherently unsuitable. It is that the **combined current arrangement** is a Sites-managed public-beta production runtime with unproven independent data/restore control, no data residency, and a direct policy uncertainty around the implemented payment workflows.

## Evidence behind the decision

| Question | Evidence-backed answer | Assessment |
|---|---|---|
| Is Sites only the frontend? | No. `vite.config.ts:8-27` builds a Vinext Cloudflare Worker with D1/R2 bindings and a schedule; `worker/index.ts:68-85` dispatches web/API traffic and scheduled jobs. Sites version 199 packages application source `4a5cd19…`; final repository `ff3c8ef…` is its documentation-only child. | `VERIFIED DEPLOYED` |
| Is the backend compiled into a Sites-managed Worker? | Yes, according to configuration, archive provenance and the active custom-domain Worker name. The exact Cloudflare account boundary is not exposed by repository bindings. | `VERIFIED DEPLOYED` for runtime; ownership `UNKNOWN` |
| How much backend exists? | Final source has 94 API route files and 197 exported HTTP operations. The v199 application source includes `/api/admin/database`; its owner read path is recorded live, but individual production reachability was not tested for every route. | `PARTIAL`: complete source inventory; full reachability `UNKNOWN` |
| Who owns D1/R2? | `.openai/hosting.json:1-5` records only the Sites project and binding names. It does not identify a Cloudflare account, billing owner or independent admin. Official Sites guidance describes managed D1/R2 shape, not transfer/owner-console access. | `UNKNOWN` |
| Can the owner independently query/export/backup/PITR/restore D1 or export R2? | Cloudflare documents these functions for owner-controlled resources, but no evidence shows that the owner can invoke them for the Sites-managed bindings. The deployed application Database Console is not an export, backup or restore control and should be withdrawn because its default-visible browsing and generic mutation create a second high-risk data path. | `UNKNOWN` / `BLOCKED` |
| Can the owner access logs/deployments? | Sites tools expose deployment history and a bounded log view in ChatGPT. Independent Worker logs/metrics/export and operation during ChatGPT workspace loss were not established. | `PARTIAL` |
| Does the app store material data? | The 145-table schema covers users, contacts, properties, jobs, schedules, evidence metadata, quotes, invoices, payment/accounting references, devices, consent and audit history; R2 stores private evidence. | `PARTIAL`: implemented and some live rows observed; production contents not inventoried |
| Does it enable transactions? | Implemented routes/adapters create provider-hosted Stripe/Square payment requests and reconcile signed webhooks; `docs/RELEASE_TRUTH.md:59,66,103,113,118` records the implementation/release history. TLink does not need card data, but directing or creating external checkout may fall within “otherwise facilitate.” | Platform-policy scope `CONTRADICTED` / expert confirmation required |
| Is there data residency? | OpenAI states Sites has no data or inference residency at launch, including Site code, D1/R2 data/files, artifacts and logs. | `BLOCKED` for any residency-dependent use |
| Is continuity owner-controlled? | Sites is beta; limits can affect public availability, workspace admins/OpenAI can disable a Site, and Sites Terms permit removal. No independent target or tested restore exists. | `NOT SUITABLE` |

Official sources checked 21 July 2026:

- [ChatGPT Sites Terms, updated 9 July 2026](https://openai.com/policies/chatgpt-sites-terms/): §2.5 prohibits a Site from initiating, executing or otherwise facilitating financial/investment transactions; §3.3 prohibits payment-card/PCI data; §3.2 makes the operator responsible for Hosted Data disclosures/consents; §5.2 permits removal/disablement; §5.3 identifies Sites as beta.
- [Creating and managing ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites): Sites is public beta, every deployment URL is production, it has no data/inference residency at launch, and plan/workspace limits apply.
- [Sites developer guide](https://learn.chatgpt.com/docs/sites.md): the management plane is ChatGPT web/desktop and save-version is distinct from deploy-version. This source does **not** establish independent D1/R2 export, backup, restore, logs, transfer or workspace-outage behavior.

The terms’ phrase “otherwise facilitate” is broad. Whether a redirect to provider-hosted checkout is prohibited requires written OpenAI/provider/legal confirmation. This audit does not claim a final legal interpretation. Because the consequence may be Site removal and the application exposes such workflows, treat the uncertainty as release-blocking until migration or written approval—not as evidence that the flow is permitted.

## Suitability verdict by layer

| Layer | Verdict | Conditions or reason |
|---|---|---|
| ChatGPT Sites application host | `NOT SUITABLE` | Public beta, no residency, transaction-policy conflict/uncertainty, management and continuity dependency, unsupported owner-control evidence. |
| Cloudflare Worker technology | `SUITABLE WITH CONDITIONS` | Suitable edge runtime when in an owner account with limits, observability, deployment and support proven; current Sites-managed boundary does not prove those controls. |
| D1 technology | `SUITABLE WITH CONDITIONS` | Export and Time Travel exist in owner Cloudflare accounts, but current control is unproven; 145 tables, reporting/concurrency, migration-journal drift and Australian residency need proof. PostgreSQL is the preferred long-term store. |
| R2 technology | `SUITABLE WITH CONDITIONS` | Good object interface when independently owned and backed up; current export/retention/region/restore control is unknown, and Oceania hints are not residency guarantees. |
| Firebase Authentication | `INSUFFICIENT EVIDENCE` | Runtime integration exists, but account/billing ownership, MFA/tenant policy, recovery, data processing and production console access were not proven. It can be retained during migration if those gates pass. |
| Combined production system | `NOT SUITABLE` | Business-critical CRM/data/payment workflows inherit the weakest platform controls. |

## Option comparison

| Option | Problems solved / not solved | Security/privacy and ownership | Backup/recovery and operations | Complexity, downtime, lock-in and reversibility | Preconditions and acceptance |
|---|---|---|---|---|---|
| **A. Keep Sites/D1/R2 and obtain controls** | Could solve independent control if OpenAI provides it; does not solve beta, no residency or transaction terms by itself | Need written resource ownership/admin/contract and transaction approval; current evidence absent | Need full export, off-platform backup, PITR, R2 inventory/restore, logs and non-AI admin proof | Lowest change; high Sites lock-in; reversible only if exports are complete | Written provider commitments; owner console/API access; tested full restore; approved use. None proven. |
| **B. Keep public frontend on Sites, move backend/data** | Removes data and API dependency; still leaves production frontend/workspace/terms dependency and auth/cross-origin complexity | Private data leaves Sites only if no prompts/logs/forms carry it; public frontend must not facilitate prohibited flows | Backend controls improve; two-platform deploy, telemetry and incident ownership | Medium complexity; split deployment increases coupling; frontend cutover still required later | Strict informational frontend, separate domain/API security, CSP/CORS/CSRF testing, Sites use approved in writing |
| **C. Move DB/storage, retain Worker/app layer** | Solves data control and recovery; keeps Sites runtime/management/policy risk | Owner PostgreSQL/object store; Sites Worker still handles PII and transaction navigation | Stronger data restore; Worker logs/support and workspace outage remain | Medium; cross-provider latency/egress; reversible with dual-read only if carefully designed | Private connectivity/latency/security proof, transaction-use confirmation, complete export |
| **D. Move complete application** | Solves the known Sites policy, management, residency-option and continuity constraints | Owner account controls compute/data/storage; service-specific contracts still required | Owner logs, IaC, backup/export/restore, CI/CD and support can be proven | Highest one-time effort; lowest Sites lock-in; reversible with shadow validation and bounded fallback | **Recommended.** Requires target decision, complete export, parity, security/performance/restore gates and cutover rollback |
| **E. Retain temporarily under restrictions** | Buys migration time; solves none of the structural issues | Disable/unpublish transaction-enabling and unsupported sensitive paths; minimize stored data; obtain written decisions | Daily evidence snapshot where possible, elevated monitoring and incident plan; restore remains unproven | Low immediate effort but growing business risk; explicitly time/exit bounded | Owner accepts residual risk, restricts scope, gets OpenAI confirmation, sets migration gates; not an indefinite production state |

## Target state

The recommended class is defined in `16_PRODUCTION_PLATFORM_OPTIONS.md`: owner-controlled CDN/WAF and modular web/API service, managed PostgreSQL, private object storage, owner identity tenant, queues/scheduler/workers for retries, central logs/metrics/traces, GitHub OIDC CI/CD, infrastructure as code, native PITR plus independent portable backup, and a proven restore. The reference services may be AWS Sydney, Azure Australia East or Google Cloud Sydney. Vendor selection remains an owner decision; the architecture and acceptance gates do not.

## Reversible migration sequence — design only

No step below was executed.

### 1. Freeze and evidence current truth

Define a migration baseline SHA and Sites version. Record route, operation, schema, migration, object, integration and configuration inventories with hashes. Stop unrelated schema/platform changes during each rehearsal and final cutover window.

**Gate:** Git SHA, Sites version/archive hash, 145-table schema, 79 migration files, D1 migration history, R2 inventory and environment/config identifiers reconcile. Resolve or formally map the 11 SQL migrations absent from the Drizzle journal.

### 2. Prove complete data and object export

Obtain provider-supported full D1 schema/data export and complete R2 object listing/download, including metadata, checksums and versions where available. Use a user-approved secure location outside the Sites control plane.

**Gate:** every table and object namespace is enumerated; export totals and checksums are reproducible; inaccessible/unsupported types are zero or explicitly accepted. Application-level table browsing is not this proof.

### 3. Prove backup integrity

Restore exports into an isolated local/non-production database and object namespace. Do not use production records in a broadly accessible environment.

**Gate:** schema, primary/foreign keys, row counts by table, critical aggregates, object counts/sizes/checksums and DB-object references reconcile; restore duration is measured.

### 4. Define canonical schemas and contracts

Freeze table/field semantics, source-of-truth rules, event/webhook contracts, IDs, money/time handling, retention, tenant keys and API behavior. Decide which SQLite/D1 behaviors require PostgreSQL equivalents.

**Gate:** reviewed schema mapping, migration policy, OpenAPI/event contracts, data classification and deletion/retention matrix.

### 5. Provision owner-controlled target environments

Use IaC to create separate non-production and production accounts/projects, network, compute, PostgreSQL, object storage, identity integration, queue/scheduler, secrets, observability, DNS/CDN/WAF and backup boundaries.

**Gate:** owner/billing/admin roles, break-glass, least privilege, Australian region decision, budgets, support and asset register are proven without AI.

### 6. Reproduce migrations

Create a deterministic migration path from empty PostgreSQL and an import path for current data. Do not silently translate constraints/triggers/indexes.

**Gate:** 100% schema mapping, forward migration from empty, current-data import, constraint/index/query tests and rollback/fix-forward policy.

### 7. Import and validate data

Load a dated export into non-production; normalize only through reviewed mapping code with an immutable reconciliation report.

**Gate:** table/row/PK/FK/unique/financial aggregate/timezone/consent/audit counts match; exceptions are zero or owner-approved with exact records held privately.

### 8. Establish off-platform backups and restore proof

Enable native PITR and independent encrypted PostgreSQL dumps; enable object versioning/retention and a separate-account/project inventory/copy.

**Gate:** restore both database and objects into a clean environment, reconcile them, measure RPO/RTO, test deletion/credential-loss scenarios and retain evidence.

### 9. Deploy target in shadow/preview mode

Build from an immutable artifact tied to exact Git SHA. Keep it private; use sanitized or authorized test data.

**Gate:** artifact provenance, configuration, security headers, health/readiness and rollback artifact are confirmed.

### 10. Compare route, workflow, schema and data parity

Exercise public comparisons, authentication, accounts, protected marketplace, CRM, scheduling, field sync, evidence, quotes/invoices, admin and degraded provider behavior.

**Gate:** 94/94 route files and all supported HTTP operations dispositioned; critical user journeys pass; intended differences are approved; no client calls target missing routes.

### 11. Run security, performance and recovery tests

Test authorization/tenant isolation, token/session revocation, uploads, webhooks, CSRF/XSS/SSRF controls, rate limits, concurrency, queues, provider timeout/replay, database failover and restore.

**Gate:** zero unresolved critical/high release blockers; owner-approved medium residual risk; load meets defined SLO with capacity margin; recovery meets RPO/RTO.

### 12. Establish observability

Create privacy-safe logs, metrics, traces, alerts and dashboards for route outcomes, database saturation, queue age, job outcomes, provider delivery/reconciliation and backup health.

**Gate:** alert drills reach a named human; request IDs cross components; PII/secrets are absent; dashboards work during application failure.

### 13. Plan DNS/traffic cutover

Reduce TTL in advance, validate target certificates/custom domains, define maintenance/write strategy and establish exact health/rollback thresholds.

**Gate:** rehearsed change plan, roles, communication, target/old-origin probes and authority to change DNS.

### 14. Define rollback

Select a data-consistency strategy before cutover: bounded read-only window is preferred for the current scale; otherwise use a reviewed change-capture/dual-write design. Never improvise bidirectional sync during incident response.

**Gate:** maximum rollback window, source of truth at every minute, reverse reconciliation, DNS rollback, provider webhook routing and queued-event treatment are documented and rehearsed.

### 15. Cut over only after gates

Take final export/delta, quiesce writes, import/reconcile, start target, move webhooks then traffic, and monitor defined acceptance indicators.

**Gate:** zero unexplained data delta; health and critical journeys pass; errors/latency within thresholds; owner authorizes traffic.

### 16. Maintain old path as bounded fallback

Keep the old Sites application private/read-only if the provider permits; prevent it from receiving writes, webhooks, scheduled jobs or transaction traffic.

**Gate:** fallback expiration, access, cost, data classification and rollback role are explicit. If Sites cannot be made safely read-only/private, preserve only exported artifacts/evidence.

### 17. Remove fallback only after stability proof

Use an owner-approved observation period based on transaction/job volume rather than an arbitrary date.

**Gate:** all critical workflow classes have succeeded, reconciliation remains clean, backup/restore and alert drills pass, no unresolved severity 1/2 incident and rollback window has ended.

### 18. Archive evidence and decommission safely

Export final Sites deployment/config/history evidence, revoke secrets/webhooks, remove DNS, apply retention/deletion obligations and record provider closure.

**Gate:** decommission checklist, data-destruction/retention evidence, billing closure and final architecture/platform registers are approved.

## Exact rollback model

The safest initial cutover uses a controlled write pause:

1. Announce and enforce a short write freeze at the API, not only in the UI.
2. Drain queues and record the terminal status of every in-flight provider request/webhook.
3. Capture final D1 export and R2 delta inventory; record a cutoff timestamp and hashes.
4. Import/reconcile target, then enable target writes and switch webhooks/DNS.
5. During the rollback window, treat the target as authoritative. The old Sites path remains read-only and cannot run schedules.
6. If rollback criteria fire before meaningful target writes, switch traffic/webhooks back after verifying the old snapshot is still current.
7. If target writes occurred, do not switch back until a reviewed reverse delta has been exported, applied and reconciled. Financial/provider events must reconcile by stable idempotency/provider IDs; never replay blindly.
8. Preserve both audit ledgers, queue receipts and object checksums. Record any rejected duplicate as evidence, not data loss.

Rollback triggers should include unauthorized access, data-count/checksum divergence, lost writes, unreconciled financial status, critical journey failure, error-rate/latency threshold breach, unavailable backups or inability to identify the authoritative system. Exact numeric SLO thresholds are an owner decision because no current traffic/SLO baseline was available.

## Reconciliation requirements

- **Database:** schema checksum; per-table rows; primary/unique/foreign-key exceptions; tenant ownership; cents totals for quotes/invoices/payments; appointment/timezone boundaries; consent/audit/event sequences; migration history.
- **Objects:** key, size, content checksum, MIME/signature metadata, owning job/evidence row, authorization class, retention/legal hold, orphan and missing-object counts.
- **Identity:** immutable provider subject, application role, account/tenant membership, invitations, disabled/revoked users, devices/sessions and recovery owner. Passwords/tokens are never exported through application code.
- **Providers:** credential/account identity, webhook endpoints, cursor/checkpoint, idempotency keys, outstanding deliveries, calendar mapping revisions, accounting document IDs, checkout/payment status and manual exceptions.
- **Routes:** method/status/body/error/auth behavior for every supported operation; redirects and cache/security headers; unavailable integrations must degrade truthfully.
- **Operations:** deployment SHA/artifact, environment config revision, schedule ownership, queue depth, alert delivery and backup state.

## Owner decisions required before migration work

1. Required Australian data location and whether it extends to identity, logs, support and third parties.
2. Final interpretation/approval of current Sites transaction links and which flows must be disabled immediately.
3. Cloud account/provider, billing owner, administrators, support tier and break-glass custody.
4. Identity retention vs migration and required MFA/recovery policy.
5. RPO, RTO, uptime/error/latency objectives and acceptable write-freeze length.
6. Record/evidence retention, correction/deletion and immutable-retention policy by workflow/jurisdiction.
7. Cutover strategy, rollback window and acceptable temporary customer impact.
8. Which integrations are required at first target release versus remain visibly unavailable.
