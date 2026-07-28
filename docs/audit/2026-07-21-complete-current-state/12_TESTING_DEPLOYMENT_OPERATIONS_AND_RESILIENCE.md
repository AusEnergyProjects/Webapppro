# Testing, deployment, operations and resilience audit

Audit date: 2026-07-21 (Australia/Sydney)<br>
Repository: `C:\Webproject\aea-energy-domain-migration`<br>
Final repository snapshot: branch `codex/sites-custom-domain-migration`, commit `ff3c8efe3d5e501286d8e83e28086d6d4590be27`<br>
Application implementation snapshot: `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`<br>
Execution host: Windows PowerShell 5.1.26100.8655, Node.js v22.14.0, npm 10.9.2, Git 2.53.0.windows.2

## Result

The application source has a broad and fast automated suite: 100 executable tracked test modules plus the `test/package.json` support manifest, 699 discovered tests, 697 passes, no failures and two environment-dependent skips. ESLint, root TypeScript, mobile TypeScript and a fresh local replay of all 79 D1 migrations also passed in this audit. This is strong implementation evidence.

This audit workstream did not run `npm run validate`, a production build or signed-in production actions because those would write outside the audit boundary or require provider access. A concurrent external release task subsequently recorded that it ran complete validation and a production build, published implementation SHA `4a5cd19` as Sites version 199, and performed read-only signed-in QA. That evidence is now committed at repository snapshot `ff3c8ef` (`docs/RELEASE_TRUTH.md:124`). It establishes `VERIFIED DEPLOYED` for the console read path, but it does not establish D1/R2 backup, restore, mutation recovery or failover.

Repository configuration describes a ChatGPT Sites project packaged through Vinext/Cloudflare Workers with D1, R2 and one cron. The latest dated deployment record is now Sites version 199, deployment `appgdep_6a5f78c0b3cc81919214c0deb5a3a8f3`, from application SHA `4a5cd19` (`docs/RELEASE_TRUTH.md:124`). The final repository SHA `ff3c8ef` is its documentation-only child. Source, release-record and runtime evidence are therefore current but remain separate evidence layers.

The largest operational risks are no tracked CI workflow, a health endpoint that proves only process liveness, no formal SLOs/tracing, no independently verified backup/restore or disaster-recovery procedure, and a scheduled-worker design that catches job failure and only logs it locally. Documentation claims an independent Google Apps Script monitor and durable notification relay are active; those external systems were not accessed in this audit, so their current operation is `UNKNOWN`.

## Evidence-layer separation

| Evidence layer | Current finding | Status |
|---|---|---|
| Observable production/runtime | The concurrent release record says Sites v199 served the owner console, real rows were browsed, redaction was observed, health returned 200 and recent Worker errors were empty. No production row was changed. | `VERIFIED DEPLOYED` for the recorded read path |
| Active deployment configuration | Sites project ID, D1 `DB`, R2 `EVIDENCE`, Cloudflare Worker, canonical redirect, headers, caching and cron exist in the deployed source. | `VERIFIED DEPLOYED` at application SHA `4a5cd19` |
| Executed validation | This audit passed full tests, lint, two TypeScript checks and migration replay at `4a5cd19`; the release task separately recorded complete `validate`, 25 focused tests, 33 integration tests and production build. | `VERIFIED DEPLOYED` with provenance split by executor |
| Active implementation | 675 tracked files, 94 API handlers, 41 pages, 79 migrations and mobile source are present. `ff3c8ef` changes release docs only over application SHA `4a5cd19`. | `VERIFIED DEPLOYED` for the web implementation |
| Release documentation | `docs/RELEASE_TRUTH.md:124` records Sites v199 with exact implementation SHA and deployment ID. | `VERIFIED DEPLOYED` |
| External monitoring/provider state | Runbook says Google Workspace monitoring is active, but Apps Script/Sites/Cloudflare/Firebase consoles were not inspected. | `UNKNOWN` current state |

## Commands actually run

All audit-executed commands below ran from `C:\Webproject\aea-energy-domain-migration` against application commit `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`, before the documentation-only child `ff3c8ef` was created. No application/test source changed between those commits, and no test was weakened, deleted or skipped to obtain these results.

