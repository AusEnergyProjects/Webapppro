# Database Console security review

Audit date: 2026-07-21 (Australia/Sydney)<br>
Repository: `C:\Webproject\aea-energy-domain-migration`<br>
Final repository snapshot: `ff3c8efe3d5e501286d8e83e28086d6d4590be27` on `codex/sites-custom-domain-migration`<br>
Application implementation snapshot: `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`<br>
Recorded deployment: Sites version 199, deployment `appgdep_6a5f78c0b3cc81919214c0deb5a3a8f3`

## Decision

The current generic database mutation capability should be withdrawn from production and abandoned as an administrative design. If direct inspection remains operationally necessary, redesign it as a strictly read-only, explicit-allowlist diagnostics surface with named views and explicit projected columns. Data repair should be implemented only as bounded business commands through the authoritative domain services.

This is not a claim that the implementation exposes arbitrary SQL. It does not. It is carefully bounded compared with a conventional SQL console: identifiers come from live metadata and a strict pattern, values are bound, pages and bodies are capped, internal tables are hidden, only three tables allow one-row insert/delete, mutations require an owner and recent authentication, and row plus audit are executed in a D1 batch.

The problem is the authority the feature still creates:

- the production release record says one owner can enumerate 145 application tables and browse real rows across tenants;
- the read policy is default-visible, not default-deny;
- secret redaction is name-based and still returns names, emails, phones, addresses, free text and financial/operational records;
- the three generic mutations hard-delete or insert rows outside the normal tenant-scoped services;
- recent `auth_time` is not MFA or a purpose-specific step-up;
- there is no reason/ticket capture, backup-before-change, console-specific rate limit, second approver or recovery action;
- an application console cannot provide provider ownership, export, off-platform backup, point-in-time recovery, schema administration, disaster recovery or an exit strategy.

The console is now `VERIFIED DEPLOYED` according to the new committed release record and concurrent release-task evidence, even though the audit brief explicitly said not to complete or deploy it. That process state is `CONTRADICTED`. This audit workstream did not implement, commit, push, package, publish, deploy or mutate production data.

## Snapshot and provenance reconciliation

The repository and deployment state crossed four checkpoints while this read-only audit was in progress. Treating only the final tree as if it had existed at audit start would destroy important evidence.

| Snapshot | Repository state | Console state | Deployment truth |
|---|---|---|---|
| A: audit start | HEAD `543cc189f990708e8204d3a2fdf44713322a53fb`; console changes were dirty/untracked along with edits to handover/admin files/tests | Uncommitted work-in-progress evidence | Latest recorded release was Sites v198 from `f05995b...`; console not deployment-verified |
| B: implementation commit | HEAD/origin moved to `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`, commit `feat: add protected owner database console` | Nine implementation/handover/test paths committed and pushed by an external concurrent task | Deployment still unverified at that instant |
| C: production transition | Source remained `4a5cd19`; release-document edits were temporarily dirty | Application source unchanged from B; Sites v199 was deployed by an external concurrent task | Sites v199 reported from implementation SHA `4a5cd19`, deployment `appgdep_6a5f78c0b3cc81919214c0deb5a3a8f3` |
| D: final immutable checkpoint | HEAD/origin moved to `ff3c8efe3d5e501286d8e83e28086d6d4590be27`, commit `docs: record owner database console release` | Application source unchanged from B/C; handover/release docs reconciled and committed | Sites v199 remains deployed from `4a5cd19`; the final repository commit is its documentation-only child |

`docs/RELEASE_TRUTH.md:124` records complete validation, canonical health, empty recent worker errors and signed-in production QA. The QA browsed real rows, observed four integration credential cells rendered as protected, opened the guarded add flow, and checked desktop/390 px overflow. All three writable production tables were empty, so no production insert/delete was attempted. That is useful read-path evidence; it does not validate mutation rollback, dependency side effects, recovery or every PII field.

The final repository HEAD is a documentation-only child of the application implementation SHA. Executed audit checks at `4a5cd19` remain source-relevant because `ff3c8ef` changes only `docs/HANDOVER_NEXT_TASK.md` and `docs/RELEASE_TRUTH.md`. The audit did not independently repeat the release task's provider operations.

## What the deployed console does

### Catalogue and browsing

The GET route:

