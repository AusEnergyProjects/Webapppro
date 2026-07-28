# Evidence index and command log

Audit date: 21 July 2026 (Australia/Sydney)<br>
Final repository checkpoint: `ff3c8efe3d5e501286d8e83e28086d6d4590be27`<br>
Application/deployment source: `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`<br>
Recorded production: ChatGPT Sites version 199, deployment `appgdep_6a5f78c0b3cc81919214c0deb5a3a8f3`, environment revision 18

This document indexes the evidence used by the audit, commands/checks actually performed, and exact evidence still missing. It deliberately contains no token, cookie, secret value, private key, environment value or production record.

## Evidence hierarchy used

Material claims were classified from the strongest available layer and did not inherit a stronger status from a weaker layer:

1. dated observable production/runtime evidence;
2. active deployment and infrastructure configuration;
3. commands/tests executed during this audit;
4. active source, schema, migrations and manifests;
5. Git/GitHub history and release metadata;
6. documentation/comments;
7. explicit inference.

`VERIFIED DEPLOYED` therefore means a precise release/deployment plus bounded dated runtime evidence, not merely a source file or test. An absent credential/account/provider record is `UNKNOWN` unless read-only account/configuration evidence explicitly showed the key absent.

All source `path:line` citations are repository-root-relative. A bare `README.md:*` or `package.json:*` citation therefore means the repository-root file, not a same-named file under `mobile/`, `test/` or this audit directory.

## Repository and release chronology

Four states occurred while the audit was active. All were external concurrent changes; the audit itself wrote only this audit directory.

| Snapshot | Git/source state | Deployment state at checkpoint | Evidence disposition |
| --- | --- | --- | --- |
| A | `543cc189f990708e8204d3a2fdf44713322a53fb` plus nine dirty/untracked Database Console-related paths | Latest recorded live release Sites v198 from `f05995b...` | Starting uncommitted evidence; not deployment-verified |
| B | clean/pushed implementation `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`, direct child of A's HEAD | At the captured instant docs still ended at v198 | Committed implementation, deployment not yet evidenced |
| C | source still `4a5cd19`; release-doc edits temporarily dirty | Sites v199 reported from `4a5cd19` | Transitional evidence; do not treat dirty docs as an immutable release record |
| D | clean/pushed `ff3c8efe3d5e501286d8e83e28086d6d4590be27`, documentation-only child of `4a5cd19` | v199/deployment record committed in `docs/RELEASE_TRUTH.md:124` | Final audit repository checkpoint; deployed application remains parent `4a5cd19` |

`git diff 4a5cd19..ff3c8ef` changes only `docs/HANDOVER_NEXT_TASK.md` and `docs/RELEASE_TRUTH.md` (12 insertions, 9 deletions). Tests executed at `4a5cd19` remain application-source relevant, while the final release record is separately attributable to `ff3c8ef`.

## Repository/worktree identity

| Item | Result | Evidence/check |
| --- | --- | --- |
| Authoritative audit repository | `C:\Webproject\aea-energy-domain-migration` | Git root, manifests, Sites config and product source all resolve here |
| Branch | `codex/sites-custom-domain-migration` | `git branch --show-current` |
| Final local/upstream SHA | both `ff3c8efe3d5e501286d8e83e28086d6d4590be27` | `git rev-parse HEAD`; `git rev-parse @{u}` |
| Remote | `https://github.com/AusEnergyProjects/Webapppro.git` | credential-free `git remote -v`/GitHub metadata |
| Default remote branch | `main` at `269e8bf...` at audit observation | `gh repo view`/remote ref inspection |
| Local `main` | `539dd112...` at audit observation | local ref inspection; explicitly not assumed current remote main |
| Other worktree | `C:\Webproject\aea-energy` at `e56fc976...`, branch `agent/secure-verification-evidence` | `git worktree list --porcelain`; not the audited source tree |
| Workspace parent | `C:\Webproject` has an unrelated uninitialised/empty-master Git context and many untracked directories | Git inspection; not authoritative application repository |
| Tags/releases | zero Git tags; zero GitHub Releases | `git tag --list`; `gh release list` |
| Pull requests/issues | PR #1 merged, PR #2 open; zero issues at observation | authenticated read-only `gh pr list`, `gh issue list` |
| GitHub access | repository public; authenticated viewer permission reported ADMIN | `gh repo view`; does not prove billing/legal ownership |
| Final worktree | only `docs/audit/2026-07-21-complete-current-state/` untracked | `git status --short --branch`; no tracked file changed by audit |

## Deterministic inventory evidence

Baseline/final source counts are unchanged by the documentation-only final commit. New audit files are excluded from the 675 tracked-file denominator because they are untracked audit outputs.

| Inventory class | Count/result | Discovery method and report |
| --- | ---:| --- |
| Tracked files | 675 | `git ls-files`; disposition rules in `00_AUDIT_MANIFEST_AND_COVERAGE.md` |
| Baseline untracked outside audit | 0 | clean Snapshot D before/aside from allowed audit folder |
| Final audit outputs | 22 required untracked Markdown files | exact-name check in audit directory |
| Tracked text / binary | 661 / 14 | extension/content classification; binaries inventoried, not decoded |
| Tracked documentation | 23 | complete register in `04_DOCUMENTATION_TRUTH_AND_LINK_AUDIT.md` |
| Tracked `test/**` files | 101 | 100 executable `*.test.js|mjs|ts|tsx` modules plus `test/package.json`; manifest-based classification |
| Web page components | 41 | all represented in `07_FRONTEND_UX_AND_ACCESSIBILITY.md` |
| API route files / HTTP operations | 94 / 197 | all represented in `08_BACKEND_API_WORKERS_AND_JOBS.md` |
| Machine-readable API specification files | 0 | tracked-path scan for OpenAPI, Swagger, AsyncAPI, GraphQL-schema and Protocol Buffer files |
| Regular schema tables | 145 | `sqliteTable` declarations in `db/schema.ts`; complete register in `09_DATA_DATABASE_STORAGE_AND_MIGRATIONS.md` |
| Production migrations | 79 | ordered `drizzle/*.sql`; complete register in `09` |
| Drizzle journal entries | 68 | `drizzle/meta/_journal.json`; 11 SQL migrations absent from journal |
| FTS virtual tables / triggers | 5 / 16 | static schema/migration inspection |
| Foreign keys/references | 0 | zero Drizzle `.references(...)`; zero SQL `FOREIGN KEY`/`REFERENCES` across all 79 migrations |
| Config/env/manifest files | 15 | exact extension/path rules |
| Direct deployment/infrastructure descriptors | 6 | exact allowlist: `.openai/hosting.json`, `drizzle.config.ts`, `next.config.ts`, `vite.config.ts`, `mobile/app.json`, `mobile/eas.json`; runtime source and generic package manifests excluded from this non-overlapping class |
| Archived/historical tracked documents | 8 | exact lifecycle-based document allowlist in report 00; mixed current/history records remain in their active classes |
| Secret-bearing tracked surfaces / confirmed embedded-secret files | 2 / 0 | filename predicate returns only `.env.example` and `mobile/.env.example`, both placeholder/example surfaces; separate high-confidence signature scan returned zero and emitted no matched content |
| Generated Drizzle metadata | 55 files, approximately 10.8 MB | path/size inventory; excluded from line-by-line inspection |
| Ignored files | at least 86,100 | `git ls-files --others --ignored --exclude-standard`; four overlong mobile dependency paths generated warnings, so count is a lower bound |
| Root `node_modules` | 39,811 files, approximately 879.0 MB | read-only directory inventory; vendored dependency output excluded |
| `mobile` tree | 46,150 files, approximately 726.2 MB total; 46,107 ignored | read-only directory inventory; tracked mobile source separately inspected |
| `dist` | 161 files, approximately 12.9 MB | ignored build output; excluded |
| `.wrangler` | 19 files, approximately 0.54 MB | ignored local runtime/cache; excluded |
| `.openai` | 2 files, approximately 5.39 MB total | one tracked hosting manifest inspected; one ignored package/archive excluded |
| `tsconfig.tsbuildinfo` | 1 file, 252,523 bytes | ignored TypeScript incremental-build cache; generated/reproducible and excluded from source inspection |