| Command | Exit | Result | What it proves and does not prove |
|---|---:|---|---|
| `npm.cmd test` | 0 | 699 tests; 697 passed; 0 failed; 2 skipped; 0 todo; approximately 1.38 s | Confirms the application implementation's Node test suite. It does not prove browser, provider or production behaviour. |
| `npm.cmd run lint` | 0 | ESLint passed; approximately 20.56 s | Confirms configured static lint rules. Because `eslint.config.mjs:5-18` ignores build outputs but not `mobile`, this command also traverses mobile source. |
| `.\node_modules\.bin\tsc.cmd --noEmit --pretty false --incremental false` | 0 | Root TypeScript passed; approximately 12.33 s | Confirms root type-check without emitting files. It does not compile production assets. |
| `.\mobile\node_modules\.bin\tsc.cmd -p mobile\tsconfig.json --noEmit --pretty false --incremental false` | 0 | Mobile TypeScript passed; approximately 1.86 s | Confirms Expo/mobile types only; no native build or device execution. |
| `npm.cmd run db:check` | 0 | All 79 migrations applied to a fresh temporary local D1; verification tables existed; approximately 23.06 s | Confirms forward replay into a new local database. It does not prove production migration state, upgrade from every historical snapshot, backup or restore. |
| `node --experimental-strip-types --test test/admin-database-console.test.mjs` | 0 | 11/11 database-console tests passed | Confirms helper and source-contract tests; no real D1 route/auth/browser execution. |
| Git identity/status/count/hash inspection | 0 | Final branch and SHA confirmed; origin resolved to the same SHA; 675 tracked files | Confirms repository identity and source provenance only. |

The two skipped tests depend on a real `NEM12_FIXTURE` environment path and intentionally call `test.skip` when it is not supplied (`test/electricity-model.test.js:204-205`; `test/nem12-typed-parity.test.mjs:91-92`). Status: `BLOCKED` in this audit by absence of an authorized fixture. This is not a failure, but it means real-file parity was not rerun.

### Checks not run by this audit workstream

| Check | Status | Reason and safe next procedure |
|---|---|---|
| `npm.cmd run validate` | `BLOCKED` in audit; externally recorded passed | The script writes build artifacts (`package.json:18`), so this workstream did not run it. The concurrent release record says it passed at `4a5cd19`; that result was not independently reproduced here. |
| `npm.cmd run build` | `BLOCKED` in audit; externally recorded passed | This workstream avoided `.next`/`.wrangler` writes. The concurrent release record says the exact implementation produced a successful production build and Sites v199. |
| `npm.cmd run test:coverage` | `BLOCKED` | Not necessary to establish functional pass/fail and may emit coverage output. Run in an isolated temporary worktree and retain the report as an audit artifact. |
| `npm.cmd run test:integration` | `NOT APPLICABLE` as a separate run | Its selected tests were already included in the passing full `npm test`; the named script was not separately invoked. |
| `npm.cmd run benchmark:scale` | `BLOCKED` | The benchmark was not needed for static audit and may create/load synthetic data. Run only against disposable local D1 with recorded hardware and thresholds. |
| `npm.cmd run audit:links` | `PARTIAL`; externally run, exit 1 | The documentation/link workstream ran it: 177 checks, 171 non-broken results including 16 automation-blocked outcomes, and six reported broken. Five failures are method-sensitive provider endpoints; ReAmped remains unresolved. Full analysis is in `04_DOCUMENTATION_TRUTH_AND_LINK_AUDIT.md:117-134,357`. |
| Signed-in browser/end-to-end tests | `BLOCKED` | No authorized test identity/isolated environment was used. Use least-privileged fixtures and prohibit production mutation. |
| Production smoke/provider checks | `BLOCKED` | The audit prohibited provider writes and deployment changes; no current production read session was used. Run the documented privacy-safe probes after an approved release. |
| Backup export and restore drill | `BLOCKED` | No owner-controlled backup target or approved disposable restore destination was established. Export independently, restore into isolation, reconcile counts/invariants and record RPO/RTO. |
| Dependency, license, SBOM and secret scanning | `BLOCKED` | No repository gate/tool was configured or installed during this read-only audit. Use locked, approved scanners in CI without printing findings that contain secrets. |
| Browser accessibility, DAST and mobile-device tests | `BLOCKED` | No browser/device harness was run. Execute against a non-production environment with seeded synthetic identities/data. |

