# Findings, risks, assumptions and decisions

Audit date: 21 July 2026 (Australia/Sydney)<br>
Final repository checkpoint: `ff3c8efe3d5e501286d8e83e28086d6d4590be27`<br>
Deployed application source recorded at that checkpoint: `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`, Sites version 199

This is the authoritative cross-report finding register. Severity describes impact; priority describes response order. A release block applies to the affected use or claim, not necessarily to every public informational page. Legal or provider-policy conclusions marked for confirmation are not legal advice.

## Priority summary

| ID | Finding | Severity / priority | Status | Blocks |
| --- | --- | --- | --- | --- |
| AUD-PLAT-001 | Sites transaction terms conflict with or may prohibit payment workflows | Critical / P0 | `BLOCKED` | Enabling payment creation/handoff on Sites |
| AUD-DATA-001 | Sites offers no data or inference residency at launch | Critical / P0 | `CONTRADICTED` | Residency-dependent production use |
| AUD-DATA-002 | Independent export, backup, PITR and restore are unproven | Critical / P0 | `UNKNOWN` | System-of-record/CRM release |
| AUD-OPS-001 | Workspace/provider continuity, transfer and non-AI administration are unproven | Critical / P0 | `UNKNOWN` | Business-critical CRM reliance |
| AUD-ARCH-001 | The combined Sites architecture is not suitable as the business-critical CRM | Critical / P0 | `PARTIAL` | Broad production-CRM claim |
| AUD-PRIV-001 | Privacy governance, retention, deletion and breach response are incomplete | High / P0 | `PARTIAL` | Broad personal-data release |
| AUD-COMP-001 | Assessment, licensing and scheme authority are not operationally proven | High / P0 | `UNKNOWN` | Regulated/accredited service claims |
| AUD-SEC-001 | Database Console concentrates owner privilege without proven independent recovery | High / P0 | `VERIFIED DEPLOYED` | Retaining the generic browse/mutation surface |
| AUD-DATA-005 | The 145-table schema declares no foreign keys | High / P1 | `PARTIAL` | Migration and data-integrity sign-off |
| AUD-DATA-003 | Migration SQL and Drizzle journal disagree for 11 production migrations | High / P1 | `CONTRADICTED` | Automated migration confidence |
| AUD-SEC-002 | No production Content-Security-Policy was observed | High / P1 | `PARTIAL` | Risk acceptance required |
| AUD-SEC-003 | Immediate Firebase token revocation, MFA and web session control are unproven | High / P1 | `PARTIAL` | High-privilege access sign-off |
| AUD-SEC-004 | Complete route/object authorization and abuse testing was not achieved | High / P1 | `UNKNOWN` | Multi-tenant security sign-off |
| AUD-OPS-003 | Unguarded synthetic-identity CLI targets the application Firebase project by default | High / P1 | `BROKEN` | Any use of the generator against shared/current identity infrastructure |
| AUD-API-001 | Paid-membership referral API has no tracked current caller and contradicts free-access truth | Medium / P1 | `STALE` | Orphan-free API and retired-subscription claims |
| AUD-INT-001 | Integration code is broader than operational provider readiness | High / P1 | `PARTIAL` | Claims that all integrations work |
| AUD-OPS-002 | Restore, load, resilience, CI enforcement and operational telemetry proof are incomplete | High / P1 | `PARTIAL` | Reliability/DR sign-off |
| AUD-DATA-004 | Retention, erasure and D1/R2 referential recovery are incomplete | High / P1 | `PARTIAL` | Durable evidence/file lifecycle claim |
| AUD-COMM-001 | Comparison, rebate and certificate-price assumptions need an owned substantiation process | High / P1 | `PARTIAL` | Unqualified savings/eligibility claims |
| AUD-DOC-001 | Current-truth documentation can contradict code and mutate during delivery | Medium / P1 | `CONTRADICTED` | Audit/release provenance confidence |
| AUD-UX-001 | Skip and membership-fragment navigation are broken on affected surfaces; dialog focus is inconsistent | Medium / P1 | `BROKEN` | WCAG conformance and complete-navigation claims |
| AUD-QA-001 | Automated breadth is strong, but critical full journeys and independent runtime proof are missing | High / P1 | `PARTIAL` | Complete-system claim |
| AUD-MOB-001 | Native field distribution remains blocked on accounts, credentials and device evidence | Medium / P2 | `BLOCKED` | Public store/mobile release |

## Detailed findings

### AUD-PLAT-001 — Sites transaction terms conflict with or may prohibit payment workflows