Language/extension counts at application checkpoint: `.ts` 192, `.tsx` 138, `.mjs` 120, `.sql` 84 (79 production plus five opt-in synthetic fixtures), `.json` 66, `.md` 23, `.js` 13, `.png` 11, `.css` 11, `.svg` 7, two `.gitignore`, two `.example`, and one each of `.ico`, `.html`, `.gs`, `.cjs`, `.jpg`, `.xlsx`. Counts are tracked files only.

## Discovered environment evidence

The environment denominator is six named environment classes in the deterministic map in `00_AUDIT_MANIFEST_AND_COVERAGE.md`. Discovery does not imply availability: missing staging/DR and unexecuted native profiles are mapped outcomes, not omitted rows.

| Environment ID | Discovered environment/class | Mapped evidence | Disposition |
| --- | --- | --- | --- |
| ENV-01 | Local development/test | manifests, existing dependency trees, local test/type/lint/migration commands | mapped; tests executed, no production equivalence inference |
| ENV-02 | Preview | official Sites rule that every deployment URL is production; no isolated app/provider preview proved | mapped `UNKNOWN`/not safely established |
| ENV-03 | Staging | repository/provider search found no dedicated owner-controlled staging resources or sandbox parity | mapped `UNKNOWN` |
| ENV-04 | Production | Sites project/version/deployment, canonical domain, Worker and logical D1/R2 bindings; bounded public/runtime observations | mapped `VERIFIED DEPLOYED` only for the cited bounded facts |
| ENV-05 | Native development/internal/production profiles | `mobile/eas.json` profile configuration | mapped configuration; signed builds/store/device execution `BLOCKED` |
| ENV-06 | Disaster recovery | no independently restored D1/R2 application or alternate control plane | mapped `UNKNOWN` |

**Environment coverage: 6 mapped / 6 discovered.** CMD-023 extracts this denominator from the manifest's environment table. This does not close the inaccessible staging, production-account or DR evidence gaps.

## Discovered subsystem evidence

The subsystem denominator is the 36 distinct `HST-01` through `HST-36` component IDs in `06_HOSTING_OWNERSHIP_AND_CRM_SUITABILITY.md`. Each ID is represented across that report's technology/environment/evidence, owner/control, data/recovery and operations/exit matrices.

| Subsystem group | IDs | Discovered components | Mapped result |
| --- | --- | --- | --- |
| Web/runtime/scheduled compute | HST-01 to HST-06 | frontend, server/API, Worker, two Worker jobs, cron | 6/6 mapped |
| Queue/data/edge/config | HST-07 to HST-14 | queue absence, D1, R2, Firebase, DNS, TLS, CDN/cache, secrets/config | 8/8 mapped |
| Providers and platform telemetry | HST-15 to HST-26 | Resend, Twilio, Apps Script relay, two calendars, two payment providers, three accounting providers, monitoring, analytics | 12/12 mapped |
| Recovery/delivery/source/admin | HST-27 to HST-30 | backup gap, CI/release, source repository, Database Console | 4/4 mapped |
| Apps Script and mobile background operations | HST-31 to HST-36 | follow-up job/trigger, health job/trigger, mobile sync job/registration | 6/6 mapped |

**Subsystem coverage: 36 mapped / 36 discovered.** This is a topology/control disposition, not proof that every external account, scheduled run or mobile installation is live or healthy.

## Commands and checks actually run

Repeated read-only invocations with different files/patterns are grouped below; the parameter domain and result are recorded so a grouped entry does not imply only one file was inspected. Commands were run from `C:\Webproject\aea-energy-domain-migration` unless stated otherwise.

### Execution-record contract and limitation

The command tables in this report are a normalized ledger of **material evidence-producing processes**. A row marked `executed` preserves an exact invocation and observed numeric process status. A row marked `reproducible equivalent` gives the exact read-only invocation used to reproduce an earlier grouped/parser result after the raw exploratory command text was no longer available. `E1` means Windows PowerShell 5.1.26100.8655 in `C:\Webproject\aea-energy-domain-migration`, with Node.js v22.14.0, npm 10.9.2, Git 2.53.0.windows.2, GitHub CLI 2.96.0, ripgrep 15.1.0 and Wrangler 4.92.0. `E2` means a read-only provider/web tool call, which is not an operating-system process and therefore has numeric exit status `N/A`.

A complete raw PTY/tool transcript across the coordinating task and all specialist tasks was not exported into the audit. Consequently, exact one-off invocations used only to display source (`Get-Content`), refine searches (`rg`) or inspect intermediate drafts cannot all be reconstructed. Those commands did not supply an otherwise unsupported material conclusion, but the literal requirement to enumerate *every process invocation* is not met. This is an explicit command-ledger stopping gap and one reason the verdict remains `AUDIT INCOMPLETE`; it is not silently represented as complete. Every command whose result is quoted as validation or supports a material finding is either exact below or has a named non-process evidence record.

### Exact normalized process registry