## Test inventory and quality

### What is covered

The 100 executable test modules cover a wide product surface. Based on test names and reviewed assertions, the suite includes:

- calculation/unit logic for electricity, gas tariffs, planning, matching, money and dates;
- API and authorization source contracts for customer, trade, team and admin routes;
- CRM jobs/customers, scheduling, quotes, invoices, payment reconciliation, purchasing, price books and saved views;
- protected photo/evidence, lifecycle, ownership transfer and handover workflows;
- Firebase/admin role, owner recovery, notification and monitoring boundaries;
- webhook signature/reconciliation logic and delivery retries;
- migration replay and release-integrity assertions;
- operational-monitor and lead-rate-limit behaviour;
- selected accessibility source contracts such as dialog roles, Escape handling and menus;
- mobile sync/security source contracts and offline workflow logic;
- database-console policy, binding, audit-statement and route-source contracts.

This breadth is a meaningful strength. The tests are fast enough to run frequently and the final run produced no failures.

### Coverage gaps and classification

| Test class | Status | Finding |
|---|---|---|
| Unit/helper | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` | Broad, fast Node coverage exists. |
| Source/contract tests | `PARTIAL` | Many Node tests inspect component/route source with regular expressions. They are useful for static required boundaries, but can pass without rendering, DOM events or route execution; do not count them as component tests. |
| Rendered component tests | `UNKNOWN` | Root and mobile manifests use the Node test runner and contain no installed DOM/component test harness. No tracked test was found that mounts a React/React Native component and drives it through rendered interaction. |
| API integration | `PARTIAL` | Domain helpers and some route contracts execute; no complete real-worker/D1/R2/Firebase integration environment was run. |
| Browser end-to-end | `UNKNOWN` | No Playwright/Cypress/Webdriver dependency or suite was found. Critical multi-page journeys are not release-gated by a browser. |
| Migration | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` | All 79 migrations replay cleanly into fresh temporary D1. Historical upgrade matrices and production drift are unproven. |
| Restore | `UNKNOWN` | No backup-restore test or reconciliation report was found. |
| Security | `PARTIAL` | Authz, signatures, rate limits and validation have tests; no DAST, dependency scan, secret scan, SAST/taint or full negative role matrix was found. |
| Accessibility | `PARTIAL` | Source assertions exist; no axe/browser, keyboard journey or screen-reader suite was found. |
| Smoke | `PARTIAL` | The v199 release records current bounded health and signed-in owner-console QA. No automated exact-SHA all-route/auth/provider smoke suite was run. |
| Load/performance | `PARTIAL` | A 100k synthetic benchmark script exists (`package.json:9`), but it is not part of `validate` and was not run here. Current capacity is unknown. |
| Resilience/failure injection | `PARTIAL` | Some retries, idempotency and unavailable-provider cases are tested; no chaos/failover/region outage/restore drill was found. |
| Static analysis | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` | ESLint and TypeScript passed. |
| Formatting | `UNKNOWN` | No formatter/check script appears in `package.json:5-19`. |
| Coverage measurement | `PARTIAL` | A coverage script exists, but no tracked report or threshold gate was found and it was not run. |
| Artifact validation | `VERIFIED DEPLOYED` by release record | `validate` includes a build, and Sites v199 is recorded with exact implementation SHA/deployment ID. This audit did not independently inspect the packaged artifact. |

### Test-integrity, mock and false-positive disposition

| Required class | Count and identification | Status and interpretation |
|---|---|---|
| Skipped/environment-dependent | Two test cases: the real-file paths in `test/electricity-model.test.js:204-205` and `test/nem12-typed-parity.test.mjs:91-92` | `BLOCKED` by the absent authorised `NEM12_FIXTURE`; all other 697 discovered cases passed |
| Quarantined | Zero registry, quarantine marker or excluded quarantine script found | `UNKNOWN` historical state; none is configured in the current tracked suite |
| Flaky | Zero retry, repeat-failure or flaky marker observed in the retained passing run | `UNKNOWN` long-term behavior; one fast run cannot prove absence of flakiness |
| Obsolete | No test was deleted or weakened and no obsolete-test registry exists | `UNKNOWN`; product/source history was not sufficient to certify every assertion remains valuable |
| Explicit mock/test-double boundary files | Five modules: `test/admin-database-console.test.mjs` uses a fake D1 interface; `test/electricity-cdr.test.js`, `test/lead-webhook-probe.test.mjs`, `test/operational-monitoring.test.mjs` and `test/service-reminder-delivery.test.mjs` inject network responses | `PARTIAL`; these execute real domain/helper code, so no whole file is labelled mock-only, but the named D1/provider branches are mock-only and do not prove live D1, UrlFetch, Resend, Twilio or retailer behavior |
| Source-text/static contract files | 80 of 100 test modules call a file-reading API; many assert source with regular expressions alongside executed helper tests | `PARTIAL`; useful structural gates, but a source match can pass without rendering a component, invoking a route or enforcing a production control |
| Confirmed false-positive tests | Zero individual test was proved to have passed while its asserted contract was false | `UNKNOWN` absence; the 80 source-reading modules are the identified false-positive risk class, and their passes were never promoted to runtime/deployment proof without separate evidence |

The counts above came from a read-only content classification of the 100 tracked `*.test.*` modules and direct inspection of the five explicit test-double files. This classification is deliberately narrower than treating every fixture or temporary local SQLite database as a “mock.” No test result was weakened or reclassified as live behavior to improve the audit verdict.

### Highest-priority test additions

1. Real browser, real rendered DOM and axe checks for registration, household projects, comparator, token links, core TLink workflow and read-only admin access.
2. Negative authorization matrix covering every role/tenant/object/token state against a local Worker + D1 fixture—not source regex alone.
3. Real D1 route tests for the database console, including auth failure, old auth time, foreign/dependency failures, audit rollback and future-schema denial.
4. Historical migration upgrade fixtures and schema/data invariant checks, not only a fresh database.
5. Backup export -> isolated restore -> reconciliation -> application smoke, with measured RPO/RTO.
6. Release-signed iOS/Android tests for offline queue, encrypted data, reconnect conflict, revoked-device purge and app upgrade.
7. Provider sandbox contract tests for Stripe, Square, calendar, accounting, Resend/Twilio and monitoring with replay/idempotency cases.
8. CSP, dependency, SBOM, secret and license gates.
9. Measured scale tests with pass/fail latency, error-rate, memory and D1 query budgets.
10. Current-SHA post-deploy smoke that verifies provenance, canonical headers, readiness dependencies, error logs and no forbidden production mutation.

## Deployment topology: repository configuration

### Sites, Worker, D1 and R2

`.openai/hosting.json` binds Sites project `appgprj_6a550c378000819185caf094173422bb` to D1 binding `DB` and R2 binding `EVIDENCE` (`.openai/hosting.json:2-4`). `vite.config.ts` packages the Vinext application with the Sites and Cloudflare Vite plugins, uses `worker/index.ts`, enables Node compatibility, registers one cron, and maps the D1/R2 bindings (`vite.config.ts:14-27`).

The D1 database ID in source is a placeholder UUID while the Sites layer supplies managed binding identity (`vite.config.ts:24-25`). That is configuration evidence, not proof of independent owner control, export entitlement or current production resource identity.

The worker:

- redirects the legacy ChatGPT Sites hostname to `compare.ausenergyassessments.com` with HTTP 308 (`worker/index.ts:28-35`);
- excludes `/api/` from HTML caching and caches successful HTML for two minutes with stale-while-revalidate for ten minutes (`worker/index.ts:6`, `37-49`);
- emits HSTS on HTTPS plus permissions, referrer, MIME and frame headers (`worker/index.ts:12-25`);
- handles the cron in the same Worker (`worker/index.ts:73-82`).

Status: `VERIFIED DEPLOYED` at application SHA `4a5cd19` according to Sites v199 evidence. Provider ownership and recovery remain separate unknowns.

### DNS, TLS and CDN

Source names the canonical host and defines HTTPS redirect/security headers. `docs/RELEASE_TRUTH.md:125` records dated live observation of HTTPS, HSTS, Permissions-Policy, Referrer-Policy, X-Content-Type-Options and X-Frame-Options after an earlier release, and explicitly records that no CSP was observed.

No DNS query, certificate inspection or CDN/cache test was independently run by this audit workstream. The release task recorded canonical health and empty recent Worker errors for v199, while `docs/RELEASE_TRUTH.md:125` retains prior live header observations. DNS authority, TLS certificate owner/renewal and cache correctness remain `UNKNOWN`.

### Mobile delivery

`mobile/eas.json:1-20` defines development, internal preview, production build and production submit profiles. The release record states that Apple/Google developer accounts, signing credentials, mobile Firebase files, OAuth IDs and push release credentials are still required (`docs/RELEASE_TRUTH.md:126`). Store distribution is therefore `BLOCKED`, not absent and not complete.

## Deployment and provenance truth

At the end of the audit evidence pass:

- local branch: `codex/sites-custom-domain-migration`;
- final local/origin HEAD: `ff3c8efe3d5e501286d8e83e28086d6d4590be27`, commit `docs: record owner database console release`;
- application parent: `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`, commit `feat: add protected owner database console`;
- recorded release: Sites version 199, deployment `appgdep_6a5f78c0b3cc81919214c0deb5a3a8f3`, application SHA `4a5cd19`;
- both commits, the push, packaging and deployment were performed by an external concurrent task, not this audit workstream;
- this audit performed no commit, push, package, publish, version save, deploy or production-row mutation.

The latest repository deployment record is Sites version 199 from `4a5cd19` (`docs/RELEASE_TRUTH.md:124`). It reports 25 focused tests, TypeScript, ESLint, 33 integration tests, 697 full-suite passes plus two skips, clean replay of all 79 migrations, production build, signed-in desktop/390 px read-only QA, canonical health and empty recent Worker errors. All three writable console tables were empty, so no live mutation was exercised.

Consequently:

- source push at `4a5cd19` and release-doc push at `ff3c8ef`: confirmed;
- Sites deployment of `4a5cd19`: `VERIFIED DEPLOYED` by exact release record;
- database-console owner read reachability/redaction: `VERIFIED DEPLOYED` by signed-in QA record;
- database-console mutation behaviour in production: `UNKNOWN` because no writable live row existed and no row was created for QA;
- production environment revision: recorded as 18; provider IAM/access-policy ownership remains `UNKNOWN`.

## CI/CD, approvals and release strategy

No tracked GitHub Actions workflow, GitLab CI file, Azure pipeline or Jenkinsfile was found. `package.json:5-19` defines useful local gates, and `validate` sequences typecheck, lint, selected integration tests, the full suite, migration replay and build. However, no repository evidence shows that a remote platform requires that command before merge/push/deploy.

Status: CI enforcement `UNKNOWN`; local release-gate definition `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`.

The release history documents exact Sites versions, deployment IDs, SHAs, environment revisions and visual checks. This is good provenance practice. Current approvals, branch protection, required reviewers, environment promotion and separation of deploy authority are not represented in an enforceable workflow visible here. A direct push can therefore diverge from the last deployment record, as occurred during this audit.

There is no proven staging environment or automated promotion chain. Development/local, Sites production and EAS development/preview/production profiles exist conceptually; actual isolated provider resources and production parity are `UNKNOWN`.

## Database migration, rollback and data recovery

The repository has 79 ordered SQL migrations. `scripts/check-migrations.mjs` creates a temporary directory, writes a temporary Wrangler config, applies every migration to local D1, verifies representative tables, and deletes the temporary state (`scripts/check-migrations.mjs:7-10`, `28-40`). This passed.

What is not proven:

- exact production migration ledger and drift;
- safe upgrade from each historical production snapshot;
- migration lock/ordering across concurrent deploys;
- rollback when an application deploy and schema change are incompatible;
- down migrations or forward-fix procedure;
- independent export before migration;
- restore of D1 plus consistent R2 objects;
- last successful restore, RPO or RTO.

Cloudflare documents D1 Time Travel and import/export facilities, but repository bindings do not prove account entitlement, retention, owner access or an exercised procedure. Relevant provider references are [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) and [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/). Status: backup/restore/disaster recovery `UNKNOWN`.

Required minimum: independently scheduled encrypted export to an owner-controlled off-platform location, documented retention, hash/inventory, isolated restore drills, R2 object reconciliation, credential recovery, measured RPO/RTO and a documented provider-exit path.

## Health, logs, metrics, traces and alerts

### Health and readiness

`/api/health` always returns `{ ok: true, service, checkedAt }` without touching D1, R2, Firebase or providers (`src/app/api/health/route.ts:5-9`). It is a liveness check only. The canonical v199 health probe returned HTTP 200, so bounded route liveness is `VERIFIED DEPLOYED`; a healthy response can still coexist with database/storage/auth/provider failure, whose readiness remains `PARTIAL`/`UNKNOWN`.

The operational runbook describes an independent hourly Google Apps Script check of health, electricity plans, gas plans and a privacy-safe lead-delivery probe, with transition alerts and six-hour repeats (`OPERATIONS_RUNBOOK.md:3-18`). It also describes a durable D1 notification/delivery ledger, signed Apps Script relay and bounded retry schedule (`OPERATIONS_RUNBOOK.md:31-48`). This is strong documented design, but documentation is not current runtime evidence. Status: `UNKNOWN` current external monitor operation.

### Logs and metrics

The Worker and route helpers use `console.error` for failures. Selected list routes record sampled response duration, D1 duration, status, outcome, result count and cursor use in `api_performance_samples`; all errors/slow requests and 10% of other requests are sampled (`src/lib/route-performance.ts:34-58`). Response headers expose server timing.

This is useful diagnostic telemetry but not a complete observability system:

- coverage is route-specific, not every API/job/provider call;
- no distributed trace/context propagation was found;
- no repository-defined log retention, access control, redaction verification or immutable export was found;
- no current dashboards, metric alerts or error-budget reports were accessed;
- console-only cron failures may be missed if platform log alerts are absent.

Status: logging/metrics `PARTIAL`; tracing `UNKNOWN`.

### SLOs and support ownership

No formal availability, latency, correctness, delivery, freshness, RPO or RTO SLO was found. The monitoring runbook identifies checks and an operational mailbox but not numeric service objectives or escalation coverage. Support ownership appears centered on `info@ausenergyassessments.com`; staffing, on-call rota, provider-account redundancy and operational bus factor are `UNKNOWN`.

## Scheduled jobs, retries and partial failure

The configured cron invokes recurring-service-job generation (limit 200) and certificate-price sync concurrently. Each promise catches its own error and logs a message, so `Promise.all` resolves even if one or both jobs fail (`worker/index.ts:73-82`). This prevents one job from cancelling the other, but it also means the scheduled event itself does not fail for platform-level retry/alert semantics.

No durable job/outbox record is written by the wrapper before execution, no common retry/backoff is visible at this boundary, and no stale-run detector is proven. Individual domain functions may have their own idempotency/state; the wrapper does not establish global completion.

Status: `PARTIAL`.

Required correction: record each scheduled run durably with expected/started/completed/failed state, attempt and cursor; make work idempotent and resumable; alert on missed/failed/stale runs; apply bounded backoff; and expose job freshness in readiness/operations without returning sensitive data.

## Resilience, scaling and capacity

| Area | Status | Assessment |
|---|---|---|
| Horizontal compute scaling | `PARTIAL` | Cloudflare Worker runtime can scale, but actual account limits, cold starts and workload quotas were not measured. |
| Database scaling | `PARTIAL` | Pagination/cursors and indexes are widespread; D1 contention, write throughput, size, hot tenants and production query plans are unmeasured. |
| Object storage | `PARTIAL` | R2 binding and bounded file workflows exist; lifecycle, orphan cleanup, regional recovery and production size/cost are unverified. |
| Backpressure | `PARTIAL` | Page sizes, batch limits and delivery limits exist. There is no uniform queue/circuit-breaker layer for every provider. |
| Retry storms | `PARTIAL` | Notification retries are documented as bounded. Cron and many direct provider requests lack a single reviewed retry budget. |
| Partial failure | `PARTIAL` | Provider-specific degraded paths exist; readiness does not expose dependency failure and no chaos exercise was run. |
| Failover | `UNKNOWN` | No alternate region/provider/data failover path or exercised switch procedure was found. |
| Cold starts/connections | `UNKNOWN` | No current Worker/D1 measurements or thresholds were recorded. |
| Capacity benchmark | `PARTIAL` | A 100k synthetic script exists but was not run and is not a default release gate. |
| Cost control | `UNKNOWN` | No verified budgets, quotas, alerts, current usage or unit-economics report was accessed. |
| Vendor lock-in | `PARTIAL` | Vinext/Worker/D1/R2/Sites packaging is provider-specific; no exercised export/restore/exit path exists. |

HTML caching is conservative for APIs—`/api/` is never cached by this worker—and bounded for public HTML (`worker/index.ts:37-49`). That reduces accidental API caching but does not prove personalized HTML is never cached; the worker currently treats every successful non-API HTML GET as cacheable. The framework/auth surfaces should be verified to ensure authenticated pages are not rendered with user-specific server HTML before retaining this broad rule.

## Incident response and administrative repair

`OPERATIONS_RUNBOOK.md:71-121` gives practical response steps for site, plan-source, lead-delivery and alert-channel failures and requires privacy-safe probes. That is a useful `PARTIAL` incident runbook.

Missing or unverified elements include severity model, incident commander, out-of-hours escalation, provider contacts, evidence retention, customer communications, privacy/NDB assessment, recovery priorities, RPO/RTO, backup restore, post-incident review and exercise cadence.

The owner database console is not a resilience substitute. It cannot provide provider ownership, schema/migration control, independent export, off-platform backup, point-in-time recovery, disaster recovery or exit. It also creates a second data-repair path that may bypass domain side effects. Its status and recommendation are in `13_DATABASE_CONSOLE_SECURITY_REVIEW.md`.

## Required production-readiness sequence

1. Withdraw the deployed generic database console and replace any justified capability with explicit read-only diagnostics plus named domain repair commands.
2. Run the complete `validate` gate and production build in an isolated clean worktree at the exact candidate SHA.
3. Add required remote CI with branch protection, immutable artifacts, dependency/secret/SBOM scanning and exact-SHA Sites packaging.
4. Establish preview/staging resources with synthetic identities/data and provider sandboxes; promote the same tested artifact.
5. Add automated browser/API smoke and accessibility tests for every route family; the bounded v199 console QA is not a substitute.
6. Expand `/api/health` into separate liveness and protected readiness/freshness views without exposing dependency detail publicly.
7. Make scheduled work durable, idempotent, observable and alertable.
8. Define SLIs/SLOs for availability, latency, correctness, provider delivery, job freshness and data recovery; attach owners and escalation.
9. Implement independent D1/R2 export, encrypted off-platform backup, isolated restore/reconciliation and measured RPO/RTO.
10. Document and exercise release rollback, disaster recovery, provider-account recovery and platform exit.

## Final classification

- Automated source quality at `4a5cd19`: all audit-executed checks passed; the release task additionally records complete validation and build.
- Sites version 199 from `4a5cd19`: `VERIFIED DEPLOYED` with exact deployment ID and signed-in read-only QA recorded at documentation commit `ff3c8ef`.
- Console read path/redaction and canonical liveness: `VERIFIED DEPLOYED`; mutation, recovery and exhaustive data safety remain `UNKNOWN`/`PARTIAL`.
- CI enforcement, backup/restore, disaster recovery, failover, SLOs and current external monitor operation: `UNKNOWN` or `PARTIAL` as detailed above.
- Store-ready mobile delivery: `BLOCKED` by missing external accounts/credentials recorded in `docs/RELEASE_TRUTH.md:126`.