1. requires accepted origin and the `owner` admin role (`src/app/api/admin/database/route.ts:113-117`);
2. executes `PRAGMA table_list`, keeps ordinary `main` tables, applies policy, sorts and returns visible entries (`src/app/api/admin/database/route.ts:33-40`);
3. validates the selected table against that live catalogue, reads `PRAGMA table_xinfo`, and rejects missing column metadata (`src/app/api/admin/database/route.ts:42-51`);
4. runs an exact count and `SELECT *`, ordered by primary key or `rowid`, at 25/50/100 rows per page with offset capped at 10,000 (`src/app/api/admin/database/route.ts:123-157`; `src/lib/admin-database-console.ts:1-5`, `175-182`);
5. redacts values whose column names match the protected-name rule, reports BLOB byte size and clips long strings (`src/lib/admin-database-console.ts:154-159`, `201-235`).

The release record says the live catalogue contained 145 visible application tables (`docs/RELEASE_TRUTH.md:124`). This makes broad production enumeration an observed deployed behaviour, not merely a theoretical source path.

### Mutation

Mutation is allowlisted to:

- `workspace_list_views`;
- `trade_team_working_hours`;
- `trade_team_unavailability`.

The policy grants insert and delete only to these three tables (`src/lib/admin-database-console.ts:65-81`). POST/DELETE require owner auth, a Firebase `auth_time` no older than 15 minutes, exact typed confirmation, live metadata validation and D1 batch execution (`src/app/api/admin/database/route.ts:83-86`, `165-210`).

Insert preparation:

- replaces caller-supplied text IDs with a server UUID when appropriate;
- generates required `created_at`/`updated_at` text timestamps;
- rejects unknown, excessive, object and BLOB input;
- converts values according to SQLite affinity;
- requires all non-default non-null fields (`src/lib/admin-database-console.ts:238-299`).

Table-specific validation checks supported saved-view scope/key and JSON-object preferences, weekday/minute bounds, availability flags and unavailability time order (`src/lib/admin-database-console.ts:309-351`). The route also confirms active team membership/creator relationships and an active admin/trade owner for a list view (`src/app/api/admin/database/route.ts:89-110`).

Delete requires the complete primary key and a row-specific `DELETE <table> <8-hex-token>` confirmation (`src/lib/admin-database-console.ts:354-383`). The token is a deterministic 32-bit FNV-style fingerprint. It is a human confirmation aid, not a cryptographic authorization control; authorization must remain independent.

### Audit and transaction