| ID | Record | Exact invocation | Environment | Numeric exit status | Bounded result / evidence limit |
| --- | --- | --- | --- | ---:| --- |
| CMD-001 | executed/fresh closure | exact invocation in the companion command block below | E1 | 0 | PowerShell 5.1.26100.8655; Node v22.14.0; npm 10.9.2; Git 2.53.0.windows.2; gh 2.96.0; ripgrep 15.1.0; Wrangler 4.92.0. Host versions are not repository/runtime pins. |
| CMD-002 | executed/fresh closure | `git rev-parse HEAD; git rev-parse '@{u}'; git branch --show-current` | E1 | 0 | local/upstream `ff3c8efe...` and branch `codex/sites-custom-domain-migration` |
| CMD-003 | executed/fresh closure | `git status --short --branch` | E1 | 0 | branch tracks upstream; only `?? docs/audit/` |
| CMD-004 | executed/fresh closure | `git diff --check` | E1 | 0 | no tracked whitespace error; untracked audit contents are validated separately |
| CMD-005 | executed/fresh closure | exact invocation in the companion command block below | E1 | 0 | 675 tracked files; 100 executable test modules; 101 total tracked `test/**` files |
| CMD-006 | executed/fresh closure | `Test-Path -LiteralPath 'scripts\\package-site.sh'; git log --all --format='%H' -- 'scripts/package-site.sh'; git ls-files 'scripts/**'` | E1 | 0 | `False`; no history output; six tracked script paths, none a packaging script. v199 provenance exists, but a repository-owned package/save/deploy invocation is not retained. |
| CMD-007 | executed/audit | `npm.cmd test` | E1 at application source `4a5cd19` | 0 | 699 tests: 697 pass, 0 fail, 2 skip, 0 todo; three recorded runs are separated in the test table below |
| CMD-008 | executed/audit | `npm.cmd run lint` | E1 at application source `4a5cd19` | 0 | configured ESLint gate passed |
| CMD-009 | executed/audit | `.\\node_modules\\.bin\\tsc.cmd --noEmit --pretty false --incremental false` | E1 at application source `4a5cd19` | 0 | root type-check passed without output |
| CMD-010 | executed/audit | `.\\mobile\\node_modules\\.bin\\tsc.cmd -p mobile\\tsconfig.json --noEmit --pretty false --incremental false` | E1 at application source `4a5cd19` | 0 | mobile type-check passed without native build/device execution |
| CMD-011 | executed/audit | `npm.cmd run db:check` | E1 at application source `4a5cd19` | 0 | all 79 migrations applied to fresh temporary local D1; not production upgrade/restore proof |
| CMD-012 | executed/audit | `node --experimental-strip-types --test test/admin-database-console.test.mjs` | E1 at application source `4a5cd19` | 0 | 11/11 source/helper tests passed; no real D1 mutation |
| CMD-013 | executed/audit | `npm.cmd run audit:links` | E1 at application source `4a5cd19` | 1 | 177 checks; 171 non-broken including 16 automation-blocked; six reported broken. Five are method-sensitive provider endpoints; ReAmped remains credible. |
| CMD-014 | executed/fresh closure | exact invocation in the network command block below | E1, public network, 22 July 2026 | 0 | HTTP 200; public root only |
| CMD-015 | executed/fresh closure | exact invocation in the network command block below | E1, public network, 22 July 2026 | 0 | HTTP 200; bounded health route, not dependency readiness |
| CMD-016 | executed/fresh closure | exact invocation in the network command block below | E1, public network, 22 July 2026 | 0 | HTTP 308 to canonical host; actual legacy hostname comes from `worker/index.ts:7` |
| CMD-017 | executed/fresh closure | exact invocation in the companion command block below | E1, public DNS, 22 July 2026 | 0 | CNAME to `custom-domains.chatgpt.site`; point-in-time routing, not account ownership |
| CMD-018 | executed/fresh closure | exact invocation in the companion command block below | E1, public network, 22 July 2026 | 0 | 200 plus HSTS, Permissions-Policy, Referrer-Policy, nosniff and SAMEORIGIN; no CSP header matched |
| CMD-019 | discarded exploratory target, recorded to avoid false inference | same invocation shape as CMD-016 against `https://info294029--aea-energy-comparison.chatgpt.site/` | E1, public network, 22 July 2026 | 0 | HTTP 404. This guessed hostname was not the source-defined legacy host and supports no application claim; CMD-016 is the corrected check. |
| CMD-020 | executed/fresh closure | material-claim extraction command in the exact validator block below | E1 | 0 | 23 material claims extracted; 23 have detailed `Exact evidence` blocks |
| CMD-021 | executed/fresh closure | audit-folder structure command in the exact validator block below | E1 | 0 | 22/22 exact files, 27 relative links, zero filename/size/H1/fence/table/control/link error |
| CMD-022 | executed/fresh closure | definitive fenced-code-excluding audit citation command below | E1 | 0 | 1,266/1,266 unique repository-root or same-audit `path:line[-line][,line-range]` specifications resolved and were in bounds; zero invalid |
| CMD-023 | executed/fresh closure | inventory/environment/subsystem parser in the exact validator block below | E1 | 0 | 675 tracked; 23 tracked docs; 100 test modules; 41 pages; 94 route files/197 operations; 145 tables; 79 migrations/68 journal entries; 6 environments; 36 subsystems |
| CMD-024 | executed/audit | `npm ls --depth=0` | E1 at application source `4a5cd19` | 1 | extraneous `@emnapi/core`, `@emnapi/runtime`, `@emnapi/wasi-threads`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`; dependency-hygiene evidence, not a production-failure result |
| CMD-025 | discarded optional scanner probe | `gitleaks version` | E1 | 1 | command not found; no package or scanner was installed, and no result was inferred from its absence |
| CMD-026 | executed/fresh closure | exact invocation in the companion inventory block below | E1 | 0 | 0 machine-readable API specifications; 6 deployment/infrastructure descriptors; 8 archived/historical documents; 2 secret-bearing example surfaces; 0 high-confidence embedded-secret files |
| CMD-027 | executed/fresh closure | `Get-Item -LiteralPath 'tsconfig.tsbuildinfo' \| Select-Object FullName,Length,LastWriteTime; git check-ignore -v -- 'tsconfig.tsbuildinfo'` | E1 | 0 | one 252,523-byte root cache ignored by `.gitignore:50`; generated TypeScript incremental-build material, not tracked source |

The first attempted nested-PowerShell form of CMD-020 exited 1 because the outer PowerShell expanded the inner `$` variables before invoking `powershell.exe`. It produced no claim count and was replaced by the direct E1 invocation below. A separate exploratory URL-extraction command also exited 1 on PowerShell quoting and produced no evidence. The first CMD-023 draft exited 0 but returned 40 pages and seven environment rows because it omitted the root page and counted the table header; that output was rejected and the corrected exact invocation below returned 41 and six. These failed/discarded runs are retained here because they were process executions, not rewritten as passing checks.

CMD-014 to CMD-016 exact invocations:

```powershell
curl.exe --silent --show-error --output NUL --write-out "http=%{http_code};effective=%{url_effective};redirect=%{redirect_url}`n" "https://compare.ausenergyassessments.com/"
curl.exe --silent --show-error --output NUL --write-out "http=%{http_code};effective=%{url_effective};redirect=%{redirect_url}`n" "https://compare.ausenergyassessments.com/api/health"
curl.exe --silent --show-error --output NUL --write-out "http=%{http_code};effective=%{url_effective};redirect=%{redirect_url}`n" "https://aea-energy-comparison.info294029.chatgpt.site/"
```

CMD-001, CMD-005, CMD-017 and CMD-018 exact companion invocations:

```powershell
$PSVersionTable.PSVersion.ToString(); node --version; npm.cmd --version; git --version; gh --version | Select-Object -First 1; rg --version | Select-Object -First 1; .\node_modules\.bin\wrangler.cmd --version
git ls-files | Measure-Object | Select-Object -ExpandProperty Count; @(git ls-files 'test/**' | Where-Object {$_ -match '\.test\.(js|mjs|ts|tsx)$'}).Count; @(git ls-files 'test/**').Count
Resolve-DnsName compare.ausenergyassessments.com -Type CNAME | Select-Object Name,Type,NameHost | Format-Table -AutoSize
curl.exe --silent --show-error --dump-header - --output NUL "https://compare.ausenergyassessments.com/" | Select-String -Pattern '^(HTTP/|strict-transport-security:|permissions-policy:|referrer-policy:|x-content-type-options:|x-frame-options:|content-security-policy:)'
```

CMD-026 exact companion inventory invocation (outputs counts and paths only, never matched secret content):

```powershell
$tracked=@(git ls-files); $secretSurface=@($tracked|Where-Object{$_ -match '(^|/)\.env\.example$' -or $_ -match '(?i)(^|/)(id_rsa|id_ed25519|.*\.(pem|key|p12|pfx))$'}); $pattern='(?m)(-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b|"private_key"\s*:\s*"-----BEGIN)'; $contentHits=@(); foreach($f in $tracked){try{$t=[IO.File]::ReadAllText((Join-Path (Get-Location) $f));if($t -match $pattern){$contentHits+=$f}}catch{}}; $spec=@($tracked|Where-Object{$_ -match '(?i)(^|/)(openapi|swagger|asyncapi|api[-_.]?spec|api[-_.]?schema)(\.|/)|(?i)\.(proto|graphqls?)$'}); $infra=@($tracked|Where-Object{$_ -in @('.openai/hosting.json','drizzle.config.ts','next.config.ts','vite.config.ts','mobile/app.json','mobile/eas.json')}); $historical=@($tracked|Where-Object{$_ -in @('DIRECT_TRADE_DASHBOARD_PROMPT.md','NATIVE_ELECTRICITY_PARITY_AUDIT.md','PLATFORM_ARCHITECTURE.md','docs/COMPETITIVE_PRODUCT_STRATEGY.md','docs/EXTERNAL_AUDIT_REMEDIATION.md','docs/PLATFORM_SCALE_HARDENING_AUDIT.md','docs/UI_UX_OPTIMISATION_AUDIT.md','docs/scale-ui-ux-audit-2026-07-16.md')}); [pscustomobject]@{ApiSpecificationFiles=$spec.Count;DeploymentInfrastructureDescriptors=$infra.Count;DeploymentInfrastructurePaths=($infra -join ',');ArchivedHistoricalDocuments=$historical.Count;SecretBearingSurfaceFiles=$secretSurface.Count;HighConfidenceEmbeddedSecretFiles=$contentHits.Count}|ConvertTo-Json -Compress; if($spec.Count -ne 0 -or $infra.Count -ne 6 -or $historical.Count -ne 8 -or $secretSurface.Count -ne 2 -or $contentHits.Count -ne 0){exit 1}
```

Observed numeric exit `0`; output `{"ApiSpecificationFiles":0,"DeploymentInfrastructureDescriptors":6,"DeploymentInfrastructurePaths":".openai/hosting.json,drizzle.config.ts,mobile/app.json,mobile/eas.json,next.config.ts,vite.config.ts","ArchivedHistoricalDocuments":8,"SecretBearingSurfaceFiles":2,"HighConfidenceEmbeddedSecretFiles":0}`.

### Exact parser and validator invocations

CMD-020, authoritative cross-report material-claim extraction:

```powershell
$p='docs\audit\2026-07-21-complete-current-state\18_FINDINGS_RISKS_ASSUMPTIONS_AND_DECISIONS.md'; $t=Get-Content -Raw -LiteralPath $p; $s=[regex]::Match($t,'(?s)## Priority summary\s*(.*?)\s*## Detailed findings').Groups[1].Value; $ids=@([regex]::Matches($s,'(?m)^\| (AUD-[A-Z]+-\d{3}) \|') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique); $ok=0; $missing=@(); foreach($id in $ids){ $b=[regex]::Match($t,('(?ms)^### '+[regex]::Escape($id)+'\b.*?(?=^### AUD-|^## Separate finding registers)')).Value; if($b -and $b -match '(?m)^- \*\*Exact evidence:\*\*'){ $ok++ } else { $missing += $id } }; [pscustomobject]@{materialClaimsExtracted=$ids.Count;materialClaimsEvidenced=$ok;missing=($missing -join ',')} | ConvertTo-Json -Compress; if($ok -ne $ids.Count){exit 1}
```

Observed numeric exit `0`; output `{"materialClaimsExtracted":23,"materialClaimsEvidenced":23,"missing":""}`.

CMD-023, deterministic inventory plus separate environment and subsystem denominators:

```powershell
$api=@(git ls-files 'src/app/api/**/route.*'); $ops=0; foreach($f in $api){$t=Get-Content -Raw -LiteralPath $f; $ops += [regex]::Matches($t,'(?m)^export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b').Count}; $schema=(Get-Content -Raw -LiteralPath 'db\schema.ts'); $envText=Get-Content -Raw -LiteralPath 'docs\audit\2026-07-21-complete-current-state\00_AUDIT_MANIFEST_AND_COVERAGE.md'; $envBlock=[regex]::Match($envText,'(?ms)^## Environment map\s*(.*?)^## Deterministic tracked-file disposition').Groups[1].Value; $envRows=@($envBlock -split "`r?`n" | Where-Object {$_ -match '^\| ' -and $_ -notmatch '^\| (Environment|---)'}); $hst=@(Select-String -Path 'docs\audit\2026-07-21-complete-current-state\06_HOSTING_OWNERSHIP_AND_CRM_SUITABILITY.md' -Pattern '^\| HST-(\d+) \|' | ForEach-Object {[regex]::Match($_.Line,'HST-(\d+)').Groups[1].Value} | Sort-Object -Unique); [pscustomobject]@{tracked=@(git ls-files).Count;trackedDocs=@(git ls-files '*.md').Count;testModules=@(git ls-files 'test/**' | Where-Object {$_ -match '\.test\.(js|mjs|ts|tsx)$'}).Count;pages=@(git ls-files 'src/app/page.*' 'src/app/**/page.*' | Sort-Object -Unique).Count;apiRouteFiles=$api.Count;httpOperations=$ops;schemaTables=[regex]::Matches($schema,'sqliteTable\(').Count;migrations=@(git ls-files 'drizzle/*.sql').Count;journalEntries=((Get-Content -Raw 'drizzle\meta\_journal.json' | ConvertFrom-Json).entries.Count);environments=$envRows.Count;subsystems=$hst.Count} | ConvertTo-Json -Compress
```

Observed numeric exit `0`; output `{"tracked":675,"trackedDocs":23,"testModules":100,"pages":41,"apiRouteFiles":94,"httpOperations":197,"schemaTables":145,"migrations":79,"journalEntries":68,"environments":6,"subsystems":36}`.

CMD-021, exact-name/nonempty/H1/size/fence/table/control-character/relative-link validator:

```powershell
$audit=(Resolve-Path 'docs\audit\2026-07-21-complete-current-state').Path; $expected=@('00_AUDIT_MANIFEST_AND_COVERAGE.md','01_EXECUTIVE_PRODUCT_SUMMARY.md','02_INDUSTRY_BUSINESS_AND_GLOSSARY.md','03_PRODUCT_FEATURE_AND_WORKFLOW_STATUS.md','04_DOCUMENTATION_TRUTH_AND_LINK_AUDIT.md','05_CURRENT_ARCHITECTURE_AND_TECHNOLOGY.md','06_HOSTING_OWNERSHIP_AND_CRM_SUITABILITY.md','07_FRONTEND_UX_AND_ACCESSIBILITY.md','08_BACKEND_API_WORKERS_AND_JOBS.md','09_DATA_DATABASE_STORAGE_AND_MIGRATIONS.md','10_AUTH_SECURITY_PRIVACY_AND_COMPLIANCE.md','11_EXTERNAL_INTEGRATIONS.md','12_TESTING_DEPLOYMENT_OPERATIONS_AND_RESILIENCE.md','13_DATABASE_CONSOLE_SECURITY_REVIEW.md','14_AI_NAVIGATION_AND_PLATFORM_INTELLIGENCE.md','15_RECOMMENDED_DOCUMENTATION_ARCHITECTURE.md','16_PRODUCTION_PLATFORM_OPTIONS.md','17_MOVE_OFF_SITES_DECISION_AND_PLAN.md','18_FINDINGS_RISKS_ASSUMPTIONS_AND_DECISIONS.md','19_FORMAL_ROADMAP.md','20_EVIDENCE_INDEX_AND_COMMAND_LOG.md','README.md'); $actual=@(Get-ChildItem -LiteralPath $audit -File | ForEach-Object Name | Sort-Object); $bad=@(); $missing=@($expected | Where-Object {$_ -notin $actual}); $extra=@($actual | Where-Object {$_ -notin $expected}); if($missing){$bad+='missing: '+($missing -join ',')}; if($extra){$bad+='extra: '+($extra -join ',')}; $relative=0; $brokenLinks=@(); $tableErrors=@(); $fenceErrors=@(); $controlErrors=@(); foreach($name in $expected){ $path=Join-Path $audit $name; if(-not (Test-Path -LiteralPath $path -PathType Leaf)){continue}; $item=Get-Item -LiteralPath $path; $text=Get-Content -Raw -LiteralPath $path; $lines=Get-Content -LiteralPath $path; if($item.Length -le 500){$bad+=$name+' <=500 bytes'}; if($text -notmatch '(?m)^# '){$bad+=$name+' lacks H1'}; $controls=@($text.ToCharArray() | Where-Object {([int]$_ -lt 32) -and ([int]$_ -notin 9,10,13)}); if($controls.Count){$controlErrors+=$name+':'+$controls.Count}; $fences=@($lines | Where-Object {$_ -match '^\s*(```|~~~)'}); if(($fences.Count % 2) -ne 0){$fenceErrors+=$name+':'+$fences.Count}; $inTable=$false; $pipeCount=$null; for($i=0;$i -lt $lines.Count;$i++){ $line=$lines[$i]; if($line.TrimStart().StartsWith('|')){ $scrub=[regex]::Replace($line,'`[^`]*`',''); $count=[regex]::Matches($scrub,'(?<!\\)\|').Count; if(-not $inTable){$inTable=$true;$pipeCount=$count}elseif($count -ne $pipeCount){$tableErrors+=($name+':'+($i+1)+' expected '+$pipeCount+' pipes got '+$count)} } else {$inTable=$false;$pipeCount=$null} }; [regex]::Matches($text,'(?<!!)\[[^\]]+\]\((?<target>[^)]+)\)') | ForEach-Object { $target=$_.Groups['target'].Value.Trim(); if($target -match '^<(.+)>$'){$target=$Matches[1]}; if($target -match '^(https?://|mailto:|#)'){return}; $target=($target -split '#',2)[0]; if(-not $target){return}; $relative++; try{$decoded=[uri]::UnescapeDataString($target)}catch{$decoded=$target}; $dest=Join-Path (Split-Path -Parent $path) ($decoded -replace '/','\'); if(-not (Test-Path -LiteralPath $dest)){$brokenLinks+=($name+' -> '+$target)} } }; if($fenceErrors){$bad+='fences: '+($fenceErrors -join ',')}; if($tableErrors){$bad+='tables: '+($tableErrors -join ',')}; if($controlErrors){$bad+='controls: '+($controlErrors -join ',')}; if($brokenLinks){$bad+='links: '+($brokenLinks -join ',')}; [pscustomobject]@{expected=$expected.Count;actual=$actual.Count;relativeLinks=$relative;invalid=$bad.Count;details=($bad -join ' || ')} | ConvertTo-Json -Compress; if($bad.Count -gt 0){exit 1}
```

Final observed numeric exit `0`; output `{"expected":22,"actual":22,"relativeLinks":27,"invalid":0,"details":""}`.

CMD-022, all-audit repository/same-folder `path:line[-line][,line-range]` validator (including dynamic route paths with square brackets):

```powershell
$audit=(Resolve-Path 'docs\audit\2026-07-21-complete-current-state').Path; $root=(Resolve-Path '.').Path; $refs=@{}; $bad=@(); Get-ChildItem -LiteralPath $audit -Filter '*.md' | ForEach-Object { $source=$_.Name; $text=Get-Content -Raw -LiteralPath $_.FullName; [regex]::Matches($text,'`([^`\r\n]+)`') | ForEach-Object { $code=$_.Groups[1].Value; [regex]::Matches($code,'(?<path>(?:(?:[A-Za-z0-9_.@()\[\]$-]+[\\/])+)?[A-Za-z0-9_.@()\[\]$ -]+\.[A-Za-z0-9]+):(?<lines>\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)') | ForEach-Object { $rel=$_.Groups['path'].Value -replace '/','\'; $spec=$_.Groups['lines'].Value; $key=($rel.ToLowerInvariant()+':'+$spec); if(-not $refs.ContainsKey($key)){ $candidate=Join-Path $root $rel; if(-not (Test-Path -LiteralPath $candidate -PathType Leaf)){ $candidate=Join-Path $audit $rel }; if(-not (Test-Path -LiteralPath $candidate -PathType Leaf)){ $bad += ($source+' -> missing '+$rel+':'+$spec) } else { $count=(Get-Content -LiteralPath $candidate).Count; foreach($part in $spec -split ','){ $bounds=$part -split '-'; $lo=[int]$bounds[0]; $hi=if($bounds.Count -gt 1){[int]$bounds[1]}else{$lo}; if($lo -lt 1 -or $hi -lt $lo -or $hi -gt $count){ $bad += ($source+' -> range '+$rel+':'+$part+' of '+$count) } } }; $refs[$key]=$true } } } }; [pscustomobject]@{uniqueParsedCitations=$refs.Count;invalid=$bad.Count;details=($bad -join ' || ')} | ConvertTo-Json -Compress; if($bad.Count -gt 0){exit 1}
```

The initial fresh run after coverage expansion returned 1,004 unique citation specifications and zero invalid. For the final gate, fenced code is excluded so command examples cannot be mistaken for report citations. The definitive CMD-022 invocation is:

```powershell
$audit=(Resolve-Path 'docs\audit\2026-07-21-complete-current-state').Path; $root=(Resolve-Path '.').Path; $refs=@{}; $bad=@(); Get-ChildItem -LiteralPath $audit -Filter '*.md' | ForEach-Object { $source=$_.Name; $inFence=$false; foreach($line in (Get-Content -LiteralPath $_.FullName)){ if($line -match '^\s*(```|~~~)'){ $inFence=-not $inFence; continue }; if($inFence){continue}; [regex]::Matches($line,'`([^`]+)`') | ForEach-Object { $code=$_.Groups[1].Value; [regex]::Matches($code,'(?<path>(?:(?:[A-Za-z0-9_.@()\[\]$-]+[\\/])+)?[A-Za-z0-9_.@()\[\]$ -]+\.[A-Za-z0-9]+):(?<lines>\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)') | ForEach-Object { $rel=$_.Groups['path'].Value -replace '/','\'; $spec=$_.Groups['lines'].Value; $key=($rel.ToLowerInvariant()+':'+$spec); if(-not $refs.ContainsKey($key)){ $candidate=Join-Path $root $rel; if(-not (Test-Path -LiteralPath $candidate -PathType Leaf)){ $candidate=Join-Path $audit $rel }; if(-not (Test-Path -LiteralPath $candidate -PathType Leaf)){ $bad += ($source+' -> missing '+$rel+':'+$spec) } else { $count=(Get-Content -LiteralPath $candidate).Count; foreach($part in $spec -split ','){ $bounds=$part -split '-'; $lo=[int]$bounds[0]; $hi=if($bounds.Count -gt 1){[int]$bounds[1]}else{$lo}; if($lo -lt 1 -or $hi -lt $lo -or $hi -gt $count){ $bad += ($source+' -> range '+$rel+':'+$part+' of '+$count) } } }; $refs[$key]=$true } } } } }; [pscustomobject]@{uniqueParsedCitations=$refs.Count;invalid=$bad.Count;details=($bad -join ' || ')} | ConvertTo-Json -Compress; if($bad.Count -gt 0){exit 1}
```

Final observed numeric exit `0`; output `{"uniqueParsedCitations":1266,"invalid":0,"details":""}`. This 1,266/1,266 result replaces the stale earlier 413 figure.

### Non-process tool evidence

These calls have numeric exit status `N/A` because they were structured provider/web/tool calls, not operating-system processes. `N/A` is not a concealed success code.

| Tool evidence class | Exact operation/resource boundary | Numeric exit status | Bounded result / limit |
| --- | --- | --- | --- |
| Sites project/version inspection | read-only list/get Site, versions, selected saved version and deployment status for project `appgprj_6a550c378000819185caf094173422bb` | N/A (structured tool call) | public/active project; v199 and deployment identity recorded; no write performed by the audit |
| Sites domain/access inspection | read-only custom-domain and Site access-policy inspection for the same project | N/A (structured tool call) | canonical domain/SSL active and access public at observation; billing/legal ownership not proved |
| Sites environment inspection | read-only environment revision 18, key names only | N/A (structured tool call) | named provider-key families classified; no value copied or validity inferred |
| Sites Worker-log inspection | bounded read-only log queries | N/A (structured tool call) | inconsistent transient snapshots; no zero-error or durable-history inference |
| Official-source web retrieval | read-only search/open of the URLs indexed under Primary external source index | N/A (web retrieval API) | page/date/content evidence only; no account/private-system access |
| Specialist delegation messages | bounded read-only inventory/research/validation tasks | N/A (orchestration API) | evidence returned to the coordinator; not a shell command, provider mutation or independent source of truth |

### Identity, history and inventory

Unless a row says otherwise, process rows in this and the next two subsections used E1. The numeric status is the recorded process exit; the human-readable result is not a substitute for that status.

| Command/family | Exit/result | Purpose/limit |
| --- | --- | --- |
| `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse HEAD`, `git rev-parse @{u}` | 0; final source/upstream `ff3c8ef` | Repository and final checkpoint |
| `git status --short --branch` (repeated at milestones) | 0; final only audit directory untracked | Worktree-boundary and concurrent-mutation detection |
| `git worktree list --porcelain`, `git submodule status` | 0; two relevant worktrees, no active submodule finding | Workspace topology |
| `git remote -v`, `git remote show origin`, `git ls-remote`, `git branch -a -vv`, `git tag --list` | 0 | Credential-free remote/default/upstream/tag truth |
| `git log --all --date=iso-strict`, `git show --stat`, `git diff --stat`, `git diff --check`, `git reflog` with bounded SHAs/paths | 0 | Commit lineage, snapshot A-D reconciliation and change provenance |
| `git ls-files` plus PowerShell extension/path grouping | 0; 675 | Authoritative tracked inventory and counts |
| `git ls-files --others --exclude-standard`; ignored variant with `--ignored` | 0 with four filename-too-long warnings on ignored mobile dependencies | Baseline untracked and ignored lower-bound count |
| read-only `Get-ChildItem`/`robocopy /L`-style directory statistics for dependency/build/cache paths | 0 | Approximate excluded counts/sizes; no copy/delete performed |
| `gh repo view`, `gh pr list`, `gh issue list`, `gh release list` | 0 | Read-only GitHub metadata; no PR/issue/release mutation |

### Static source/document discovery

| Command/family | Numeric exit status; bounded result | Purpose/limit |
| --- | --- | --- |
| `rg --files` and `rg -n` over manifests, `src`, `db`, `drizzle`, `worker`, `mobile`, `test`, root/docs | 0; matching files/lines supplied the classified inventories | Routes, pages, tables, dependencies, auth, providers, storage, workflows and citations; exact exploratory query strings were not all retained |
| `git grep`/`rg` search families for TODO, FIXME, HACK, XXX, unchecked tasks, placeholders/mocks/temp, `NotImplemented`, skipped/disabled/suppressed tests, legacy/deprecated/dormant paths and issue/PR references | 0; results classified in `04` | Zero genuine TODO-family markers outside excluded payloads, two explicit fixture skips, 196 non-stub placeholder occurrences after exclusions, no unresolved code-stub finding; raw per-query invocations were not all retained |
| CMD-023 API parser over `src/app/api/**/route.*` | 0; 94/94 route files and 197/197 exported operations | Complete API catalogue, method/auth/dependency evidence in `08` |
| CMD-023 page parser over root and nested `src/app/**/page.*` | 0; 41/41 | Complete web page disposition in `07` |
| CMD-023 schema/migration parser over `db/schema.ts`, `drizzle/*.sql`, `drizzle/meta/_journal.json` | 0; 145/145 tables; 79/79 SQL; 68 journal | Complete data/migration catalogue in `09`; zero-FK result came from separate static searches |
| Path/line citation validators run by specialist streams | 0 where retained; 79 architecture/backend cited paths and 185 frontend/security path:line tokens resolved/in range | Source citation integrity for reports 05-13; raw specialist invocations were not retained, so CMD-022 is the reproducible whole-folder gate |
| Markdown table/fence/control-character validators | 0 where retained; zero reported specialist mismatch | Format integrity, not factual proof; CMD-021 is the reproducible whole-folder gate |
| CMD-021 and CMD-022 over all 22 Markdown files | 0 / 0; 22 exact files, 27/27 relative links, zero structure error and 1,266/1,266 valid in-bounds citation specifications | Cross-report structural/citation integrity after final reconciliation |

### Executed tests and build-adjacent checks

All commands below targeted application source `4a5cd19`; final `ff3c8ef` changes only release documentation.

| Command | Exit | Result | Evidence limit |
| --- | ---:| --- | --- |
| `npm.cmd test` (root coordinating run 1) | 0 | 699 tests; 697 pass; 0 fail; 2 skip; 0 todo; approximately 0.95 s | Node/source test evidence only |
| `npm.cmd test` (root coordinating run 2) | 0 | same 699/697/0/2/0; approximately 0.91 s | Repeatability in same host, not flake certification |
| `npm.cmd test` (frontend/security stream recorded run) | 0 | same 699/697/0/2/0; approximately 1.38 s | Confirms final application source; repeated invocation is not browser/provider proof |
| `npm.cmd run lint` | 0 | ESLint passed; approximately 20.56 s | Configured rules only |
| `.\node_modules\.bin\tsc.cmd --noEmit --pretty false --incremental false` | 0 | Root TypeScript passed; approximately 12.33 s | No production asset emitted |
| `.\mobile\node_modules\.bin\tsc.cmd -p mobile\tsconfig.json --noEmit --pretty false --incremental false` | 0 | Mobile TypeScript passed; approximately 1.86 s | No native build/device execution |
| `npm.cmd run db:check` | 0 | all 79 migrations applied to a fresh temporary local D1; approximately 23.06 s | Empty-to-current replay only; no production upgrade/restore proof |
| `node --experimental-strip-types --test test/admin-database-console.test.mjs` | 0 | 11/11 pass | Fake-D1/helper/source-contract tests; no real route mutation |
| `npm.cmd run audit:links` | 1 | 177 checks; 171 non-broken including 16 automation-blocked; 6 reported broken | Five reported failures are method-sensitive provider endpoints; ReAmped is credible unresolved public link |

The two skipped tests are `test/electricity-model.test.js:205` and `test/nem12-typed-parity.test.mjs:92`. Both require an authorised `NEM12_FIXTURE` path and explicitly skip when absent. They are `BLOCKED`, not passed or failed.

`node scripts/seed-synthetic-population.mjs` was **not run**. Static review showed that its no-argument path can target the configured Firebase project and attempt 350 identity mutations while writing credential/checkpoint/output files (`scripts/seed-synthetic-population.mjs:8-14,57-105,107-138,300-321`). It therefore has no audit process exit status; treating source inspection as execution would be unsafe and false. Finding `AUD-OPS-003` records the `BROKEN` local guard and leaves provider enablement/prior execution `UNKNOWN`.

`npm.cmd run validate` and `npm.cmd run build` were not independently run by the read-only audit because they emit output outside the permitted directory. The concurrent release record at `docs/RELEASE_TRUTH.md:124` says full validate, build, 25 focused tests, 33 integration tests and production release checks passed at `4a5cd19`; this is separately labelled release-task evidence.

### Link/network/runtime checks

| Check | Environment | Numeric exit status | Bounded result | Limit |
| --- | --- | ---:| --- | --- |
| Extract relative Markdown links from all 23 tracked docs and resolve path/case | E1 | 0 | 13/13 valid | Sparse navigation remains: 15 tracked Markdown files excluding instruction files have no inbound Markdown link; exact original parser text was not retained |
| Extract tracked-doc URLs | E1 | 0 | 53 occurrences; 50 unique: 37 ordinary public references, 10 first-party callback/probe endpoints, two `.example`, one localhost | Callback/probe/mutation endpoints are not ordinary unauthenticated GET pages; exact original parser text was not retained |
| Safe GET/HEAD of 37 ordinary public documentation URLs | mixed historical network process/tool; exact mechanism not retained | `NOT RETAINED` | 37/37 reachable; two deep links redirected to semantically generic pages | Reachability does not prove content accuracy; lack of a per-request execution ledger is explicit |
| CMD-014 to CMD-016 canonical root, health and source-defined legacy host | E1, public network, fresh 22 July 2026 | 0 each | root 200; health 200; legacy 308 to canonical. The 21 July health check additionally recorded `no-store`. | Public liveness only; no authenticated workflow or dependency readiness |
| CMD-017 DNS | E1, public DNS, fresh 22 July 2026 | 0 | CNAME to `custom-domains.chatgpt.site` | Point-in-time DNS, not account ownership |
| CMD-018 canonical response headers | E1, public network, fresh 22 July 2026 | 0 | HSTS, Permissions-Policy, Referrer-Policy, nosniff and SAMEORIGIN matched; no CSP matched | Individual cached/route variants were not exhaustive |
| Sites read-only project/version/domain/access queries | E2 | N/A | public live Site; custom domain/SSL active; v199 ultimately recorded from `4a5cd19`; access policy public | Provider management access/contract/transfer and data ownership remain separate |
| Worker log queries | E2 | N/A | transient snapshots were inconsistent (one returned events, a later query returned none) | No zero-errors inference; durable history/retention inaccessible |
| Sites environment revision 18 key-name-only inspection | E2 | N/A | Google Calendar, Square, Resend, Twilio, lead relay and Stripe membership key families present; Xero, MYOB, QuickBooks, Microsoft Calendar, Stripe Connect and address-autocomplete families absent | Values were not read; key presence does not prove valid provider account/health; absence is revision-specific |
| Signed-in v199 console QA | external release task evidence, not audit process | N/A | release record says 145 tables browsed, four credential cells masked, add confirmation opened, no production mutation; all three writable tables empty | This audit did not repeat signed-in access or mutation |

### Skill/documentation connector check

The OpenAI documentation skill required official documentation tooling. No OpenAI Docs MCP tool was callable in the active tool set. The exact command `codex mcp add openaiDeveloperDocs --url https://developers.openai.com/mcp` was attempted in the audit host and failed with access denied. Its numeric process exit status was **not retained** in the available handoff/tool record and is not fabricated here. It was not rerun during closure because a successful run could modify connector configuration outside the audit-only write boundary. The bounded result is therefore: failed/access denied, no configuration change observed, numeric exit `UNKNOWN (NOT RETAINED)`. Official OpenAI web/help/learn pages were then used read-only; those are E2 retrievals with process exit `N/A`. No package/plugin/connector was installed.

## Key repository evidence locator

| Evidence topic | Primary repository paths/symbols | Detailed audit |
| --- | --- | --- |
| Product identity/current release | `README.md:3-112`; `docs/RELEASE_TRUTH.md:1-126`; `docs/HANDOVER_NEXT_TASK.md:1-276`; `ROADMAP.md` | 01, 03, 04 |
| Sites/Vinext/Worker topology | `.openai/hosting.json`; `vite.config.ts`; `worker/index.ts`; `package.json`; lockfiles | 05, 06, 12 |
| API catalogue | all `src/app/api/**/route.*`; shared server/auth/provider libraries | 08, 10, 11 |
| Web/mobile route catalogue | all `src/app/**/page.*`; layout/header/navigation/components; `mobile/**` | 07, 03 |
| Schema/migrations/storage | `db/schema.ts`; `drizzle/*.sql`; `drizzle/meta/**`; R2 upload/download libraries/routes | 09 |
| Firebase/auth/roles | `src/lib/admin-server.ts`; Firebase client/server helpers; trade/customer auth and entitlement libraries | 10 |
| Database Console | `src/app/api/admin/database/route.ts`; `src/lib/admin-database-console.ts`; `src/components/AdminDatabaseWorkspace*`; console/admin tests | 13 |
| Payments/accounting/calendar/email/SMS | trade provider routes/libraries; `docs/TRADE_INTEGRATIONS_RUNBOOK.md`; `docs/SERVICE_REMINDER_DELIVERY_RUNBOOK.md`; Apps Script integration | 11, 08, 10 |
| Comparison/industry claims | comparator/plan APIs and engines; `src/app/assessments/page.tsx`; `src/lib/certificate-prices-server.ts`; public guide/rebate content | 02, 03, 10 |
| Tests/release/operations | `test/**`; `scripts/check-migrations.mjs`; `scripts/audit-links.mjs`; `OPERATIONS_RUNBOOK.md`; package scripts | 12, 04 |
| Strategy and future scope | `ROADMAP.md`; `docs/COMPETITIVE_PRODUCT_STRATEGY.md`; historical prompts/audits | 03, 04, 14-19 |

## Primary external source index

All sources below were accessed read-only and checked on 21 July 2026 unless an official page supplies an explicit update/effective date. The audit paraphrases rather than reproducing extended text.

### ChatGPT Sites/OpenAI

- [ChatGPT Sites Terms](https://openai.com/policies/chatgpt-sites-terms/), updated 9 July 2026: licence/hosting, financial-transaction restriction, controller/data and PHI/PCI boundaries, removal/disable authority and beta status.
- [Creating and managing ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites), updated two days before check: beta/access/limits, production URLs, no residency, transaction/card restriction and irreversible Site deletion.
- [Sites manual](https://learn.chatgpt.com/docs/sites.md): management surface, save-version/deploy separation, hosting bindings, auth request boundary and analytics limitations.

The official sources do **not** establish independent D1/R2 querying/export/PITR/off-platform backup, full schema/migration access, direct durable Worker telemetry, provider transfer or workspace-outage behavior. Those remain `UNKNOWN`; absence of documentation was not turned into a negative provider capability claim.

### Australian law/regulators/schemes and accessibility

- [Privacy Act 1988, latest compilation](https://www.legislation.gov.au/C2004A03712/latest); [OAIC small-business guidance](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business); [APP guidelines](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines); [APP 8](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-8-app-8-cross-border-disclosure-of-personal-information); [NDB guidance](https://www.oaic.gov.au/privacy/notifiable-data-breaches/preventing-preparing-for-and-responding-to-data-breaches/data-breach-preparation-and-response/part-4-notifiable-data-breach-ndb-scheme).
- [ACMA spam guidance](https://www.acma.gov.au/avoid-sending-spam) and [Do Not Call Register](https://www.acma.gov.au/do-not-call-register).
- [Competition and Consumer Act 2010/ACL](https://www.legislation.gov.au/C2004A00109/latest); [ACCC false/misleading claims](https://www.accc.gov.au/consumers/advertising-and-promotions/false-or-misleading-claims); [environmental claims](https://www.accc.gov.au/consumers/advertising-and-promotions/environmental-and-sustainability-claims).
- [AER Energy Product Reference Data](https://www.aer.gov.au/energy-product-reference-data).
- NatHERS: [existing-home policy/consent update effective 1 July 2026](https://www.homeenergyrating.gov.au/news/updates-existing-home-assessor-policies-and-consent-forms), [existing-home assessment](https://www.homeenergyrating.gov.au/households/existing-homes/how-get-assessment), [new-home certificate](https://www.homeenergyrating.gov.au/households/new-homes/understanding-your-new-homes-certificate), and [assessor collaboration](https://www.homeenergyrating.gov.au/industry-professionals/builders-and-designers/collaboration-assessors).
- NSW BASIX: [starting an application](https://www.planningportal.nsw.gov.au/basix/about-basix/starting-basix-application) and [alterations/additions](https://www.planningportal.nsw.gov.au/basix/dwelling-types/alterations-and-additions).
- Electrical licensing primary pages: [NSW](https://www.fairtrading.nsw.gov.au/trades-and-businesses/construction-and-trade-essentials/electricians), [Queensland](https://www.worksafe.qld.gov.au/licensing-and-registrations/electrical-licences/classes-of-licences), [South Australia](https://www.sa.gov.au/topics/business-and-trade/licensing/building-and-trades/licensing), [Victoria](https://www.energysafe.vic.gov.au/licensing/electrical-licences/licence-types/registered-electrical-contractors-rec), [Tasmania](https://www.service.tas.gov.au/services/working-in-tasmania/occupational-licences-and-certificates/apply-for-an-electrical-practitioner-licence/), [ACT](https://www.planning.act.gov.au/professionals/regulation-and-responsibilities/construction-licences), [Western Australia](https://www.wa.gov.au/organisation/service-delivery/electrical-licensing), [Northern Territory](https://worksafe.nt.gov.au/licensing-and-registration/electrical-licensing/electrical-contractor-licence); [SA certificate example](https://www.sa.gov.au/topics/energy-and-environment/safe-energy-use/certificates-of-compliance).
- CER/DCCEEW: [installer/designer requirements](https://cer.gov.au/schemes/renewable-energy-target/renewable-energy-target-participants-and-industry/solar-battery-installers-and-designers), [solar batteries](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-renewable-energy-systems/solar-batteries), [STC calculation](https://cer.gov.au/schemes/renewable-energy-target/small-scale-renewable-energy-scheme/small-scale-technology-certificates/calculate-small-scale-technology-certificate-entitlements), [Cheaper Home Batteries](https://www.dcceew.gov.au/energy/programs/cheaper-home-batteries), [Renewable Energy Regulations](https://www.legislation.gov.au/F2001B00053/latest).
- [ATO GST record guidance](https://www.ato.gov.au/api/public/content/0-9354073c-055a-4d41-bd51-b7d9e6b4e834).
- [Disability Discrimination Act 1992](https://www.legislation.gov.au/C2004A04426/latest), [Australian Human Rights Commission guidance](https://humanrights.gov.au/?a=68429) and [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).
- [Electronic Transactions Act 1999](https://www.legislation.gov.au/C2004A00553/latest).

Each potential obligation, affected workflow, repository evidence, status/confidence and expert-confirmation requirement is in `02_INDUSTRY_BUSINESS_AND_GLOSSARY.md`. Applicability was not inferred from branding.

### Platform/target architecture

- Cloudflare: [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [D1 locations](https://developers.cloudflare.com/d1/configuration/data-location/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [R2 locations](https://developers.cloudflare.com/r2/reference/data-location/), [R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/), [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/).
- AWS: [regions](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html), [RDS point-in-time recovery](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html), [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).
- Azure: [geographies](https://azure.microsoft.com/en-us/explore/global-infrastructure/geographies/), [PostgreSQL Flexible Server overview](https://learn.microsoft.com/azure/postgresql/flexible-server/service-overview), [backup/restore](https://learn.microsoft.com/azure/postgresql/backup-restore/concepts-backup-restore).
- Google Cloud/Firebase: [Cloud SQL region availability](https://cloud.google.com/sql/docs/postgres/region-availability-overview), [high availability](https://cloud.google.com/sql/docs/postgres/high-availability), [restore](https://cloud.google.com/sql/docs/postgres/backup-recovery/restore), [Firebase project locations](https://firebase.google.com/docs/projects/locations).

These sources establish candidate capabilities, not configured project state, price or contractual fitness. `16_PRODUCTION_PLATFORM_OPTIONS.md` therefore recommends an architecture class and decision gate, not a preselected vendor.

## Cross-report evidence map

| Claim/question | Primary evidence report(s) |
| --- | --- |
| What product/business/workflows exist? | 01, 02, 03 |
| Which documents are canonical/stale/broken? | 04 |
| Intended/repository/configured/deployed architecture | 05 |
| Hosting/provider/account/control/CRM suitability | 06 |
| Page routes, UX, responsive and accessibility | 07 |
| Every API route/operation, Worker and scheduled job | 08 |
| Every table/migration, tenancy, D1/R2 and recovery | 09 |
| Identity, authorization, threat/privacy/compliance | 10 |
| Every provider integration/readiness/recovery | 11 |
| Tests, CI, deployment, logs, resilience and DR | 12 |
| Deployed Database Console threat/design decision | 13 |
| Current/future AI navigation and evaluation | 14 |
| Documentation lifecycle/registry/retrieval | 15 |
| Provider/architecture alternatives | 16 |
| Explicit Sites decision and reversible migration | 17 |
| Stable findings, unknowns, contradictions and owner decisions | 18 |
| Dependency roadmap, staffing and gates | 19 |

## Material-claim evidence numerator and stopping rule

For a finite, reproducible denominator, a **material audit claim** is one unique stable `AUD-*` row in the authoritative cross-report Priority summary in `18_FINDINGS_RISKS_ASSUMPTIONS_AND_DECISIONS.md`. That register is where decision-changing claims from reports 01-17 are normalized: a proposition is material when it can change a release block, P0/P1/P2 priority, CRM suitability, Sites migration verdict, security/privacy/data decision or owner action. Repeated narrative restatements, deterministic inventory rows, external-source listings and roadmap recommendations are not counted again. This avoids inflating the denominator through duplicated prose while preserving every decision-changing finding.

Extraction is CMD-020: isolate the Priority summary, extract and deduplicate IDs matching `AUD-[A-Z]+-[0-9]{3}`, then require one matching Detailed findings section containing an `Exact evidence` field. The result is:

**23 material claims evidenced / 23 material claims extracted.**

The final extraction includes `AUD-API-001`: the complete consumer reconciliation identifies `/api/trade-referrals` GET/POST as the sole route module without a current tracked page/component/mobile/monitor/provider caller, its POST still requires active paid membership (`src/app/api/trade-referrals/route.ts:113-151`), and current product truth declares core trade access free (`src/app/direct-trade/membership/page.tsx:7-55`; `docs/RELEASE_TRUTH.md:36-38`). Unknown external/manual consumers are not ruled out; the finding is `STALE`, not a claim that no external caller exists.

For this numerator, “evidenced” means the claim has exact repository/runtime/primary-source evidence or exact evidence of a bounded `UNKNOWN`/`BLOCKED`/`PARTIAL` state. It does **not** turn an unknown provider capability into an absent capability, and it does not prove inaccessible production/account facts. The local material-claim gate passes only while all unique priority IDs have one detailed block and an exact-evidence field. Any new decision-changing claim must first be added to the Priority summary and detailed register, then CMD-020 must return equal non-zero numerator/denominator. The broader audit stopping rule still fails because the ten external evidence classes and one execution-provenance gap below remain open; therefore the overall verdict remains `AUDIT INCOMPLETE` despite 23/23 local claim disposition.

## Required searches and stopping-criterion ledger

| Criterion | Discovered / disposed | Result |
| --- | --- | --- |
| Tracked files | 675 / 675 | Complete deterministic disposition in `00` |
| Documents | 23 / 23 | Complete register in `04` |
| Internal Markdown links | 13 / 13 | Valid |
| Tracked-doc external URLs | 50 unique / 50 classified | 37 ordinary public reached; 13 non-public/non-GET/local/example classified |
| TODO-like search families | all requested families run / all hits classified | No genuine unresolved code TODO-family marker; two test skips and historical/placeholder classes recorded |
| Features/workflows | all route/component/doc-discovered grouped slices disposed | Matrix in `03`; live completeness remains separately limited |
| Web pages | 41 / 41 | `07` |
| API route files/operations | 94/94; 197/197 | `08` |
| Schema tables/migrations | 145/145; 79/79 | `09`; journal contradiction separately recorded |
| Integrations | 21 / 21 manifest/code/doc-discovered provider systems mapped | `11`; account/runtime status varies/unknown |
| Environments | 6 / 6 discovered environment classes mapped | ENV-01 to ENV-06 above; staging/DR remain `UNKNOWN`, native release `BLOCKED` |
| Subsystems | 36 / 36 distinct HST component IDs mapped | `06`; mapping includes absent/unknown/blocked controls and does not assert live health |
| Material claims | 23 evidenced / 23 extracted | CMD-020 and the material-claim rule above; external truth gaps remain |
| Tests | executed/pass/fail/skip/not-run all classified | `12` and command table above |
| External sources | accessible and blocked sources classified | primary-source index above |
| Contradictions/unknowns | retained, not silently resolved | `18` |

## Inaccessible evidence and exact continuation checkpoint

The audit is `AUDIT INCOMPLETE` for the full requested current-state stopping criteria despite complete local deterministic inventory. The uncovered scope is not an uncounted source-file remainder; it is the following ten externally bounded evidence classes plus one execution-provenance gap:

1. **Sites/D1/R2 ownership and recovery:** no independent owner account/IAM/billing proof, complete D1/R2 export, PITR access, off-platform backup, schema/migration ledger, restored copy or transfer/workspace-outage answer. Continue with read-only provider support/account evidence, then an explicitly authorised export and isolated restore.
2. **Production data state:** no privacy-safe full table/object counts, consistency/integrity/orphan/retention report or restored application. Continue only with approved aggregate/export methods; never print rows/secrets.
3. **Firebase:** no console/API evidence for project owner/billing, authorised domains, MFA, password/bot controls, token revocation or recovery. Continue with read-only project settings and disposable privileged-session revocation tests.
4. **Provider accounts:** no complete owner/billing/scope/quota/webhook/sandbox/production inventory for email, SMS, calendars, accounting, payments, Apps Script monitoring or analytics. Continue provider by provider with named owner and disposable records.
5. **Operational history:** no durable Worker log/metric/trace/SLO/capacity/alert history; transient queries were inconsistent. Continue by exporting a defined observation window to owner-accessible telemetry and performing alert/incident exercises.
6. **Authenticated journeys:** no audit-owned synthetic staging tenant completed every customer/trade/admin/provider workflow. Continue in an isolated staging environment with two tenants/roles and provider sandboxes; do not mutate production customer data.
7. **Recovery/resilience:** no backup restore, failover, historical-upgrade matrix, load/soak, retry-storm or platform-outage drill. Continue only after RM-020/RM-050 establish safe targets.
8. **Accessibility/mobile:** no complete browser/axe/keyboard/screen-reader matrix, physical iOS/Android release build or store/account proof. Continue with synthetic data and supported devices.
9. **Legal/industry facts:** legal entity/turnover/privacy coverage, actual services/jurisdictions, current assessor/installer licences/accreditation/insurance, contracts and claim substantiation were unavailable. Continue with named qualified reviewers and primary-register evidence.
10. **One credible external link defect:** the ReAmped public link remains unresolved; five other automated “broken” links are method-sensitive provider endpoints. Continue by updating/removing the ReAmped destination in a separately authorised documentation change and making the link checker method-aware.
11. **Execution provenance:** no complete raw PTY/tool transcript was retained across all coordinating and specialist tasks, and the numeric exit status of the failed connector-add attempt is unavailable. Continue by enabling immutable command/tool logging before the next audit and record exact invocation, environment, numeric process exit or `N/A` tool-call reason, timestamp and bounded result as each check runs.

Continuation must first re-run `git status --short --branch`, `git rev-parse HEAD`, upstream/deployment identity and Sites live version. Any new source/deployment change creates a new snapshot and invalidates assumptions about current truth.

## Evidence handling and audit boundary

- No secret value, cookie, bearer token, private key, provider credential, `.env` value, personal record or production row is reproduced in this audit.
- One Sites read-only tool response exposed a short-lived secret-like bypass value during the tool session; it was not copied into any document or response.
- No package was installed. The OpenAI documentation connector attempt failed and made no configuration change.
- No project source/configuration/schema/migration/provider/production data was changed by the audit.
- The external concurrent Database Console commit, push and v199 deployment were explicitly outside this audit workstream and contradicted the audit brief's no-deploy boundary; snapshot evidence was preserved rather than reverted.
- All future provider writes, export/restore, feature withdrawal, migration, deployment and cleanup require separately authorised work.