- **Category / severity / priority / status / confidence:** third-party/vendor dependency and compliance; Critical; P0; `BLOCKED`; High that the code initiates checkouts and the term exists, Medium on the legal scope of an external redirect.
- **Exact evidence:** `src/app/api/trade-payment-links/route.ts:163-322` creates Stripe Checkout or Square payment links; `docs/RELEASE_TRUTH.md:112-124` records the workflow in the deployed lineage. [ChatGPT Sites Terms §2.5, updated 9 July 2026](https://openai.com/policies/chatgpt-sites-terms/) says a Site must not initiate, execute or otherwise facilitate financial/investment transactions; §3.3 separately bars PCI-DSS payment-card data. The [Sites help article](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites) says Sites must not enable financial transactions or process card data.
- **Intended / current behavior:** TLink deliberately creates an external hosted checkout and reconciles verified callbacks while avoiding raw card data. The implementation nevertheless initiates/facilitates the transaction from the Sites Worker.
- **Impact / likelihood / root cause:** provider suspension, disabled payments, broken collections or forced migration; likelihood `UNKNOWN` pending written OpenAI determination and evidence of actual activation or enforcement. Product design predates or was not reconciled to the current Sites terms.
- **Affected components / dependencies:** payment-link route, Stripe/Square OAuth/connections/webhooks, invoice/deposit UI, Sites account and customers.
- **Recommended remediation:** disable production payment initiation on Sites unless OpenAI gives written confirmation for the exact architecture; move the payment backend and associated data to owner-controlled hosting. Do not infer that a redirect avoids “otherwise facilitate.”
- **Acceptance / validation:** written provider determination; architecture/data-flow review; no Sites endpoint creates, mutates or brokers a transaction unless expressly permitted; sandbox payment/reversal/reconciliation tests on the approved host.
- **Release blocking / confirmation:** Yes, for payment activation on Sites. OpenAI/provider counsel, payment compliance specialist and owner decision required.

### AUD-DATA-001 — Sites offers no data or inference residency at launch

- **Category / severity / priority / status / confidence:** data/compliance/vendor; Critical; P0; `CONTRADICTED`; High.
- **Exact evidence:** `.openai/hosting.json` binds production D1 and R2; personal and operational classes are listed at `src/app/privacy/page.tsx:19-35`. The [official Sites help article](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites) explicitly says data and inference residency are unavailable at launch, including deployed Sites, code, D1/R2 data/files, artifacts and logs.
- **Intended / current behavior:** the product retains customer, staff, address, quote, invoice, payment-status, audit and evidence records. Current hosting cannot provide a chosen Australian residency boundary.
- **Impact / likelihood / root cause:** inability to satisfy contractual or assessed cross-border/residency requirements; certain customers may be ineligible. This is an architectural/platform capability gap, not an application bug.
- **Affected components / dependencies:** all Sites code/logs, D1, R2, identity/integrations and privacy disclosures.
- **Recommended remediation:** complete the legal/data classification; select an owner-controlled Australian-region target when required; update notices/contracts from proven provider locations rather than marketing region labels.
- **Acceptance / validation:** approved data-flow and subprocessor register; contract/location evidence for every store/log/backup; deployment-policy tests; privacy review.
- **Release blocking / confirmation:** Yes for any residency commitment or customer requiring residency. Privacy counsel and commercial owner required.

### AUD-DATA-002 — Independent export, backup, PITR and restore are unproven

- **Category / severity / priority / status / confidence:** data integrity/recovery; Critical; P0; `UNKNOWN`; High confidence in the evidence gap.
- **Exact evidence:** no tracked backup/restore runbook or executed restore record; Sites documentation establishes bindings, not independent D1/R2 ownership or export. Official material does not establish owner querying/export, off-platform backup, PITR, schema/migration inspection or full R2 export. The in-app console at `src/app/api/admin/database/route.ts` is bounded browsing/mutation, not backup or restore.
- **Intended / current behavior:** the system treats D1/R2 records as durable CRM and evidence history. The owner cannot presently demonstrate a complete, independently held recovery copy.
- **Impact / likelihood / root cause:** catastrophic data loss, unverifiable accounting/evidence retention, lock-in and no tested recovery; impact is critical even if failure probability is unknown. Managed bindings were treated as durable access without a recovery contract.
- **Affected components / dependencies:** all 145 application tables, R2 evidence, migrations, provider references, audit records and Sites workspace.
- **Recommended remediation:** first obtain provider-supported complete exports without mutation; verify counts/hashes/references; store encrypted owner-controlled backups; rehearse restore to an isolated target; define RPO/RTO and immutable retention.
- **Acceptance / validation:** two successful scheduled exports; documented RPO/RTO; isolated restore from backup; table/row/key/object/hash reconciliation; application smoke and audit evidence; named restore owner.
- **Release blocking / confirmation:** Yes for system-of-record or business-critical CRM use. OpenAI support/contract owner, data owner and security owner required.

### AUD-OPS-001 — Workspace/provider continuity, transfer and non-AI administration are unproven

- **Category / severity / priority / status / confidence:** operational/vendor dependency; Critical; P0; `UNKNOWN`; High for the gap.
- **Exact evidence:** official Sites documentation says management is through ChatGPT web/desktop and does not provide a standalone Sites CLI/IDE management view. [Sites Terms §5.2](https://openai.com/policies/chatgpt-sites-terms/) permits removal, unpublishing or disabling. No provider-supported account/workspace transfer, outage procedure or independent control plane was evidenced.
- **Intended / current behavior:** the business owner should administer, deploy, observe and recover without depending on one AI workspace/session. Current control is materially coupled to Sites/ChatGPT.
- **Impact / likelihood / root cause:** inability to serve customers, deploy fixes or recover data after workspace, billing, policy or access failure; likelihood unknown, impact critical. Operational control was never made an explicit architecture requirement.
- **Affected components / dependencies:** Sites deployment, Worker, D1/R2, analytics/log access, account/billing and incident response.
- **Recommended remediation:** obtain written ownership/access/transfer facts; establish at least two named administrators; maintain owner-controlled source/artifacts/data backups; migrate production control plane.
- **Acceptance / validation:** documented access matrix and break-glass drill; second administrator deploy/recovery rehearsal; contractual exit path; continuity exercise during assumed Sites unavailability.
- **Release blocking / confirmation:** Yes for business-critical reliance. Business owner, OpenAI support/contract and operations owner required.

### AUD-ARCH-001 — The combined Sites architecture is not suitable as the business-critical CRM

- **Category / severity / priority / status / confidence:** architecture/operations; Critical; P0; `PARTIAL`; High.
- **Exact evidence:** the repository implements 94 API route files, 145 application tables, 79 production migrations, scheduled processing and R2 evidence; `05_CURRENT_ARCHITECTURE_AND_TECHNOLOGY.md` and `06_HOSTING_OWNERSHIP_AND_CRM_SUITABILITY.md` map the deployed topology. AUD-PLAT-001 through AUD-OPS-001 establish policy, residency, recovery and control gaps.
- **Intended / current behavior:** TLink is intended to be an authoritative trade operating system. It is a capable modular monolith, but its managed host/data/control boundary lacks the evidence required for that role.
- **Impact / likelihood / root cause:** operational lockout, non-recoverable records and constrained commercial use; the breadth of implemented product outgrew a beta hosting assumption.
- **Affected components / dependencies:** entire production application; migration is gated on complete export.
- **Recommended remediation:** migrate the complete production application to an owner-controlled managed modular-monolith architecture; do not introduce microservices/Kubernetes absent load evidence.
- **Acceptance / validation:** target controls meet the acceptance gates in `17_MOVE_OFF_SITES_DECISION_AND_PLAN.md`; shadow parity, restore, security, load and rollback tests pass.
- **Release blocking / confirmation:** Yes for the broad “business-critical production CRM” claim; bounded informational use can continue under explicit restrictions. Architecture, owner, privacy and operations sign-off required.

### AUD-PRIV-001 — Privacy governance, retention, deletion and breach response are incomplete

- **Category / severity / priority / status / confidence:** security/privacy/compliance; High; P0; `PARTIAL`; High.
- **Exact evidence:** notice content at `src/app/privacy/page.tsx:12-44,90-100`; no central retention schedule, deletion/de-identification job, subject-access/export workflow, legal-hold process, cross-provider erasure or privacy-breach runbook was found (`10_AUTH_SECURITY_PRIVACY_AND_COMPLIANCE.md`). Sites has no residency at launch. Privacy Act/APP applicability is unresolved because entity facts were unavailable.
- **Intended / current behavior:** collect only required information and honour consent/access/correction while retaining legally required records. Current statements are principles rather than a fully executable governance system.
- **Impact / likelihood / root cause:** over-retention, incomplete erasure, invalid disclosures, slow breach response and customer harm. Data domains grew faster than a formal data-governance program.
- **Affected components / dependencies:** leads, accounts, CRM, staff, evidence, invoices/payments, providers, logs/backups.
- **Recommended remediation:** establish entity coverage, controller identity, data inventory/purpose/country/retention schedule, data-subject workflow, deletion orchestration, legal holds and NDB incident playbook.
- **Acceptance / validation:** counsel-approved notice/register; sampled access/correction/deletion with provider and backup disposition; timed breach tabletop; automated retention tests and audit trail.
- **Release blocking / confirmation:** Yes for broad collection until minimum notice, purpose, retention and incident controls are approved. Privacy counsel and accountable privacy officer required.

### AUD-COMP-001 — Assessment, licensing and scheme authority are not operationally proven

- **Category / severity / priority / status / confidence:** compliance/industry; High; P0; `UNKNOWN`; High for the evidence gap.
- **Exact evidence:** `/assessments` markets NatHERS/BASIX pathways (`src/app/assessments/page.tsx:4-54`); NatHERS' 1 July 2026 existing-home policy requires specified consent/conflict/retention controls; state/territory electrical licensing and CER scheme eligibility differ. No current participant accreditation/licence/insurance or certificate-retention evidence was accessible.
- **Intended / current behavior:** guide customers to a valid assessment/installer and retain appropriate evidence. The public page correctly separates approval authority, but operational authority is unproved.
- **Impact / likelihood / root cause:** invalid certificate, unsafe/unlicensed work, lost scheme entitlement or misleading claim. Industry control records are not yet an auditable product dependency.
- **Affected components / dependencies:** assessments, marketplace verification, job forms/evidence, certificate/rebate content and state rules.
- **Recommended remediation:** establish a jurisdiction/job-type control register, verified credentials with expiry/review, consent/conflict forms and certificate retention before regulated delivery claims.
- **Acceptance / validation:** qualified reviewer approves each pathway; expired/unsupported actors are blocked; sample job contains required evidence and retention metadata.
- **Release blocking / confirmation:** Yes for claims of accredited/regulated service delivery; no for clearly bounded education. Accredited assessor, licensed contractor, regulator/scheme specialist and counsel required.

### AUD-SEC-001 — Database Console concentrates owner privilege without proven independent recovery

- **Category / severity / priority / status / confidence:** security/data integrity; High; P0; `VERIFIED DEPLOYED`; High.
- **Exact evidence:** release record `docs/RELEASE_TRUTH.md:124`; policy/SQL in `src/lib/admin-database-console.ts`; owner route `src/app/api/admin/database/route.ts`; UI `src/components/AdminDatabaseWorkspace.tsx`; tests `test/admin-database-console.test.mjs`. It limits insert/delete to three tables, recent owner auth, exact typed confirmation, redaction, bounds and atomic audit. Deletion was not exercised in production because writable tables were empty.
- **Intended / current behavior:** allow deliberate low-risk repair without raw SQL. It is deployed and materially safer than a generic database console, but exposes schema/row content across 145 tables and relies on one high-value identity and an unrecovered database.
- **Impact / likelihood / root cause:** owner compromise discloses broad data; allowed mutation can bypass higher-level UX and related domain workflows; impact high, exploitability depends on owner identity compromise. Operational need was solved inside the application because independent provider control was absent.
- **Affected components / dependencies:** Firebase owner identity, admin route/UI, D1, audit log, three writable tables, backup/restore.
- **Recommended remediation:** withdraw the current navigation and deny the generic route; abandon generic row mutation. If a demonstrated operational need remains, replace browsing with explicit, default-deny, projected read-only diagnostic views and implement repair only as named domain commands with purpose, approval, preview and recovery.
- **Acceptance / validation:** no production caller can enumerate arbitrary application tables or execute generic insert/delete; every diagnostic projection is explicitly classified; named repairs reuse authoritative services, pass revoked/stale-owner and tenant tests, alert off-screen and have proven recovery.
- **Release blocking / confirmation:** Yes for retaining or expanding the generic console. Security/data owners must accept any temporary exposure and authorise withdrawal/redesign.

### AUD-DATA-005 — The 145-table schema declares no foreign keys

- **Category / severity / priority / status / confidence:** data integrity/architecture; High; P1; `PARTIAL`; High.
- **Exact evidence:** `db/schema.ts` declares 145 regular tables; static inspection of the current schema and all 79 production migration SQL files found zero enduring `FOREIGN KEY`/`REFERENCES` relationships (`09_DATA_DATABASE_STORAGE_AND_MIGRATIONS.md:80-94`). Application queries and domain services enforce relationships through text IDs and owner/customer UIDs.
- **Intended / current behavior:** child records should remain attached to valid owners, customers, jobs, commercial versions and evidence metadata. Current integrity depends entirely on every application/migration/admin path enforcing the same rules.
- **Impact / likelihood / root cause:** orphan rows, cross-tenant linkage mistakes, fragile imports/deletes and manual restore ordering; likelihood grows with migration, direct administration and partial failure. The schema evolved through application-enforced D1 patterns without a database relationship layer.
- **Affected components / dependencies:** all relational domains, especially owner/customer/job children, quote/version/items, invoice/payment ledgers, evidence metadata and mobile upload sessions; D1 and target PostgreSQL.
- **Recommended remediation:** first run privacy-safe orphan/integrity reports and document real optional relationships; add constraints to new/high-value boundaries in bounded forward migrations only after repairing legacy exceptions. Do not mass-retrofit without production evidence.
- **Acceptance / validation:** every high-value relationship has an explicit constraint or documented, tested exception; orphan count is zero or enumerated/approved; deletion/import/restore tests prove order and tenant invariants; migration rollback/forward-fix plan is rehearsed.
- **Release blocking / confirmation:** Yes for target data migration and strong integrity claims; existing production requires explicit risk acceptance. Database and domain owners required.

### AUD-DATA-003 — Migration SQL and Drizzle journal disagree for 11 production migrations

- **Category / severity / priority / status / confidence:** data/schema; High; P1; `CONTRADICTED`; High.
- **Exact evidence:** 79 production migration SQL files versus 68 Drizzle journal entries. SQL absent from the journal: `0045`, `0059`, `0070`, `0071`, `0072`, `0073`, `0074`, `0075`, `0076`, `0077`, `0078`; no journal entry lacks SQL. Counts were derived from `drizzle/*.sql` and `drizzle/meta/_journal.json` at final checkpoint.
- **Intended / current behavior:** one ordered migration history should reproduce the canonical schema. Project validation replays all SQL independently, while ORM journal metadata stops short.
- **Impact / likelihood / root cause:** a tool that trusts the journal may omit 11 migrations or misrepresent schema history; high during migration/automation. Later SQL was added outside the journal generation path.
- **Affected components / dependencies:** Drizzle tooling, clean replay, Sites/target migrations and schema provenance.
- **Recommended remediation:** decide the canonical migrator; reconcile metadata without rewriting applied history; document production ledger and checksum mapping.
- **Acceptance / validation:** clean database reaches identical schema via approved migrator; 79/79 files and checksums mapped to an immutable applied ledger; drift test fails on mismatch.
- **Release blocking / confirmation:** Yes for automated target migration/cutover, not current read-only audit. Database owner required.

### AUD-SEC-002 — No production Content-Security-Policy was observed

- **Category / severity / priority / status / confidence:** security; High; P1; `PARTIAL`; High for the dated observation.
- **Exact evidence:** 21 July 2026 canonical-domain response had HSTS, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options` and `X-Frame-Options`, but no `Content-Security-Policy`; release truth also records this at `docs/RELEASE_TRUTH.md:125`.
- **Intended / current behavior:** browser execution should be constrained if an XSS or compromised dependency occurs. Other headers do not provide script/source containment.
- **Impact / likelihood / root cause:** XSS blast radius includes Firebase tokens and owner/customer actions; exploit requires a script-injection primitive not established by this audit. CSP was not configured/tested in the deployed host.
- **Affected components / dependencies:** all web pages, third-party endpoints/assets, Sites header controls.
- **Recommended remediation:** inventory required origins; deploy report-only policy, eliminate violations, then enforce nonce/hash-based CSP on a host that supports it.
- **Acceptance / validation:** zero unexplained report-only violations across critical journeys; automated header checks; stored/reflected/DOM XSS tests; enforced CSP confirmed live.
- **Release blocking / confirmation:** Risk acceptance required for current release; Yes before a strong security/conformance claim. Security owner required.

### AUD-SEC-003 — Immediate Firebase token revocation, MFA and web session control are unproven

- **Category / severity / priority / status / confidence:** authentication/security; High; P1; `PARTIAL`; Medium-high.
- **Exact evidence:** `src/lib/admin-server.ts` verifies Firebase ID tokens but the audit did not find revoked-token checking equivalent to `verifyIdToken(token, true)` or a repository revocation list; no web session/device management UI was found. Firebase-console password, bot, MFA and authorised-domain settings were inaccessible (`10_AUTH_SECURITY_PRIVACY_AND_COMPLIANCE.md`). Mobile has a separate device-revocation/purge path.
- **Intended / current behavior:** loss of a privileged identity/device should end access quickly. A stolen still-valid token may remain usable until expiry unless downstream account/device state blocks that route.
- **Impact / likelihood / root cause:** owner/admin impersonation, database-console access and cross-workflow compromise; exploitability requires token theft. Authentication provider assurance was assumed beyond repository-visible authorization.
- **Affected components / dependencies:** Firebase, owner/admin/trade/customer tokens, admin and database routes.
- **Recommended remediation:** define session/MFA/revocation requirements; enable and prove provider controls; check revocation/high-risk account state for privileged routes; add owner session inventory and alerting.
- **Acceptance / validation:** revoke a test privileged session and prove denial within approved latency; MFA/recovery/bot-policy screenshots or API evidence; automated stale/revoked-token tests.
- **Release blocking / confirmation:** Yes for high-privilege sign-off until accepted/mitigated. Identity and security owners required.

### AUD-SEC-004 — Complete route/object authorization and abuse testing was not achieved

- **Category / severity / priority / status / confidence:** authorization/security; High; P1; `UNKNOWN`; Medium.
- **Exact evidence:** 94 API route files; repeated owner/role checks and focused tests exist, but this audit did not exhaustively execute horizontal-object, reassignment, stale-invitation, capability-token replay, rate-limit and mixed owner/team cases for every method (`08_BACKEND_API_WORKERS_AND_JOBS.md`; `10_AUTH_SECURITY_PRIVACY_AND_COMPLIANCE.md`).
- **Intended / current behavior:** every server route must enforce role, tenant and object authorization independent of UI. Good patterns do not prove complete coverage.
- **Impact / likelihood / root cause:** cross-tenant/customer disclosure or mutation; likelihood unknown. Rapid route growth lacks a mechanically enforced policy manifest.
- **Affected components / dependencies:** all API routes, Firebase identities, capability links, D1/R2 objects and provider callbacks.
- **Recommended remediation:** generate a route/method auth manifest; assign data owner; add negative authorization, replay and abuse suites; independently review highest-value paths first.
- **Acceptance / validation:** 94/94 route files and every exported method mapped to auth/rate/data policy; IDOR matrix passes across two tenants and roles; token/webhook replay tests pass.
- **Release blocking / confirmation:** Yes for multi-tenant security certification; security reviewer and domain owners required.

### AUD-OPS-003 — Unguarded synthetic-identity CLI targets the application Firebase project by default

- **Category / severity / priority / status / confidence:** operational safety/identity/data; High; P1; `BROKEN`; High for the source defect, `UNKNOWN` for live provider acceptance or prior execution.
- **Exact evidence:** `scripts/seed-synthetic-population.mjs:8-14,57-105,107-138,300-321` defaults to the same Firebase client project configured at `src/lib/firebase-client.ts:7-9`, drafts 100 installer, 50 wholesaler and 200 consumer identities, then attempts sign-up/sign-in/profile updates. It writes plaintext password checkpoint/CSV output and overwrites its selected SQL path; the default SQL path is the tracked synthetic fixture. `docs/SYNTHETIC_BENCHMARK.md:9-11` says paths must be explicit and output must remain outside the repository, but code does not enforce either rule.
- **Intended / current behavior:** create an isolated opt-in benchmark population. Current source has no test-project/emulator allowlist, dry-run default, target confirmation, account-count limit argument, broker host/HTTPS/nonempty-secret validation or provider rollback.
- **Impact / likelihood / root cause:** accidental identity pollution, quota/cost, password-file exposure and fixture overwrite; partial provider mutation survives failure, while completed reruns are not idempotent because they generate new passwords for fixed emails. Likelihood depends on a human running the unadvertised direct command; provider acceptance/history remains unknown.
- **Affected components / dependencies:** Firebase Authentication project, synthetic identities, ignored output directory, tracked fixture SQL, benchmark documentation and anyone with repository execution access.
- **Recommended remediation:** disable direct provider defaults; require a distinct approved emulator/test project and exact typed confirmation, make dry-run the default, validate broker destination/secret, require an external output root, add bounded cleanup/reconciliation and keep generated credentials out of source/workspace backups.
- **Acceptance / validation:** zero-argument execution performs no provider or filesystem mutation; production project ID is rejected; tests cover wrong target, missing confirmation, partial failure, rerun and cleanup; read-only Firebase audit establishes whether synthetic accounts exist before any deletion decision.
- **Release blocking / confirmation:** Yes for executing or distributing the generator as operational tooling. Identity/security owner approval and isolated-provider evidence required; this audit did not run it or access Firebase.

### AUD-API-001 — Paid-membership referral API has no tracked current caller and contradicts free-access truth

- **Category / severity / priority / status / confidence:** API/product lifecycle; Medium; P1; `STALE`; High for tracked-source reachability, Medium for unknown external/manual consumers.
- **Exact evidence:** the complete client/server reconciliation in `08_BACKEND_API_WORKERS_AND_JOBS.md` maps 83 web API bases, two mobile-only routes and all callback/probe/billing exceptions. `/api/trade-referrals` GET/POST is the sole route module with no current component, page, mobile, monitor or provider caller. Its POST requires an active paid membership (`src/app/api/trade-referrals/route.ts:113-151`), while current product truth makes core trade access free (`src/app/direct-trade/membership/page.tsx:7-55`; `docs/RELEASE_TRUTH.md:36-38`).
- **Intended / current behavior:** historical members could generate/view referral rewards under the retired subscription model. Current UI has no caller and the remaining membership page only links legacy billing management.
- **Impact / likelihood / root cause:** unnecessary authenticated attack/maintenance surface, confusing contract and possible revival of obsolete paid-access behavior; direct use requires a signed-in paid historical account, and undocumented external consumers remain `UNKNOWN`.
- **Affected components / dependencies:** trade referral route/tables/helpers, Stripe referral reconciliation, membership terms and historical paid-member records.
- **Recommended remediation:** obtain product/legal decision on outstanding referral obligations and query counts before mutation. If none remain, disable then remove the route and obsolete referral workflow in one bounded migration; otherwise document an explicit time-limited consumer, owner, data-retention contract and retirement date.
- **Acceptance / validation:** every retained route has a named tracked or external consumer and owner; current free-access behavior cannot generate new paid referral obligations; historical credits remain reconciled/exportable; API/deprecation tests and docs agree.
- **Release blocking / confirmation:** Does not block unrelated informational use. Blocks “no orphan endpoints” and fully retired subscription/referral claims until owner disposition.

### AUD-INT-001 — Integration code is broader than operational provider readiness

- **Category / severity / priority / status / confidence:** third-party/integration; High; P1; `PARTIAL`; High.
- **Exact evidence:** OAuth/adapters exist for Google, Microsoft, Xero, MYOB, QuickBooks, Stripe and Square; `docs/RELEASE_TRUTH.md:119` records absent central registrations/credentials at Sites v187. Later handover statements are mixed by provider. Repository code cannot prove provider accounts, scopes, billing, quotas, production webhooks or reconciliation.
- **Intended / current behavior:** installer-owned connections should show truthful readiness and leave TLink authoritative. UI readiness states are deployed, but operational status varies and live full-provider transactions were generally avoided.
- **Impact / likelihood / root cause:** false “connected/sent/paid/synced” state, unusable release or unreconciled records. Adapter delivery advanced ahead of account/provider onboarding.
- **Affected components / dependencies:** email, SMS, calendars, accounting, payments, Firebase, Apps Script monitoring and callbacks.
- **Recommended remediation:** provider-by-provider launch checklist and owner; least-privilege registration; sandbox journey; webhook/key rotation; reconciliation/manual recovery; explicit unavailable state.
- **Acceptance / validation:** each provider independently proves consent, create, callback, duplicate/replay, timeout, disconnect, reconnect and reconciliation with disposable records; runbook and dashboard owner recorded.
- **Release blocking / confirmation:** Yes only for claims/enabling of the affected provider. Provider account owners and security/privacy review required.

### AUD-OPS-002 — Restore, load, resilience, CI enforcement and operational telemetry proof are incomplete

- **Category / severity / priority / status / confidence:** testing/operations; High; P1; `PARTIAL`; High.
- **Exact evidence:** local full suite passed 697/699 with two fixture-dependent skips; release records claim build/migration/live checks. No executed independent restore, production load/capacity, chaos/failover, full accessibility, dependency/secret scan or durable SLO/alert ownership proof was obtained. Worker-log queries during the audit returned inconsistent transient snapshots, so zero errors is not inferred.
- **Intended / current behavior:** releases should be reproducible, observable, capacity-bounded and recoverable. Current evidence is strongest for code regression and narrow live QA.
- **Impact / likelihood / root cause:** slow failure detection, overload, rollback failure or confidence based on transient/manual checks. Delivery is fast and mostly manually evidenced through Sites.
- **Affected components / dependencies:** GitHub, Sites builds/deployments, migrations, Worker cron, Apps Script/Gmail alerts, D1/R2 and provider callbacks.
- **Recommended remediation:** owner-controlled CI/IaC, immutable artifact/provenance, staging, SLI/SLO/error retention, capacity test and restore/failover drills.
- **Acceptance / validation:** protected CI gates on exact commit; signed artifact; representative load and degraded-provider tests; 30-day telemetry retention; timed incident/restore drill; rollback exercise.
- **Release blocking / confirmation:** Yes for reliability/DR claims and target cutover. Operations/SRE owner required.

### AUD-DATA-004 — Retention, erasure and D1/R2 referential recovery are incomplete

- **Category / severity / priority / status / confidence:** data integrity/privacy; High; P1; `PARTIAL`; High.
- **Exact evidence:** evidence metadata and objects span D1/R2; privacy notice acknowledges files and retained legal/accounting records (`src/app/privacy/page.tsx:19-43`). No complete lifecycle schedule, orphan reconciliation, malware-control evidence, cross-store transactional guarantee, erasure orchestration or restored object/hash reconciliation was found (`09_DATA_DATABASE_STORAGE_AND_MIGRATIONS.md`).
- **Intended / current behavior:** authorised files should stay linked, safe, reviewable, retained and deletable according to purpose/law. Database and object storage are separate failure domains.
- **Impact / likelihood / root cause:** orphan/leaked files, missing evidence, incomplete deletion or corrupted handover. Feature-specific upload protections exist without a platform-wide lifecycle controller.
- **Affected components / dependencies:** customer/project/job evidence, field uploads, R2, signed downloads/previews, D1 metadata, backups.
- **Recommended remediation:** canonical object manifest/hash/state machine; quarantine/scanning proportional to risk; lifecycle/retention rules; orphan sweeps; deletion/legal-hold states; backup/restore reconciliation.
- **Acceptance / validation:** generated corpus proves MIME/size/auth controls; two-sided orphan test; retention/deletion/legal-hold test; restored object counts/hashes/references match.
- **Release blocking / confirmation:** Yes for durable regulated-evidence claims. Data/privacy/security owners required.

### AUD-COMM-001 — Comparison, rebate and certificate-price assumptions need an owned substantiation process

- **Category / severity / priority / status / confidence:** commercial/industry/correctness; High; P1; `PARTIAL`; Medium-high.
- **Exact evidence:** scenario defaults and omissions are dated/disclosed (`README.md:47-53`); certificate prices are scraped from a third-party page and explicitly called indicative (`src/lib/certificate-prices-server.ts:9,58-81,131`). AER product API constraints and changing scheme eligibility remain external dependencies.
- **Intended / current behavior:** help consumers compare options without presenting estimates as quotes, guaranteed savings or eligibility. Disclaimers are useful but do not substitute for accurate inputs and substantiation.
- **Impact / likelihood / root cause:** customer financial harm and Australian Consumer Law exposure if stale/incomplete assumptions affect the overall impression. Content/data freshness is decentralized.
- **Affected components / dependencies:** comparators, scenarios, rebates, certificate history, guides, public copy and lead handoff.
- **Recommended remediation:** source/version/owner/freshness register for every material assumption/claim; sample bill reconciliation; stale-source fail-closed labels; commercial-influence disclosure.
- **Acceptance / validation:** predeclared representative fixtures reconcile within approved tolerance; stale/unavailable sources produce explicit states; counsel/content owner signs claim inventory.
- **Release blocking / confirmation:** Yes for unqualified savings, price or eligibility claims. Energy-market/scheme specialist and consumer-law counsel required.

### AUD-DOC-001 — Current-truth documentation can contradict code and mutate during delivery

- **Category / severity / priority / status / confidence:** documentation/provenance; Medium; P1; `CONTRADICTED`; High.
- **Exact evidence:** during the audit, snapshot A was `543cc189` plus dirty Database Console files; B committed them at `4a5cd19` while docs still said in progress/v198; C added dirty v199 records; D committed those records at `ff3c8ef`. Other contradictions include mobile contract v2 versus v3, service email disabled versus enabled and stale Netlify monitoring text (`04_DOCUMENTATION_TRUTH_AND_LINK_AUDIT.md`).
- **Intended / current behavior:** `RELEASE_TRUTH.md` is canonical, with planning clearly separated. It becomes accurate after manual release edits, leaving windows of contradiction and historical claims that are difficult to verify independently.
- **Impact / likelihood / root cause:** wrong release decisions, AI hallucinated status and audit drift; recurring during rapid delivery. Multiple long-form status documents are manually maintained.
- **Affected components / dependencies:** release truth, handover, roadmap, runbooks, mobile docs and Sites provenance.
- **Recommended remediation:** machine-readable release/status registry generated from immutable build/deploy evidence; metadata/owners/review dates; automated contradiction/link checks; archive historical narrative.
- **Acceptance / validation:** one current-status query returns source, saved version, deployment and runtime checkpoint; no current doc claims planned work as live; CI fails stale/contradictory links.
- **Release blocking / confirmation:** No for bounded fixes; Yes for release certification. Product/release/documentation owners required.

### AUD-UX-001 — Skip and membership-fragment navigation are broken; dialog focus is inconsistent

- **Category / severity / priority / status / confidence:** accessibility/frontend; Medium; P1; `BROKEN`; High for skip target, Medium for complete dialog scope.
- **Exact evidence:** the global layout supplies a skip link at `src/app/layout.tsx:38`, while several route families do not render the target emitted by `src/components/ComparatorChrome.tsx:35`; dialog implementations vary in focus entry, containment and return (`07_FRONTEND_UX_AND_ACCESSIBILITY.md`). Static continuation also found `#membership` links at `src/components/SupplierCatalogueWorkspace.tsx:855,1028` and `src/components/TradeHandoverCentre.tsx:264`, while the only membership-page heading ID is `membership-access-title` at `src/app/direct-trade/membership/page.tsx:47`. No complete WCAG 2.2 AA or assistive-technology acceptance was executed.
- **Intended / current behavior:** keyboard/screen-reader users should bypass repeated navigation and interact with every modal without losing context.
- **Impact / likelihood / root cause:** keyboard users encounter dead navigation or focus loss; the missing fragment IDs are deterministic and the skip failure is reproducible on affected route families. Accessibility/navigation primitives are feature-local rather than shared/enforced.
- **Affected components / dependencies:** global layout/header, account/operations/trade pages, supplier catalogue, handover gating and modal/dialog components.
- **Recommended remediation:** provide one guaranteed main target per layout; replace/remove the two missing membership fragment targets with a valid destination; use one tested dialog primitive; preserve initial/contained/returned focus; document exceptions.
- **Acceptance / validation:** route/link crawler confirms every fragment resolves and every page has one unique valid skip target; keyboard and screen-reader checks across representative page families; axe/static checks plus manual WCAG 2.2 AA review.
- **Release blocking / confirmation:** Yes for a WCAG conformance claim; accessibility owner/specialist required.

### AUD-QA-001 — Automated breadth is strong, but critical full journeys and independent runtime proof are missing

- **Category / severity / priority / status / confidence:** testing/product; High; P1; `PARTIAL`; High.
- **Exact evidence:** three recorded audit runs of `npm.cmd test` across the coordinating and specialist streams each reported 699 tests, 697 pass, 0 fail, 2 skip. Skips at `test/electricity-model.test.js:205` and `test/nem12-typed-parity.test.mjs:92` depend on an unavailable Origin fixture. Many release checks deliberately avoid production mutation. No complete household-to-provider, restore, physical-device, accessibility or large-volume journey was executed here.
- **Intended / current behavior:** critical business outcomes should have contract, sandbox end-to-end and dated runtime evidence. Current tests strongly exercise server contracts but are not equivalent to live provider or recovery proof.
- **Impact / likelihood / root cause:** undiscovered configuration/integration/recovery failures despite green local tests. Production safety correctly avoids mutation but there is no representative staging environment.
- **Affected components / dependencies:** comparisons, marketplace, trade job, payments/accounting, evidence, mobile and operations.
- **Recommended remediation:** owner-controlled staging with synthetic data/provider sandboxes; critical-journey suite; restore/load/accessibility/security gates; immutable result archive.
- **Acceptance / validation:** every release-critical journey maps to a passing contract test, sandbox E2E and scoped runtime smoke; intentional skips have fixture owner/provenance or are removed through valid coverage.
- **Release blocking / confirmation:** Yes for complete-product claim and target cutover. QA/product/provider owners required.

### AUD-MOB-001 — Native field distribution remains blocked on accounts, credentials and device evidence

- **Category / severity / priority / status / confidence:** product/third-party; Medium; P2; `BLOCKED`; High.
- **Exact evidence:** `mobile/README.md:37-46` requires Apple/Google developer accounts, signing and Firebase files; `docs/RELEASE_TRUTH.md:125` repeats the prerequisite. Mobile docs disagree on transport contract v2/v3.
- **Intended / current behavior:** assigned technicians use an encrypted offline app with server-authoritative replay and revocation. Source/contracts exist, but store builds and physical-device acceptance are unproven.
- **Impact / likelihood / root cause:** technicians cannot rely on the advertised native workflow; credential/account decisions are external to code.
- **Affected components / dependencies:** Expo app, Firebase mobile config, APNs/FCM, app stores, device security and sync API.
- **Recommended remediation:** reconcile contract docs; owner supplies accounts/credentials; produce signed internal builds; run iOS/Android offline/conflict/revocation/accessibility acceptance.
- **Acceptance / validation:** two supported physical-device families complete assignment, offline work/media, replay/conflict, revocation purge and notification tests; signing/rotation/runbook proven.
- **Release blocking / confirmation:** Yes for native-app release, not web CRM. Mobile product owner and platform account owners required.

## Separate finding registers

| Register | Findings |
| --- | --- |
| Confirmed defects | AUD-UX-001; AUD-DATA-003; AUD-DOC-001 |
| Security/privacy exposure | AUD-PRIV-001; AUD-SEC-001; AUD-SEC-002; AUD-SEC-003; AUD-SEC-004; AUD-DATA-004 |
| Compliance uncertainty | AUD-PLAT-001; AUD-DATA-001; AUD-PRIV-001; AUD-COMP-001; AUD-COMM-001 |
| Data-integrity and recovery risk | AUD-DATA-002; AUD-DATA-003; AUD-DATA-004; AUD-DATA-005; AUD-OPS-002 |
| Architecture and operational debt | AUD-ARCH-001; AUD-OPS-001; AUD-OPS-002; AUD-QA-001 |
| Third-party/vendor dependency | AUD-PLAT-001; AUD-DATA-001; AUD-OPS-001; AUD-INT-001; AUD-MOB-001 |
| Commercial and industry assumptions | AUD-COMP-001; AUD-COMM-001; AUD-PLAT-001 |
| Documentation and ownership gaps | AUD-DOC-001; AUD-OPS-001; AUD-QA-001 |

## Contradiction register

| ID | Evidence A | Evidence B | Disposition |
| --- | --- | --- | --- |
| C-001 | Snapshot B at `4a5cd19` contained the committed console while handover said “in progress” and release truth ended at v198 | Snapshot D at `ff3c8ef` records v199 from implementation `4a5cd19` | Historical audit states preserved; D is final source checkpoint, v199/4a5 is deployed checkpoint |
| C-002 | 79 production SQL migration files | 68 Drizzle journal entries | Unresolved; SQL replay evidence does not make the journal complete |
| C-003 | Mobile README says transport v2 | mobile sync document/code describe v3 | Current code must decide; documentation correction deferred beyond audit |
| C-004 | Service reminder runbook says email disabled | later release truth records Resend enabled/accepted send | Release record newer; provider callback/mailbox delivery still separately bounded |
| C-005 | Operations runbook references an older Netlify scheduled path | target README says Sites is active and no tracked active Netlify deployment configuration was found | Treat Netlify text as stale/historical pending documentation cleanup |
| C-006 | Code can create payment checkouts | current Sites terms prohibit initiating/executing/otherwise facilitating financial transactions | Block activation pending provider/legal determination or migration |

## Unknown and assumption register

| ID | Unknown/assumption | Evidence needed to close |
| --- | --- | --- |
| U-001 | Legal entity, APP coverage, controller and billing owner | Entity chart, turnover/exception analysis, contracts and counsel memo |
| U-002 | Sites/D1/R2 account ownership, export, PITR, transfer and outage behavior | Written OpenAI support/contract response plus witnessed export/restore |
| U-003 | Complete production database/object counts and consistency | Privacy-safe aggregate export, schema/checksum/object manifest and reconciliation |
| U-004 | Firebase tenant settings, MFA, revocation, authorised domains, recovery and billing owner | Read-only console/API evidence and controlled security tests |
| U-005 | Provider registrations, credential scopes, billing, quotas and actual production readiness | Provider-by-provider account inventory and sandbox/production acceptance |
| U-006 | Current licences/accreditations/insurance and expiry handling | Primary-register extracts, identity match and renewal/revocation workflow |
| U-007 | Approved RPO, RTO, SLO, concurrency and growth targets | Owner-approved requirements and measured workload/retention forecast |
| U-008 | Current Worker error/latency history | Durable owner-accessible telemetry over a defined period; transient query is insufficient |
| U-009 | Complete WCAG 2.2 AA behavior | Automated scan plus keyboard/screen-reader/zoom/reflow testing with representative users |
| U-010 | Full source-to-production route parity | Saved-version manifest, deployed route smoke matrix and immutable provenance |

## Owner decision packets

### OD-001 — Immediate Sites operating restriction

- **Decision:** disable payment initiation and restrict the Site to bounded current use, or accept policy risk while seeking written provider confirmation.
- **Recommended default:** do not enable financial transaction paths; start complete migration.
- **Needed from:** business owner, counsel and OpenAI account/support contact.
- **Decision evidence:** exact payment data flow, current Sites terms, provider response and commercial consequence.

### OD-002 — Target ownership and Australian-region posture

- **Decision:** nominate the legal/billing owner, cloud account, required Australian-region boundary and administrators.
- **Recommended default:** owner-controlled managed modular monolith with managed PostgreSQL and versioned object storage in an Australian region; AWS Sydney is a reference, not a preselected vendor.
- **Needed from:** owner, privacy/security lead, finance/procurement and architecture lead.

### OD-003 — Data recovery objectives

- **Decision:** approve data classes, retention, RPO, RTO, legal holds and backup custody.
- **Recommended default:** no cutover until complete export and isolated restore are proven; exact RPO/RTO must be owner-set from business impact.
- **Needed from:** data owner, operations, privacy/legal and finance/tax.

### OD-004 — Product claim and regulated-work boundary

- **Decision:** which assessment/installation/scheme services are actually delivered, by which entity and qualified actors, in which jurisdictions.
- **Recommended default:** keep content educational and bounded until authority and operational controls are proven.
- **Needed from:** commercial owner, accredited assessors, licensed contractors and counsel.

### OD-005 — Provider launch set

- **Decision:** which email, calendar, accounting, payment, SMS and identity providers are required for first release.
- **Recommended default:** activate only providers with an accountable account owner and complete sandbox/reconciliation/runbook evidence; keep the rest unavailable.
- **Needed from:** product owner, finance, operations, privacy/security and provider account owners.

### OD-006 — Database Console disposition

- **Decision:** retain bounded console under explicit risk, make it read-only, or replace it after migration with owner-controlled administration.
- **Recommended default:** withdraw generic browse/mutation; retain only explicit projected read-only diagnostics if justified, and route any later repair through named domain commands.
- **Needed from:** owner, data owner and security reviewer.

### OD-007 — Staffing scenario

- **Decision:** fund a single sequential team or parallel platform/product assurance streams.
- **Recommended default:** protect one accountable technical lead and distinct data/security/industry reviewers; no calendar promise until access/export gates close.
- **Needed from:** business owner and delivery lead.

## Final decision record

- **Current CRM suitability:** `NOT SUITABLE` for a business-critical production CRM as a combined architecture. Selected informational or bounded non-transactional workflows may remain under explicit restrictions.
- **Sites migration verdict:** `MIGRATE THE COMPLETE PRODUCTION APPLICATION`.
- **Target shape:** owner-controlled managed modular monolith, managed PostgreSQL, versioned object storage, owner-controlled identity and secrets, durable jobs/queues, observable CI/CD and tested recovery; no microservices or Kubernetes without measured need.
- **Audit completion verdict:** recorded in `00_AUDIT_MANIFEST_AND_COVERAGE.md`; external/provider unknowns mean the complete requested current-state stopping criteria cannot be met without additional access.