Insert batches `[row insert, audit insert]`; delete batches `[conditional audit insert, row delete]`. The route requires both statements to report exactly one changed row (`src/lib/admin-database-console.ts:386-468`; `src/app/api/admin/database/route.ts:180-181`, `203-205`). Cloudflare documents that D1 `batch()` executes statements sequentially as a transaction and rolls back the sequence on failure: [D1 Worker API batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

Status: transactional pairing is `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` for mutation. Helper tests verify the statement shape, and the release record says no live writable row existed, so actual production mutation rollback was not exercised.

## Required threat matrix

| Required concern | Finding | Status | Evidence and impact |
|---|---|---|---|
| Arbitrary SQL | Not exposed by this route | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` safeguard | No SQL/query/where/order string is accepted. Identifiers must match a strict pattern and a live catalog entry; values are bound. Tests reject injection-shaped identifiers and assert no `.exec` or body SQL (`test/admin-database-console.test.mjs:44-49`, `222-240`). |
| Broad table enumeration | Exposed and observed | `VERIFIED DEPLOYED` | Policy defaults ordinary application tables visible, and live QA reported 145 table names plus real bounded row browsing (`src/lib/admin-database-console.ts:131-151`; `docs/RELEASE_TRUTH.md:124`). |
| Migration/system tables | Hidden | `VERIFIED DEPLOYED` by source + live catalogue claim | `d1_migrations`, `sqlite_*`, `_cf_*`, `__*`, `*_migrations`, virtual/search/shadow tables are excluded (`src/lib/admin-database-console.ts:127-143`). Exact live exclusions were not independently enumerated by this audit. |
| Authentication/session/audit tables | Many remain visible read-only | `VERIFIED DEPLOYED` general browse; exact rows `UNKNOWN` | `admin_users`, `admin_audit_log`, OAuth state and integration tables are explicitly read-only, not invisible (`src/lib/admin-database-console.ts:16-38`). Secret-like columns are masked, but identity/status/metadata can still disclose sensitive operational context. |
| Bulk mutation | Not exposed | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` safeguard | One POST adds one row and one DELETE removes one exact primary-key row; there is no UPDATE or bulk predicate. Abuse can still repeat calls because no console limiter exists. |
| Hard deletion | Exposed on three tables | `VERIFIED DEPLOYED` capability; live execution `UNKNOWN` | DELETE permanently removes a selected row. UI explicitly says it cannot restore data (`src/components/AdminDatabaseWorkspace.tsx:207-217`, `310-320`). Writable production tables were empty during QA. |
| Foreign-key protection | No tracked database FKs | `PARTIAL` route safeguard; schema protection absent | FK errors become safe 409 responses (`src/lib/admin-database-console.ts:470-482`), but deterministic scans found zero Drizzle `.references(...)` declarations and zero SQL `FOREIGN KEY`/`REFERENCES` clauses across all 79 migrations. The three mutable tables likewise declare only indexes/uniqueness (`db/schema.ts:647-675`, `2677-2687`). |
| Dependency awareness | Selected insert references only | `PARTIAL` | Inserts check active accounts/team members. Deletes do not enumerate domain dependencies, derived state, caches, notifications or sync consumers before removal. |
| Transaction handling | Row/audit batch is atomic by D1 contract | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` for mutation | Correct use of `db.batch` and change-count checks. No live mutation or failure-injection test proved it in the deployed environment. |
| CSRF protection | Bearer token + same-origin check | `PARTIAL` | All three methods call `sameOrigin`; primary credential is a non-cookie Firebase bearer token. `sameOrigin` accepts a missing `Origin` (`src/lib/admin-server.ts:13-16`), so it is defence in depth, not a purpose-bound anti-CSRF token. |
| Server-side authorization | Owner-only | `VERIFIED DEPLOYED` by route and signed-in QA | GET/POST/DELETE each call `requireAdminIdentity(request, ["owner"])`; active verified admin status and role are checked in D1 (`src/lib/admin-server.ts:33-71`). UI hiding is secondary. |
| Owner reauthentication | Recent sign-in time only | `PARTIAL` | Fifteen-minute `auth_time` requirement exists, but it accepts any provider sign-in and has no MFA, password re-entry, action nonce or purpose binding (`src/app/api/admin/database/route.ts:83-86`). |
| Immutable audit records | Application append paired with row action | `PARTIAL` | Console makes `admin_audit_log` browse-only, but no DB-level append-only trigger/provider policy or independent immutable export was found. Provider administrators/app bugs could alter it. |
| Backup before change | Missing | `UNKNOWN`/effectively not implemented in console | Neither POST nor DELETE exports/snapshots the affected row or confirms a current backup. UI says changes cannot be undone. |
| Reason capture | Missing | `PARTIAL` audit | Audit metadata records table, key fingerprint/PK columns and changed columns, but no operator reason, incident/ticket, approval or before image (`src/lib/admin-database-console.ts:386-468`). |
| PII exposure | Broad non-secret PII remains visible | `VERIFIED DEPLOYED` general row browsing | Name-based redaction protects token/hash/credential/encrypted/object-key patterns only (`src/lib/admin-database-console.ts:154-159`). Email, phone, address, names, notes, financial values and innocently named secrets remain visible. |
| Secret exposure | Reduced, not eliminated | `PARTIAL` | Live QA saw four integration credential cells masked. Future/misnamed secrets and sensitive free text are not protected by the pattern. Column names/table counts still reveal architecture. |
| Second administration path | Yes | `VERIFIED DEPLOYED` | The normal saved-view/schedule services derive owner identity, sanitize preferences, upsert and apply domain semantics (`src/lib/workspace-list-views.ts:153-178`; `src/app/api/trade-schedule/route.ts:159-184`). The console accepts an active target `owner_uid` and operates generically. |
| Rate limiting | Missing console-specific control | `PARTIAL` security boundary | No per-owner/action velocity, scrape quota, lockout, cooldown or alert exists in the route. Page size/body bounds are resource bounds, not request-rate limits. |
| Error details | Known DB errors sanitized; unknown errors generic to client | `PARTIAL` | Constraint messages are mapped safely. Unknown errors flow to `adminError`, which returns generic copy but logs the raw error object (`src/lib/admin-server.ts:22-30`). Log redaction is unproven. |
| Domain-rule bypass | Yes | `PARTIAL` safeguards, high residual risk | Table-specific checks copy some rules, but generic insert/delete does not call the authoritative saved-view/schedule services and may omit current/future side effects. The duplicated rules can drift. |

## Key design risks

### 1. Default-visible schema policy

After specific internal/immutable/mutable cases, `databaseTablePolicy` returns `visible: true` for every other syntactically valid application table (`src/lib/admin-database-console.ts:131-151`). The test deliberately asserts that a hypothetical `future_application_table` is visible (`test/admin-database-console.test.mjs:62-67`).

This converts every future migration into a potential production-data disclosure unless its name or SQL happens to match an exclusion. It reverses the appropriate privileged-diagnostics control: new schema should be invisible until an explicit review allows a specific projection.

Required design: a compile-time explicit map of allowed diagnostic views and allowed columns. Tests must fail when a new table/column is unclassified. Do not use `SELECT *`.

### 2. PII and tenant-wide browsing

The owner can browse all returned rows, not a tenant/purpose slice. Redaction detects only names containing password, secret, credential, API/access/refresh token, client secret, token, hash, encrypted, object key or push token (`src/lib/admin-database-console.ts:154-159`). The broader schema includes customer/trade names, email, phone, address, appointment/site details, financial records and free text.

No dedicated NMI field was found in the tracked database schema. The native comparator says its NMI remains in the browser and is excluded from saved links/requests (`src/components/electricity/NativeElectricityComparator.tsx:287`, `635-667`, `779-780`). The audit therefore does not claim that the current console exposes stored NMIs. Unstructured notes or deliberately uploaded documents can still contain sensitive content that column-name redaction cannot recognize.

Clipping to 4,000 characters per cell and 32,000 per row limits response size; it does not de-identify the row. An owner-account compromise therefore creates a high-value cross-tenant disclosure path.

Required design: data-minimized diagnostic views, irreversible masking, row-level purpose filters, access reason, query audit, download prevention where practical, short session, MFA, anomaly alerting and no general table catalogue.

### 3. Duplicated and weaker business rules

The normal schedule route derives `ownerUid` from the authenticated trade/team access, checks dispatch role, checks the active member and upserts working hours or inserts/removes unavailability under that owner (`src/app/api/trade-schedule/route.ts:149-184`). The normal saved-view library sanitizes filters/columns, derives the caller's owner scope, upserts base views and enforces named-view limits (`src/lib/workspace-list-views.ts:153-178`, `188-241`).

The console duplicates only selected checks and accepts the target owner UID in the body. It can delete working-hours/base-view rows even where the normal operation is an upsert/reset path. Today there may be few side effects, but future caches, sync events, notifications, revisions or invariants can be added to the authoritative service without updating the console.

Required design: no generic row mutation. Create named commands such as `reset_owner_saved_view`, `repair_member_working_hours` or `remove_invalid_unavailability`, each calling one domain service, previewing effects and recording reason/before/after/approval.

### 4. Weak privileged-session assurance

An attacker who obtains an owner Firebase session and signs in recently can browse all visible tables and mutate the allowlisted ones. There is no application-enforced MFA or independent second approver. Asking the user to sign out/in does not prove a phishing-resistant factor or even password re-entry for Google sign-in.

Required design: phishing-resistant MFA, purpose-specific step-up, server-issued one-use action challenge, short privilege elevation, session/device binding, reason/ticket and off-screen alert. For destructive repair, require four-eyes approval unless an emergency procedure with post-review is explicitly accepted.

### 5. Audit without recovery

The audit row proves an application action was attempted and records a privacy-safe key fingerprint/changed columns. It intentionally omits values. That protects logs but means the record cannot reconstruct a deleted row. There is no undo, before image, backup check or restore action.

Required design: prevent generic hard delete. If a named repair genuinely requires removal, prefer reversible status/soft-delete where domain semantics allow; otherwise capture an encrypted before image in an independently access-controlled repair ledger with retention, or prove an immediately restorable backup and document the exact restore path.

## Test and runtime evidence

### Audit-executed checks

The audit ran `node --experimental-strip-types --test test/admin-database-console.test.mjs`: 11 tests passed, 0 failed. The complete repository run at implementation SHA found 699 tests, 697 passes and two intentional fixture skips. Lint, root TypeScript, mobile TypeScript and fresh replay of all 79 migrations passed.

The 11 console tests validate:

- strict identifiers;
- table policy and internal hiding;
- protected-name redaction and clipping;
- affinity conversion and input bounds;
- generated IDs/timestamps;
- fake-D1 insert/delete statement shape and audit pairing;
- the three table-specific value rules;
- complete composite primary keys and typed confirmation;
- pagination and safe known errors;
- route source contains owner/origin/recent-auth/batch guards and no raw query input;
- owner-only lazy UI mount and responsive CSS source contracts (`test/admin-database-console.test.mjs:44-255`).

The audit also ran `rg -n '\.references\(' db/schema.ts` and `rg -n -i 'FOREIGN KEY|REFERENCES\s+[A-Za-z_]' drizzle --glob '*.sql'`; both returned zero matches. The console cannot rely on database foreign keys to block orphaning in the current schema.

### Important test limitation

The mutation test uses a fake database that captures prepared SQL (`test/admin-database-console.test.mjs:122-160`). The route-level test reads source files and uses regular expressions (`test/admin-database-console.test.mjs:222-255`). Neither invokes the actual route with a real Firebase identity and local D1 transaction.

Missing high-value tests:

1. real Worker/D1 GET, POST and DELETE integration with fixture owners and non-owners;
2. missing/foreign `Origin`, expired/revoked token and recent-auth boundary cases;
3. transaction failure injection proving row/audit rollback;
4. domain-service equivalence and side-effect assertions;
5. future migration/table/column classification failure;
6. PII masking by explicit projection, including free text and mislabeled secrets;
7. request-rate/scrape limits and alert generation;
8. concurrent deletes/inserts and uniqueness/FK races;
9. browser keyboard/focus tests for add/delete confirmation;
10. backup/restore and incident-response drill.

### Release-record evidence

`docs/RELEASE_TRUTH.md:124` records Sites v199 and says:

- full validation and production build passed;
- 25 focused tests, 33 integration tests, 697 full-suite passes and two skips;
- all 79 migrations replayed;
- signed-in owner QA browsed real rows;
- four protected integration credential cells were redacted;
- add flow opened but could not submit without confirmation;
- all writable production tables were empty, so delete was not live-tested;
- no production data changed;
- canonical health returned 200 and recent Worker errors were empty.

This supports `VERIFIED DEPLOYED` for the read path and UI. It does not establish safe mutation, restore, provider ownership, exhaustive redaction or long-term abuse resistance.

## Why the application console cannot replace provider control

The console uses the same application deployment, Firebase identity boundary and Sites-managed D1 binding as the product. If that deployment, identity provider, account or binding is unavailable/compromised, the console may be unavailable/compromised with it. It cannot establish:

| Required capability | Why this console is not a substitute |
|---|---|
| Provider-level ownership | It exposes a binding, not the Cloudflare/Sites contract, billing account, IAM, recovery contacts or root credentials. |
| Independent export | It returns bounded pages from selected tables, not a consistent full database export with schema, indexes and checksums. |
| Off-platform backup | It writes/reads the same live database and stores no independent encrypted copy. |
| Point-in-time recovery | It exposes no Time Travel bookmark/restore operation or retention proof. Cloudflare's facility is provider-side: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). |
| Schema/migration access | It hides migrations and DDL by design; it cannot inspect drift, apply migrations or recover a failed schema release. |
| Provider administration | It cannot manage IAM, regions, limits, billing, logs, incidents, API tokens or account recovery. |
| Disaster recovery | It has no isolated restore target, R2 reconciliation, failover, RPO/RTO or exercised runbook. |
| Documented exit | It does not create a portable export or demonstrate restore to another platform. Provider export must be independently exercised: [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/). |

Owner-controlled provider tooling and off-platform backup are mandatory regardless of whether any in-app diagnostics survive.

## Recommended action plan

### Immediate containment recommendation

Status: recommendation only; this audit makes no changes.

1. Withdraw Sites v199 or ship an approved hotfix that removes the Database navigation and denies `/api/admin/database` before relying on the console operationally.
2. Revoke/refresh privileged sessions and review owner/admin access, MFA/provider policy and v199 access logs for unexpected catalogue reads.
3. Record the release-boundary contradiction: the audit instruction prohibited console completion/deployment, yet external concurrent work committed, pushed and deployed it.
4. Preserve the current source, release IDs, logs and this audit as evidence; do not delete audit trails.
5. Confirm independent D1 export/Time Travel entitlement and create a protected off-platform backup before any further repair tooling work.

### Safe redesign

If owners need diagnostics:

- create explicit named diagnostic views, not a dynamic table catalogue;
- deny every table/column by default;
- return aggregated health/status where possible, and masked minimal fields otherwise;
- require phishing-resistant MFA and a purpose-bound, short-lived elevation;
- require reason/ticket and alert every privileged read;
- rate-limit and detect scraping;
- exclude credentials, auth/session, audit, customer identity, free text and financial detail unless a separately approved use case demands a specific projection;
- test every view with fixture PII and future-schema classification failures.

If owners need repair:

- expose named business commands only;
- derive tenant/object scope from a selected support case and server authority, never arbitrary request values;
- reuse the authoritative domain service and all notifications, revisions, caches and sync events;
- show a dry-run impact/dependency preview;
- use optimistic concurrency/idempotency;
- capture reason, ticket, before/after summary, actor session/device and approval;
- prefer reversible repair, and prove recovery for irreversible actions;
- add targeted monitoring and post-action reconciliation.

Provider tooling must separately cover IAM/ownership, schema/migrations, consistent export, off-platform encrypted backup, PITR, restore drills, disaster recovery and platform exit.

## Final status

| Question | Answer |
|---|---|
| Is arbitrary SQL exposed? | No, based on active source and tests. |
| Is the feature now deployed? | Yes: `VERIFIED DEPLOYED` in Sites v199 according to committed release/concurrent task evidence. |
| Was deployment allowed by the audit brief? | No. The process state is `CONTRADICTED`; this workstream made no deployment change. |
| Are reads safe merely because secrets are redacted? | No. Broad cross-tenant PII and operational metadata remain visible, and future schema is default-visible. |
| Are mutations transactionally paired with audit? | Yes by source/D1 batch contract, but live mutation was not exercised. |
| Do mutations preserve all domain rules and dependencies? | No evidence proves that; the second generic path creates drift/bypass risk. |
| Can this replace Cloudflare/Sites ownership, backup or recovery? | No. |
| Should generic mutation remain? | No. Abandon it and use bounded domain repair commands. |
| Should generic browsing remain? | Not in its current form. Replace it with explicit, minimized, read-only diagnostics if a real operational need remains. |

## Integrity hashes for implementation snapshot B

These SHA-256 hashes identify the nine paths committed in `4a5cd19` as inspected during the audit. Snapshot C changes only the two release-document paths noted above.

| Path | SHA-256 at implementation snapshot |
|---|---|
| `docs/HANDOVER_NEXT_TASK.md` | `ea5fd16724006ad31e646c089bbb7040219fd9fe8e7e0e84ed6e84db532dbf7d` |
| `src/app/api/admin/database/route.ts` | `36d2c9f162462fcd3d051401cd2d96cab924279a5e9643fc971d2517556de921` |
| `src/components/AdminDatabaseWorkspace.module.css` | `4f77d12356ba283374afd9168a9b246e68112b3f3e7eba90a0011ce7e621e61a` |
| `src/components/AdminDatabaseWorkspace.tsx` | `b00383cc6bd5c66b340e6cc3d7b2606fe0f4f33f18bb5c933ce5caadef264037` |
| `src/components/AdminOperationsPortal.tsx` | `99fcac8849ee6fd44c258c1028975aa2f6b7e3d3f7c6258bdadd800e6265483d` |
| `src/lib/admin-database-console.ts` | `f82d0b74652131cc10860066c58cd3380a7bdfa3ce83f09e58f6cc5eb84433f8` |
| `src/lib/admin-server.ts` | `c39b305641533e5d771ee40a35986db9f7b248ff86690aa42fe69019907b5e70` |
| `test/admin-database-console.test.mjs` | `05727d1b5c207a5255343189e7c459fca53c188613b19ccb49e187ccd0489fbf` |
| `test/admin-operations.test.mjs` | `84d1cad2ffb7149156a444d95bdaa1d52aa88b5a5c25872e4d457aa55f9ea1d5` |
