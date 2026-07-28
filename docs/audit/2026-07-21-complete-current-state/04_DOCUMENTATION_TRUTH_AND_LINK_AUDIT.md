# Documentation truth and link audit

Audit date: 21 July 2026 (Australia/Sydney)<br>
Repository: `C:\Webproject\aea-energy-domain-migration`<br>
Branch and audited tracked baseline: `codex/sites-custom-domain-migration` at `ff3c8efe3d5e501286d8e83e28086d6d4590be27`<br>
Scope: all 23 tracked Markdown files plus both tracked environment examples, document-to-source and document-to-history truth, internal/rendered links, anchors, assets, application/API references, external links, unfinished markers, operational coverage and documentation governance.

## Outcome

Documentation is extensive but not yet release-safe as a single body of truth. At the final audit snapshot, `docs/RELEASE_TRUTH.md` accurately records the published product through Sites version 199 and the rolling handover records the owner Database Console as completed, validated and released. That correction happened in a separate documentation commit 14 minutes after the implementation commit, and the audit observed an intermediate state in which committed source, dirty release notes and canonical production truth disagreed. Several older briefs, strategies, audits and runbooks also remain written in present tense even though later source and release records supersede them.

The internal Markdown link graph is mechanically valid: all 13 relative Markdown-link occurrences resolve to existing files. It is nevertheless sparse: excluding the two `AGENTS.md` instruction files, 15 tracked Markdown files have no inbound Markdown link. The tracked documents contain 53 external URL occurrences and 50 unique destinations. A current safe-public GET pass reached all 37 public reference URLs, but two deep links now redirect to generic pages and therefore no longer prove the cited product detail. The repository's automated link audit exited non-zero with six reported failures; five are OAuth or provider mutation/token endpoints being tested with an unsuitable unauthenticated GET, while the ReAmped consumer link remains the one credible unresolved public-link defect.

No tracked source or pre-existing documentation was changed by this audit stream. Remediation below is proposed, not implemented. Concurrent implementation/release work changed tracked files while the audit was running; the snapshot ledger below preserves those state transitions.

## Scope, method and evidence limits

The inventory used `git ls-files '*.md'`; last-touch evidence used `git log -1 -- <file>`; cross-document truth used `rg`, `git grep`, `git show`, source/API inspection and the current branch history. The final branch and upstream both resolved to `ff3c8efe3d5e501286d8e83e28086d6d4590be27`. `git status --short --branch` then showed only the audit directory as untracked.

The audit observed four consecutive truth states:

| Snapshot | Git/worktree state | Canonical production state | Audit treatment |
| --- | --- | --- | --- |
| A | HEAD `543cc189`; Database Console source dirty/untracked | Sites v198 | Initial evidence only; not a releasable baseline. |
| B | HEAD/upstream `4a5cd19`; implementation clean and pushed | Canonical docs still Sites v198 | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` at that instant. |
| C | HEAD `4a5cd19`; release truth/handover dirty with v199 evidence | Dirty worktree claimed Sites v199 | Provisional release evidence, not committed canonical truth. |
| D | HEAD/upstream `ff3c8ef`; release documents committed | Sites v199, implementation `4a5cd19`, deployment `appgdep_6a5f78c0b3cc81919214c0deb5a3a8f3` | Final audit baseline and current repository truth. |

Tracked Markdown totals 23 files, 3,090 newline records and 336,366 bytes. The two required environment examples add 79 lines and 3,599 bytes. The largest status-bearing documents are `ROADMAP.md` (763 lines), `docs/HANDOVER_NEXT_TASK.md` (276 lines), `docs/RELEASE_TRUTH.md` (134 lines) and `PLATFORM_ARCHITECTURE.md` (526 lines). Generated Drizzle metadata, lockfiles, fixture payloads, legacy comparator HTML and binary assets were excluded from prose inventory but their controlling documentation was included; the legacy rendered HTML was separately link/asset-checked below.

This stream did not sign in to production, inspect provider dashboards or mutate D1/R2. A historical release statement is treated as repository evidence of a past observation, not as a new runtime check. External-link results are point-in-time HTTP observations and do not prove content accuracy, contractual validity or provider readiness.

## Authoritative document hierarchy found in the repository

The intended hierarchy is explicit:

1. `docs/RELEASE_TRUTH.md` owns current implementation and release state (`docs/RELEASE_TRUTH.md:3-7`; `README.md:5`).
2. `docs/HANDOVER_NEXT_TASK.md` owns the executable current milestone (`docs/AI_DELIVERY_GUARDRAILS.md:21`; `docs/RELEASE_TRUTH.md:7`).
3. `ROADMAP.md` owns approved sequence and future scope (`README.md:5`; `ROADMAP.md:10-12`).
4. `README.md` is the entry point; active runbooks own operational procedures.
5. Dated audits, architecture papers and strategy briefs are historical evidence unless explicitly promoted.

The hierarchy is sound in concept. The control failure is lifecycle: superseded documents are not consistently marked historical, status metadata is rare, and the audit demonstrated that implementation and canonical release-state commits can temporarily diverge without a machine-enforced state label.

## Complete tracked-document inventory

`Lines` is the count of newline records. `Last` is the last touching commit as resolved at the audit baseline.

| Document | Lines | Last | Intended role | Status and evidence | Recommended disposition |
| --- | ---: | --- | --- | --- | --- |
| `AGENTS.md` | 36 | `b73c1ba` | Repository working instructions | `PARTIAL`: active and consistent with current validation/release discipline; ownership/review cadence is not recorded | Keep; treat as controlled instruction, not product documentation. |
| `CLAUDE.md` | 1 | `aac728c` | Tool-specific alias to `AGENTS.md` | `PARTIAL`: valid one-line alias, but unexplained to other tools | Keep only while a consuming tool needs it; add no competing instructions. |
| `DIRECT_TRADE_DASHBOARD_PROMPT.md` | 110 | `3130902` | Original Direct Trade implementation brief | `CONTRADICTED`: lines 7-52 and 79-93 prescribe paid subscriptions/referral credits while Phase 6 and current entitlements make verified core access free | Move to dated history or add a prominent superseded header and current replacement link. |
| `NATIVE_ELECTRICITY_PARITY_AUDIT.md` | 58 | `b73c1ba` | Electricity cutover acceptance record | `PARTIAL`: dated evidence says the cutover gate passed, but it is not a current production-health record | Retain under audits/history with tested commit, test-fixture provenance and production-release pointer. |
| `OPERATIONS_RUNBOOK.md` | 123 | `c5ce008` | Live operations and alert-response procedure | `CONTRADICTED`: line 123 claims an older Netlify implementation remains although tracked configuration and canonical docs say Netlify is removed/inactive | Repair immediately; add owner, last exercised date, system identity and escalation/restore pointers. |
| `PLATFORM_ARCHITECTURE.md` | 526 | `0dc159e` | Original target architecture | `DEPRECATED`: correctly labels itself historical; much of the body describes pre-D1/pre-TLink entities and subscriptions | Move under history/architecture and retain the canonical warning at the top. Create a shorter current architecture document. |
| `README.md` | 112 | `0dc159e` | Repository/product entry point | `PARTIAL`: broadly current and routes release truth, roadmap and operations; lacks links to mobile, integrations and data-governance documentation | Keep concise; add a role-based documentation index rather than more embedded status. |
| `ROADMAP.md` | 763 | `338a9cd` | Delivery sequence plus historical implementation narrative | `CONTRADICTED`: wrong checkout, repaired capabilities still called blockers, mobile contract v2 and historical paid-state prose conflict with later truth | Split completed history from current roadmap; repair current-state section and path. |
| `docs/AI_DELIVERY_GUARDRAILS.md` | 71 | `573e26b` | Mandatory delivery governance | `PARTIAL`: active and internally consistent; correctly names release truth and handover ownership, but owner/review cadence is absent | Keep; add owner/review cadence. |
| `docs/COMPETITIVE_PRODUCT_STRATEGY.md` | 295 | `eb8995f` | Competitor and product strategy snapshot | `CONTRADICTED`: dated research defines free/paid tiers superseded by the free verified-core decision | Mark historical and extract only current, revalidated strategic decisions into a living product-principles document. |
| `docs/EXTERNAL_AUDIT_REMEDIATION.md` | 36 | `c29c93b` | Remediation register for 16 July audit | `STALE`: line 28 records a 163-link run while the current command checks 177 and release state is later | Update finding states and evidence or close/freeze as a dated audit response. |
| `docs/HANDOVER_NEXT_TASK.md` | 276 | `ff3c8ef` | Rolling current milestone plus release history | `PARTIAL`: Database Console state is reconciled and recoverable owner export leads the next-five, but no fully contracted next milestone exists | Reduce to one selected current contract and current next-five. Move completed results to an append-only release log. |
| `docs/MOBILE_FIELD_SYNC.md` | 78 | `08c9ddc` | Canonical mobile security/sync contract | `PARTIAL`: current contract says version 3; compatibility/deprecation ownership is absent | Keep as canonical; add compatibility/deprecation table and named owner. |
| `docs/PLATFORM_SCALE_HARDENING_AUDIT.md` | 67 | `9a442ae` | Dated scale implementation audit | `STALE`: historical completion evidence still describes a future saved-view manager after views shipped in v198 | Freeze as historical or append a superseded-recommendation note. |
| `docs/RELEASE_TRUTH.md` | 134 | `ff3c8ef` | Canonical implementation/release record | `PARTIAL`: final snapshot accurately records v199 from `4a5cd19`, but mixes current summary with a large append-only release ledger | Preserve current evidence; separate current matrix from append-only release ledger and enforce source/release state transitions. |
| `docs/SERVICE_REMINDER_DELIVERY_RUNBOOK.md` | 55 | `dd57982` | Resend/Twilio operating procedure | `CONTRADICTED`: line 9 says email disabled while release truth records enabled Resend/provider acceptance | Correct channel state and add a dated readiness/exercise table. Keep SMS explicitly blocked. |
| `docs/SYNTHETIC_BENCHMARK.md` | 11 | `45937b6` | Opt-in benchmark runbook | `STALE`: operationally useful, but premium/membership terminology is historical | Keep technical facts; relabel synthetic feature grants without implying current paid access. |
| `docs/TRADE_INTEGRATIONS_RUNBOOK.md` | 94 | `b29e282` | Provider setup and acceptance procedure | `PARTIAL`: appropriately provider-specific, but readiness can drift outside Git and owners/last exercises are absent | Keep; add per-provider owner, environment, last exercised date and evidence pointer without secrets. |
| `docs/UI_UX_OPTIMISATION_AUDIT.md` | 72 | `9a442ae` | Dated CRM UX audit | `STALE`: says advanced workspaces live under More, while v196/current source expose them directly | Mark historical and link the replacing release. Do not update past observations as if they were current. |
| `docs/scale-ui-ux-audit-2026-07-16.md` | 106 | `671ec73` | Dated external scale/UX audit | `STALE`: some recommendations are now implemented and link-evidence details have aged | Freeze with disposition links to completed releases and unresolved findings. |
| `mobile/AGENTS.md` | 3 | `2c13205` | Mobile-specific working instruction | `PARTIAL`: active and exact Expo documentation URL is reachable; conflict/review governance is implicit | Keep; ensure it never conflicts with repository instructions. |
| `mobile/README.md` | 50 | `2c13205` | Native app setup and feature summary | `STALE`: line 9 says sync contract v2 while canonical contract/implementation say v3 | Update before any mobile build/distribution activity. |
| `src/data/POSTCODE_DATA_NOTICE.md` | 13 | `74812c7` | Dataset provenance/licence notice | `PARTIAL`: useful provenance, but no freshness owner or update cadence | Keep beside data; add source revision, checksum/date, licence and refresh process. |

### Required environment-example inventory

Only key names and documentation shape were inspected; no environment value is reproduced.

| Document | Lines / bytes | Last | Intended role | Status and evidence | Recommended disposition |
|---|---:|---|---|---|---|
| `.env.example` | 67 / 2,932 | `b29e282` | Root web/Worker and provider configuration contract | `PARTIAL`: documents Firebase public configuration and address, billing, messaging, encryption, accounting, payment and calendar key families; it is not a production-key inventory and does not prove validity, ownership or completeness | Generate/validate an environment-key manifest from typed configuration use; classify required/optional, secret/public, environment, owner and rotation without example secrets. |
| `mobile/.env.example` | 12 / 667 | `dae4e5d` | Expo API/Firebase/OAuth public configuration contract | `PARTIAL`: documents API base, Firebase public client fields and Google client IDs; native production files, credentials, store accounts and runtime values remain `UNKNOWN`/`BLOCKED` | Validate against the mobile config loader and EAS profiles; add owner/environment requirements and keep private credentials out of public-prefixed values. |

## Truth-conflict and transition register

| Conflict | Repository evidence | Current defensible truth | Risk |
| --- | --- | --- | --- |
| Release/source transition was temporarily non-atomic | Snapshot B had clean/pushed implementation `4a5cd19` with canonical production still v198; snapshot C had uncommitted v199 notes; snapshot D committed the record as `ff3c8ef` | Current `docs/RELEASE_TRUTH.md:3,124` records 21 July, Sites v199, implementation `4a5cd19` and deployment `appgdep_6a5f78c0b3cc81919214c0deb5a3a8f3` | During the gap, consumers could mistake HEAD for production or ignore a real deployment. The final snapshot resolves the specific mismatch, not the process weakness. |
| Handover is still a release ledger rather than one next-task contract | `docs/HANDOVER_NEXT_TASK.md:7-19` is now a completed milestone; lines 21-267 retain earlier completed work; lines 270-276 provide priorities but not the full contract for one selected next milestone | Current state is reconciled and recoverable owner export is the recorded first priority | Autonomous work still has to infer scope/acceptance from a priority sentence, while the file name and guardrails promise one executable next milestone. |
| Paid-access briefs conflict with product and code | `DIRECT_TRADE_DASHBOARD_PROMPT.md:7-52`; `docs/COMPETITIVE_PRODUCT_STRATEGY.md:100-165,258-260`; historical roadmap lines 116-146 versus `ROADMAP.md:177-195`, `docs/RELEASE_TRUTH.md:36-38` and `src/lib/direct-trade-entitlements.ts:120-143` | Verified core trade tools are A$0; only historical subscriber management remains | Customer/commercial copy or implementation can reintroduce a deprecated paywall. |
| Roadmap current blockers are stale | `ROADMAP.md:208-217` says the strongest CRM is paid-only, quote corrections are missing and accounting is limited; later release truth records free core, correction ledger and QuickBooks/provider handoff | Those named blockers are no longer current, though complete provider/accounting parity remains partial | Prioritisation and audit conclusions become wrong. |
| Roadmap checkout path is wrong | `ROADMAP.md:5` says `C:\Webproject\aea-energy`; audited active checkout is `C:\Webproject\aea-energy-domain-migration` | This audit and release lineage use the domain-migration checkout | An agent can edit or release the wrong repository. |
| Mobile protocol version conflicts | `ROADMAP.md:168` and `mobile/README.md:9` say v2; `docs/MOBILE_FIELD_SYNC.md:16-24,67-78` says v3 | Canonical current transport is v3 | A native client built from the README can negotiate or persist the wrong contract. |
| Comparator route rename is stale in active-looking documents | Git records the sole rename `src/app/compare/route.ts` -> `src/app/compare/electricity-legacy/route.ts`; `AGENTS.md:9` and `PLATFORM_ARCHITECTURE.md:31` still name the removed path | Native `/compare` is current and the renamed legacy route is compatibility-only | Agents can inspect or edit a nonexistent implementation path and mistake historical architecture for current source. |
| Resend state conflicts | `docs/SERVICE_REMINDER_DELIVERY_RUNBOOK.md:9` says email disabled; `docs/RELEASE_TRUTH.md:113` records it enabled and a send accepted | Last repository evidence says Resend email enabled; current provider state was not rechecked | Operators can suppress needed delivery or make an unsafe readiness assumption. |
| Netlify implementation claim is unsupported | `OPERATIONS_RUNBOOK.md:123` says an older scheduled implementation remains; `README.md:112`, `ROADMAP.md:22` and `docs/RELEASE_TRUTH.md:23` say Netlify is not a target; tracked-file searches find no Netlify implementation | Sites/GitHub are the active release path; no tracked Netlify monitor implementation was found | Incident response may look at an inexistent scheduler. |
| Saved-view recommendation is stale | `docs/PLATFORM_SCALE_HARDENING_AUDIT.md:52` calls saved views future; `docs/RELEASE_TRUTH.md:123` records owner-scoped saved views in Sites v198 | Owner-scoped Jobs/Customers views exist; team-shared/locked views do not | Duplicate implementation or incorrect gap reporting. |
| CRM navigation audit is stale | `docs/UI_UX_OPTIMISATION_AUDIT.md:7,41` says advanced tools are under More; current source and Sites v196 expose former More destinations | Primary navigation exposes those workspaces | UX reviews can test the wrong interaction model. |
| Historical audit link count is stale | `docs/EXTERNAL_AUDIT_REMEDIATION.md:28` says 163 destinations; current `npm.cmd run audit:links` reports 177 | The link set and result change with source; ReAmped remains unresolved | Audit closure can be claimed from obsolete evidence. |

## Link audit

### Executed link, anchor, asset and route-reference coverage

A final static continuation check ran on 22 July 2026 after the interrupted session resumed. It did not render a browser or claim dynamic runtime behavior; it resolved literal contracts against the tracked tree.

| Surface | Executed scope and count | Result | Status / evidence limit |
|---|---|---|---|
| Markdown relative links | All 23 tracked Markdown files; 13 relative link occurrences | 13/13 file targets exist with matching path/case | `PARTIAL`: path-valid; rendered semantics and discoverability are separate |
| Markdown anchors | Same corpus | Zero fragment links, so there was no Markdown heading-anchor target to validate | `NOT APPLICABLE` for the current corpus |
| Markdown images and inline HTML assets | Same corpus | Zero Markdown image references and zero inline `<a>/<img>/<source>/<video>` `href`/`src` attributes | `NOT APPLICABLE` for the current corpus; absence is a measured zero, not an inference |
| Markdown issue/PR references | All 23 tracked Markdown files; exact `#number` and GitHub `/issues/number` or `/pull/number` forms | Zero recognized issue or pull-request references | `NOT APPLICABLE`: measured zero; no target was available to validate |
| Static web navigation | 136 tracked web route modules (41 pages, 94 API routes, one compatibility route); 105 literal navigation occurrences / 76 unique file-path pairs in web pages/components | Every literal non-asset navigation path resolves to a tracked page/route pattern | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; dynamic and conditional links require browser journeys |
| Static application assets | All 13 tracked `public/` files; references extracted from JSX/TS `src`/`href`, metadata image/icon/apple fields, CSS `url()`, HTML `src`/`href`, and server `readFile()` construction | Seven files have a tracked consumer and resolve; six files have no tracked text consumer | `PARTIAL`: referenced assets resolve, but six apparent scaffold/legacy orphans require owner disposition; response/cache correctness not proved |
| Static API references | Web/mobile client surfaces excluding API handler source; 240 literal occurrences / 113 unique file-route pairs | Every exact reference or dynamic-route prefix resolves to one of the 94 API route modules | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; literal resolution is not response-contract or authorization proof |
| JSX fragment links | Eight occurrences / six unique file-fragment pairs | Two unique `#membership` pairs have no tracked static `id="membership"`; the global `#site-content` target exists only when `SiteHeader` renders | `BROKEN`: membership anchors and major route-family skip links need runtime-safe targets |
| Rendered legacy comparator HTML | `public/electricity-comparator.html`: 18 literal anchor occurrences / 17 unique; six relative-route occurrences covering five routes; 11 unique fixed external destinations; three separately composed dynamic external templates; two asset tags | Five relative routes resolve; the relative `electricity-model.js` asset exists; no fragment link exists. Fixed-destination outcomes are 6 direct, 1 redirected, 3 automated-access blocked and 1 network-unverified | `PARTIAL`; the mutually exclusive fixed and dynamic registers below avoid counting a dynamic prefix as a twelfth static URL. `scripts/audit-links.mjs` scans `src/`, not `public/` |

The two membership defects are at `src/components/SupplierCatalogueWorkspace.tsx:855,1028` and `src/components/TradeHandoverCentre.tsx:264`; the tracked tree contains `membership-access-title` at `src/app/direct-trade/membership/page.tsx:47`, not the referenced `membership` ID. The conditional skip-link defect is independently traced at `src/app/layout.tsx:38` and `src/components/ComparatorChrome.tsx:35`. The static API check treats literal `/api/job-information/` and `/api/quote-review/` prefixes as references to their `[token]` route modules rather than false missing routes.

### Complete tracked public-asset reconciliation

The reproducible extraction used `git ls-files 'public/**'` for the asset population and `git grep -n -E 'src=|href=|url\(|images?:|icons?:|apple:|readFile\(' -- 'src/**' 'public/*.html'` for all implemented reference syntaxes. Each normalized local reference was compared with the tracked `public/` paths using exact path and case. This produced 13 assets, seven consumed and resolving, and six with no tracked text consumer.

| Tracked public asset | Consumer evidence | Disposition |
|---|---|---|
| `public/aea-energy-platform-hero.jpg` | CSS `url()` at `src/app/globals.css:1145` | Referenced and resolves |
| `public/aea-home-energy-plan-og.png` | Metadata images at `src/app/layout.tsx:17,23` | Referenced and resolves |
| `public/downloads/aea-business-data-import-templates.xlsx` | Download link at `src/components/TradeDataImportWorkspace.tsx:202` | Referenced and resolves |
| `public/electricity-comparator.html` | Server file load at `src/app/compare/electricity-legacy/route.ts:7` | Referenced and resolves |
| `public/electricity-model.js` | HTML script source at `public/electricity-comparator.html:575` | Referenced and resolves |
| `public/tlink-icon-192.png` | Manifest, metadata and UI at `src/app/manifest.ts:13`, `src/app/layout.tsx:27-28`, `src/components/AdminOperationsPortal.tsx:138` and `src/components/TLinkChrome.tsx:8` | Referenced and resolves |
| `public/tlink-icon-512.png` | Manifest at `src/app/manifest.ts:14` | Referenced and resolves |
| `public/file.svg` | No match in the all-syntax tracked-text extraction | Apparent orphan; remove only after owner confirms no external direct consumer |
| `public/globe.svg` | No match in the all-syntax tracked-text extraction | Apparent orphan; remove only after owner confirms no external direct consumer |
| `public/next.svg` | No match in the all-syntax tracked-text extraction | Apparent orphan; remove only after owner confirms no external direct consumer |
| `public/tlink-mark.png` | No match in the all-syntax tracked-text extraction | Apparent orphan; remove only after owner confirms no external direct consumer |
| `public/vercel.svg` | No match in the all-syntax tracked-text extraction | Apparent orphan; remove only after owner confirms no external direct consumer |
| `public/window.svg` | No match in the all-syntax tracked-text extraction | Apparent orphan; remove only after owner confirms no external direct consumer |

### Rendered legacy HTML external-link register

This is a separate **11-unique-fixed-destination** register. The extraction starts from literal HTML anchors at lines 349-370 and 529, then resolves the ten repeated distributor data constants at lines 610-622 to the same destination set without double counting. An ordinary GET was used only for fixed public pages; HTTP 403 from distributor forms is classified as automation/private blocked, not broken. The four result classes below are mutually exclusive and total 11: six valid direct, one valid redirected, three automated-access blocked and one network-unverified.

| External literal | Observed result on 22 July 2026 | Classification |
|---|---|---|
| `https://energyeasy.com.au/` | HTTP 200, direct | Valid direct; external dependency |
| `https://electricityoutlook.jemena.com.au/` | Fetch failed | Network-unverified; external dependency |
| `https://www.ausnetservices.com.au/electricity/your-electricity-meter/meter-data` | HTTP 200, direct | Valid direct; external dependency |
| `https://www.ausgrid.com.au/your-energy-use/your-meter-and-supply/access-your-meter-data` | HTTP 200, direct | Valid direct; external dependency |
| `https://www.endeavourenergy.com.au/for-your-home/energy-use-and-bills/your-meter` | HTTP 200, direct | Valid direct; external dependency |
| `https://www.essentialenergy.com.au/web-forms/retail-customer-single-nmi-request` | HTTP 403 | Automation/private blocked; external dependency |
| `https://www.evoenergy.com.au/Your-Energy/Electricity-Meters/Request-meter-data` | HTTP 200, direct | Valid direct; external dependency |
| `https://www.energex.com.au/our-services/metering/accessing-your-metering-data` | HTTP 403 | Automation/private blocked; external dependency |
| `https://www.ergon.com.au/network/our-services/metering/accessing-your-metering-data` | HTTP 403 | Automation/private blocked; external dependency |
| `https://customer.portal.sapowernetworks.com.au/meterdata/` | HTTP 200, direct | Valid direct; external dependency |
| `https://www.ausenergyassessments.com` | HTTP 200 after redirect to `https://ausenergyassessments.com/` | Redirected valid; first-party external dependency |

The following contracts are deliberately outside that fixed-URL denominator:

| Dynamic or non-operational URI | Construction | Classification |
|---|---|---|
| Retailer fallback at `public/electricity-comparator.html:666` | Concatenates `https://www.` with an allowlisted retailer-site value | Dynamic external-dependency template; static destination set depends on runtime input and was not claimed verified |
| Distributor website at `public/electricity-comparator.html:1499` | Concatenates `https://www.` with `info.site` | Dynamic external-dependency template; not a complete static URL |
| Google search fallback at `public/electricity-comparator.html:2297` | Builds a query URL from the plan brand | Dynamic external-dependency template; search result semantics and runtime brand are unverified |
| SVG namespace at `public/electricity-comparator.html:1052` | Literal `http://www.w3.org/2000/svg` inside generated SVG markup | Namespace identifier, not an outbound operational link; excluded |

### Internal documentation links

A relative Markdown parser over all 23 tracked documents found 13 occurrences and 13 present targets. No missing file target was found. Inbound counts are concentrated: release truth has four, handover three, roadmap two, AI guardrails two, operations one and external remediation one. All other files have zero inbound links. Excluding `AGENTS.md` and `mobile/AGENTS.md`, 15 tracked Markdown files have no inbound Markdown link, including the product prompt, competitive strategy, mobile contract/README, active provider runbooks and postcode notice.

This is an information-architecture defect even though the paths are valid. A valid but undiscoverable runbook is operationally equivalent to missing documentation during an incident.

### External URLs in Markdown

The tracked documents contain 53 URL occurrences and 50 unique URLs:

- 37 ordinary public reference pages;
- 10 first-party production callback/probe URLs that should be validated by route/method contract rather than a browser GET;
- two reserved `.example` placeholders;
- one localhost development URL.

A concurrent GET pass over the 37 ordinary public URLs returned 37 responses below HTTP 400. Three redirected. The ASIC move retained the intended article. Two redirects are semantically suspect despite HTTP 200:

- Simpro's service-jobs deep link now ends at `https://helpguide.simprogroup.com/articles/`.
- Monday's mobile-features deep link now ends at the generic `https://monday.com/crm/features` page.

Those links are reachable but no longer strong evidence for the precise cited claims. Replace them with current authoritative feature pages or soften the claims.

#### Exact non-overlapping 50-URL reconciliation

Transport classes below are mutually exclusive and total 50. All 37 ordinary public references also have the role `external evidence/dependency`; their `CURRENT`, `STALE` or historical meaning is inherited from the source-document inventory above rather than guessed from HTTP status. There were zero broken and zero network-unverified URLs in this Markdown corpus. The separate rendered-HTML corpus above has its own blocked and network-unverified outcomes.

**Valid direct (34):**

- `https://boompower.com.au/about/privacy-policy/`
- `https://boompower.com.au/about/terms-of-use/`
- `https://boompower.com.au/complaints`
- `https://boompower.com.au/partner/government`
- `https://boompower.com.au/partner/installers`
- `https://boompower.com.au/platform`
- `https://compare.energy.vic.gov.au/assets/languages/english/how-to-compare-offers-on-victoria-energy-compare.html`
- `https://docs.expo.dev/versions/v57.0.0/`
- `https://github.com/joelkoen/postcodes-au`
- `https://help.fergus.com/en/articles/10518804-job-phases-explained`
- `https://help.fergus.com/en/articles/15439294-what-is-the-fergus-mcp-server`
- `https://help.fergus.com/en/articles/2039991-reconciling-supplier-documents`
- `https://help.fergus.com/en/articles/3491998-the-job-card`
- `https://help.servicetitan.com/docs/complete-the-work-in-the-field`
- `https://help.servicetitan.com/docs/estimate-workflows-in-servicetitan-and-servicetitan-mobile`
- `https://help.servicetitan.com/docs/field-pro`
- `https://help.tradifyhq.com/hc/en-us/articles/360016443414-Create-a-Quote`
- `https://help.tradifyhq.com/hc/en-us/articles/360016571573-Accept-a-Quote`
- `https://monday.com/crm/features/`
- `https://support.servicem8.com/help-center/tips-trick-more/more/how-to-download-a-backup-of-your-servicem8-data`
- `https://support.servicem8.com/help-center/tips-trick-more/more/who-owns-my-servicem8-account-and-its-data`
- `https://support.servicem8.com/questions/mobile/does-servicem8-have-a-native-mobile-app-ios-android`
- `https://www.accc.gov.au/about-us/publications/a-guide-to-comparator-websites-for-website-operators-and-suppliers`
- `https://www.accc.gov.au/system/files/Updated%20Guidelines%20on%20Concerted%20Practices.pdf`
- `https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information`
- `https://www.oaic.gov.au/privacy/notifiable-data-breaches/quick-reference-guide-for-responding-to-data-breaches`
- `https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/privacy-impact-assessments/guide-to-undertaking-privacy-impact-assessments`
- `https://www.servicem8.com/au/`
- `https://www.servicem8.com/au/features-online-booking`
- `https://www.servicem8.com/au/features-security`
- `https://www.servicem8.com/au/pricing`
- `https://www.servicem8.com/au/terms-of-service`
- `https://www.simprogroup.com/lightning`
- `https://www.tradifyhq.com/features`

**Redirected valid (3):**

- `https://asic.gov.au/for-finance-professionals/credit-licensees/do-you-need-a-credit-licence/` redirected to the equivalent `www.asic.gov.au` article; valid external evidence.
- `https://helpguide.simprogroup.com/Content/Service-and-Enterprise/Service-Jobs.htm` redirected to `https://helpguide.simprogroup.com/articles/`; reachable but semantically degraded external evidence.
- `https://monday.com/crm/mobile/features` redirected to `https://monday.com/crm/features`; reachable but semantically degraded external evidence.

**Private or method-bound first-party runtime contracts (10):**

- `https://compare.ausenergyassessments.com/api/internal/lead-webhook-probe`
- `https://compare.ausenergyassessments.com/api/service-reminder-provider-events/resend`
- `https://compare.ausenergyassessments.com/api/service-reminder-provider-events/twilio`
- `https://compare.ausenergyassessments.com/api/square/webhook`
- `https://compare.ausenergyassessments.com/api/stripe/webhook`
- `https://compare.ausenergyassessments.com/api/trade-integrations/callback/myob`
- `https://compare.ausenergyassessments.com/api/trade-integrations/callback/quickbooks`
- `https://compare.ausenergyassessments.com/api/trade-integrations/callback/square`
- `https://compare.ausenergyassessments.com/api/trade-integrations/callback/stripe`
- `https://compare.ausenergyassessments.com/api/trade-integrations/callback/xero`

These ten are not validly tested by anonymous GET. They require their documented HTTP method, authentication or signature, and sandbox/authorized contract; static extraction proves only that the literal is documented.

**Reserved configuration examples (2):**

- `https://your-private-lead-processor.example/endpoint`
- `https://your-private-operations-alert.example/endpoint`

These are reserved `.example` placeholders, not deployment claims or reachable dependencies.

**Local development (1):**

- `http://localhost:3000`

This is a local-development origin, not an external or production dependency.

### Automated source-link command

`npm.cmd run audit:links` exited `1` on the audit baseline with:

- 177 checks;
- 171 passed or reachable;
- 16 classified as blocked by automation but not broken;
- six classified as broken.

The six reported failures were:

| URL class | Current result | Audit interpretation |
| --- | --- | --- |
| Stripe OAuth deauthorise | Fetch failure | Method-sensitive authenticated operation; an anonymous GET is not a valid acceptance probe. |
| Stripe OAuth token | Fetch failure | Method-sensitive token exchange; test configuration shape and use provider sandbox contract tests. |
| Square production and sandbox token endpoints | HTTP 404 for each | Token endpoints are POST contracts; GET 404 is not evidence that the configured endpoint is invalid. |
| Google OAuth token | HTTP 404 | Token endpoint is a POST contract; GET is unsuitable. |
| ReAmped retailer home page | Fetch failure | Credible consumer-link defect; retire or replace after product confirmation. |

The command's structural defect is visible at `scripts/audit-links.mjs:31-43,49-60`: it extracts every literal HTTPS URL from source, sends all of them GET, and treats 404/5xx as broken without method or authentication metadata. It also scans `src/`, not tracked documentation. The existing remediation register already acknowledges the OAuth-method issue at `docs/EXTERNAL_AUDIT_REMEDIATION.md:28`, but the script has not incorporated that distinction.

Required correction is a typed link manifest with `kind`, method, expected status family, authentication requirement and semantic redirect policy. Public pages can use GET/HEAD. OAuth authorize URLs can validate origin/path. Token, webhook, disconnect and callback endpoints need schema/config or sandbox contract checks, not anonymous GET. Documentation URLs must be part of the tracked-file scan.

## TODO, placeholder and unfinished-marker audit

Tracked-file scans found:

- zero `TODO`, `FIXME`, `HACK` or `XXX` markers outside excluded payload-heavy artifacts;
- zero unchecked Markdown task boxes;
- one literal `not implemented`, at `ROADMAP.md:217`, describing AI-assisted operations rather than a code stub;
- two fixture-dependent test skips: `test/electricity-model.test.js:205` and `test/nem12-typed-parity.test.mjs:92`;
- no HTTP 501 handler or `NotImplemented` implementation path.

The word `placeholder` appears on 196 tracked lines after excluding the lockfile and legacy comparator payload. Classification prevents a false unfinished-work finding:

- 159 are UI `placeholder=` attributes;
- 31 are prepared-SQL placeholder generation/binding lines;
- two are explicit README prose about modelling or omitted optional values;
- six are CSS selectors/pseudo-elements or a typed component prop.

None is a placeholder implementation. Five historical production migrations are intentionally no-op compatibility migrations, while synthetic populations live in five opt-in fixture SQL files; this is documented at `docs/EXTERNAL_AUDIT_REMEDIATION.md:9-10` and enforced by tests.

That migration separation does **not** make the generator itself safe. `docs/SYNTHETIC_BENCHMARK.md:9-11` says credential output must stay outside the repository and explicit output paths must be supplied, but `scripts/seed-synthetic-population.mjs:8-14,300-321` accepts a no-argument run, defaults the password output under the repository and defaults SQL output to a tracked fixture. More seriously, the default provider path uses the same Firebase client project configured by the application and attempts 350 identity mutations (`scripts/seed-synthetic-population.mjs:57-85,107-138`). The code does not enforce an emulator/test project, dry run, confirmation or environment allowlist. Documentation-to-control status: `BROKEN`; actual provider acceptance and prior execution are `UNKNOWN`.

## Documentation coverage gaps

No dedicated tracked document was found for the following control areas. Some concepts appear as paragraphs or tests, but there is no canonical owned procedure or specification.

| Missing or inadequate class | Why it matters now | Minimum acceptance content | Release significance |
| --- | --- | --- | --- |
| Current architecture and data-flow map | The only architecture file explicitly predates D1, R2, Sites, marketplace, CRM and mobile sync | System boundaries, trust zones, data classes, authoritative stores, queues/providers, tenancy and failure modes tied to current source | Required before broad system-of-record/security claims. |
| Backup, export, restore and disaster recovery | Strategy promises durable ownership, but no restore evidence or owner-controlled export runbook exists | D1/R2 ownership, backup schedule, encryption, retention, complete export, restore steps, RPO/RTO and measured restore exercise | P0 release gate for sole-system-of-record or durability claims. |
| Security threat model and incident/data-breach runbook | Privacy-sensitive household, trade and credential data spans Firebase, D1, R2 and providers | Assets, actors, abuse cases, access review, key rotation, breach triage, OAIC/NDB decision path and evidence preservation | P0 before expanding the released database mutation registry. |
| Privacy/data inventory and retention/deletion schedule | Privacy rules are dispersed across code/tests/product prose | Field/data classification, purpose, legal basis/consent, store, recipients, retention, deletion, export and protected-job boundary | P0 for customer-data assurance. |
| API and webhook contract | 94 route handlers and numerous provider callbacks have no OpenAPI/typed human-readable index | Route, method, auth/role, ownership, payload, error, idempotency, rate, version, callback signature and data classification | P1; P0 for public/provider API claims. |
| Deployment, rollback and environment runbook | Release evidence exists, but no single current Sites lifecycle/rollback procedure is tracked | Exact source/commit provenance, package/version/deploy sequence, bindings, smoke checks, rollback, access policy and failure recovery | P0 for repeatable releases. |
| Accessibility acceptance standard | Tests and audits mention accessibility, but there is no owned WCAG target/test matrix | Target standard, keyboard/focus/screen-reader/contrast/reflow criteria, supported platforms and regression procedure | P1 before broad accessibility claims. |
| Support/onboarding and role operations | Product spans household, installer, technician, wholesaler and administrators | Account recovery, role setup, verification, common failures, escalation and data-access boundaries | P1 for safe rollout beyond current operators. |
| Schema/domain dictionary and migration policy | 79 migrations and many ledgers are authoritative but discoverability depends on source inspection | Entity ownership, key relations, immutability, protected fields, migration/no-op/fixture policy and restoration impact | P1; P0 for Database Console policy review. |
| Change log/decision records/contribution ownership | 237 commits, no tags, one recorded author identity and no CODEOWNERS/ADR/RFC/CHANGELOG | Release ledger, decision template, ownership/reviewer map and contribution/review policy | P1 governance risk; not by itself a current runtime blocker. |
| Licence notice | No tracked `LICENSE*` file was found | Repository/software licence plus third-party/data attribution rules | Owner/legal decision required before external distribution. |

## Git and documentation evolution

At the baseline the repository has 237 commits, 141 commits touching Markdown, one recorded Git author identity and no tags. The documentation history shows rapid delivery followed by increasingly large status ledgers:

- `aac728c` (13 July) introduced the repository and tool alias.
- `b73c1ba` (17 July) updated working instructions and the NEM12 parity record.
- `0dc159e` (16 July) established canonical release routing and marked architecture historical.
- `573e26b` (16 July) established the rolling-handover discipline.
- `338a9cd` (19 July) last changed the roadmap even though many Sites releases followed.
- `f05995b` and `543cc18` (21 July) implemented and documented Sites v198.
- `4a5cd19` (21 July, 23:45 +10:00) committed the owner Database Console and added an in-progress contract to the handover.
- `ff3c8ef` (21 July, 23:59 +10:00) reconciled the handover and release truth with Sites v199, validation and signed-in production QA.

This is not evidence that Git history is incorrect. It demonstrates that document lifecycle is coupled to individual feature commits without a release-state invariant. A release or current-milestone commit should fail validation if canonical status metadata, current commit/deployment identity and handover state disagree.

### Complete Git history, ownership and maintainability disposition

| Required dimension | Executed evidence | Result and status | Consequence / gate |
|---|---|---|---|
| Relevant log and blame | `git log -12 --date=iso-strict`; `git blame -L 1,25 -- docs/RELEASE_TRUTH.md`; same for `docs/HANDOVER_NEXT_TASK.md` | Recent history alternates implementation and release-document commits. Blame ties the canonical records to initial truth/guardrail commits plus current implementation/reconciliation commits; one author identity owns all 237 HEAD commits | `PARTIAL`: traceable commits, but single-author/bus-factor and non-atomic release-record risk remain |
| Renames | `git log HEAD --find-renames --diff-filter=R --name-status --format=` | Exactly one rename: `src/app/compare/route.ts` -> `src/app/compare/electricity-legacy/route.ts`; two active-looking documents still cite the removed path | `STALE` documentation; correct canonical references and retain history only in explicitly historical material |
| Deletions | `git log HEAD --diff-filter=D --name-status --format=` | Exactly seven deleted paths: `netlify.toml`, `netlify/functions/api-health-monitor.mts`, `src/app/api/admin/synthetic-identity-batch/route.ts`, `src/app/api/trade-property-map/route.ts`, `src/components/TradePropertyView.tsx`, `src/components/FastNavigation.tsx`, `public/aea-energy-platform-hero.png` | Current references are negative regression assertions in tests, not live consumers; no resurrection is justified |
| Tags and releases | `git tag --list`; release-record inspection | Zero Git tags. Sites release identities exist in `docs/RELEASE_TRUTH.md`, but Git has no immutable tag/release layer | `UNKNOWN` long-term release governance; current exact commit + immutable artifact/deployment provenance remains the usable evidence |
| Branches and worktrees | `git branch -a --no-color`; `git worktree list --porcelain` | Two worktrees; local branches `agent/secure-verification-evidence`, `codex/native-electricity-cutover`, current `codex/sites-custom-domain-migration`, `main`; matching remotes plus `sites/main` | `PARTIAL`; active audit checkout is explicit, but branch protection/retirement ownership is unknown |
| Merged work | `git rev-list HEAD --merges`; merge-parent inspection; coordinating read-only GitHub metadata query | One merge commit in HEAD history; remote metadata showed PR #1 merged and PR #2 open at observation, but complete review/approval and branch-protection evidence was not obtained | `PARTIAL`; commit ancestry and bounded PR state are inspectable, while complete governance remains unproved |
| Issue and PR history | Tracked Markdown issue/PR-reference scan plus coordinating read-only `gh pr list`, `gh issue list` and `gh release list` evidence | Tracked-document reference denominator is exactly 0/0 and therefore `NOT APPLICABLE`; separate remote metadata showed PR #1 merged, PR #2 open, an empty issue list and no GitHub Releases at observation | `PARTIAL`; do not infer that no historical issues/reviews existed or that the observed lists prove governance completeness |
| Code ownership | Filename search plus Git history | No `CODEOWNERS`, contribution policy or service ownership map; one Git author identity | `UNKNOWN` accountable ownership; assign reviewers and subsystem owners |
| Operational ownership | Runbook/report inspection | One operational mailbox is named, but on-call, provider, security, data, recovery and release owners are not comprehensively assigned | `PARTIAL`; business-critical operation is blocked on an owner/escalation map |
| Complexity hotspots and giant modules | Complete line count over 457 tracked `.ts`, `.tsx`, `.js`, `.mjs`, `.sql` and `.gs` source/test files | Six files exceed 1,000 lines: `CustomerDashboard.tsx` 3,361; `db/schema.ts` 2,712; `trade-crm/route.ts` 1,404; `SupplierCatalogueWorkspace.tsx` 1,363; `DirectTradeDashboard.tsx` 1,241; `AdminOperationsPortal.tsx` 1,215. Seventeen files exceed 500 lines | `PARTIAL`; prioritise measured change-risk seams, not a repository-wide refactor |
| Duplicated implementations | Static/manual inspection and report 05 dependency ledger; no clone detector was executed | Web/mobile intentionally duplicate some identity/transport dependencies; legacy/native comparator and retained/hidden purchasing surfaces have distinct compatibility/product roles. Exact semantic clone extent is `UNKNOWN` | Do not claim duplicate-free; measure before consolidation and preserve genuine platform boundaries |
| Circular dependencies | Report 05 architecture-risk table | No cycle analyser or enforced import boundaries; passing type/build does not prove acyclicity | `UNKNOWN`; run a retained dependency-cycle check before package extraction |
| Global mutable state | Report 05 architecture-risk table and bounded source scan | Intentional module-scoped lead limiter plus platform cache observed; no complete dynamic-state proof | `PARTIAL`; durable state must remain in owner-scoped stores |
| Unsafe generic command surface | Reports 05 and 13 | Broad owner Database Console is deployed despite bounded mutation controls | `VERIFIED DEPLOYED` risk; withdraw generic route/navigation and use named domain repairs only |
| Undocumented institutional knowledge | Release and handover blame, provider/runbook review | Exact Sites management actions, provider-account control, production recovery and several release conventions rely on workspace history/operator knowledge rather than reproducible repository commands | `PARTIAL`; convert the material operational knowledge into owned runbooks/IaC/CI |
| Abandoned experiments referenced by active code | Tracked search for prototype/experiment/legacy/deprecated terms plus deletion-reference reconciliation | No deleted implementation is positively referenced by current source; negative regression tests intentionally name five deleted surfaces. `mobile/app.json:72-75` enables Expo `typedRoutes` and `reactCompiler` experiments, which are active configuration, not proven abandoned work | `PARTIAL`: current experimental flags need compatibility ownership; no broad “no abandoned experiment” claim is made |
| Stale documentation after rename/removal | Exact old-path search and truth-conflict register | `AGENTS.md:9` and historical `PLATFORM_ARCHITECTURE.md:31` still name the pre-rename comparator path; runbook Netlify history and other stale states are already classified above | `STALE`; fix current instructions and label historical documents without rewriting history |

## Structured findings

### DOC-001: Release documentation transition was non-atomic

- Category: release/documentation truth
- Severity/Priority: High/P0
- Status: `PARTIAL`
- Confidence: High
- Evidence: snapshots B and C described above; implementation commit `4a5cd19` at 23:45; reconciliation commit `ff3c8ef` at 23:59; current truth at `docs/RELEASE_TRUTH.md:3,124`.
- Current/intended behavior: the specific discrepancy is resolved at Snapshot D: the final snapshot correctly separates implementation `4a5cd19` from Sites v199 and gives exact deployment/validation evidence. Prevention remains missing because the transition depended on a later manual documentation commit.
- Impact/root cause: during the 14-minute gap, readers could equate HEAD with production or miss a real deployment. No repository invariant labels the intermediate states.
- Remediation/acceptance: record current source separately from last deployed version; require commit, branch, Sites version/deployment, validation and live-observation fields. Validation must reject a `Last verified` date older than the newest release record.
- Validation/release blocking: compare `git rev-parse HEAD`, remote SHA and declared source/deployment identities in CI; allow explicit `implemented-not-released` and `deployed-pending-record` states. The specific v199 record is resolved; prevention is a gate for the next release.
- Owner confirmation: release owner and Sites resource owner.

### DOC-002: The rolling handover lacks one fully contracted next task

- Category: delivery control
- Severity/Priority: High/P1
- Status: `PARTIAL`
- Confidence: High
- Evidence: `docs/HANDOVER_NEXT_TASK.md:7-19` now records the Database Console as completed/released; lines 21-267 retain completed releases; lines 270-276 give a priority list whose first item is recoverable owner export.
- Current/intended behavior: current release state and priorities are no longer contradictory, but the file does not provide the promised full objective/scope/acceptance/stop contract for exactly one selected next milestone.
- Impact/root cause: another agent must infer the next contract from one priority sentence. Completed results accumulated in the same file instead of moving to a release ledger.
- Remediation/acceptance: keep one current milestone contract of bounded length; on commit/release, change status atomically and append result to a separate release log. Exactly one next milestone and one next-five sequence may remain.
- Validation/release blocking: a handover lint should require exactly one selected next contract or the explicit state `awaiting product selection`, and reject multiple current-state markers. Does not block current v199 operation; blocks autonomous next-milestone execution.
- Owner confirmation: product owner and coordinating implementation agent.

### DOC-003: Superseded subscription strategy remains actionable-looking

- Category: commercial/product truth
- Severity/Priority: High/P0
- Status: `CONTRADICTED`
- Confidence: High
- Evidence: `DIRECT_TRADE_DASHBOARD_PROMPT.md:7-52,79-93`; `docs/COMPETITIVE_PRODUCT_STRATEGY.md:100-165,258-260`; current truth at `ROADMAP.md:177-195` and `docs/RELEASE_TRUTH.md:36-38`.
- Current/intended behavior: verified core trade access is A$0; legacy subscriber management remains transitional.
- Impact/root cause: stale briefs can regenerate checkout, paid entitlements, referral credits or false market claims.
- Remediation/acceptance: add an unmistakable superseded banner and replacement link or move files under dated history. No current doc may prescribe paid gating for core tools.
- Validation/release blocking: grep-based commercial-language review plus source entitlement tests. Blocks public pricing/access changes.
- Owner confirmation: product/commercial owner.

### DOC-004: Mobile contract version is contradictory

- Category: API/mobile compatibility
- Severity/Priority: High/P0
- Status: `BROKEN`
- Confidence: High
- Evidence: `mobile/README.md:9`; `ROADMAP.md:168`; `docs/MOBILE_FIELD_SYNC.md:16-24,67-78`.
- Current/intended behavior: the canonical mobile transport is version 3.
- Impact/root cause: build/release work can target an obsolete protocol. Summary documents were not updated with the contract.
- Remediation/acceptance: update summaries to v3; document minimum/supported versions and server rejection behavior; add a test that the README version equals the server/client constant.
- Validation/release blocking: contract-version consistency test and physical-device sync acceptance. Blocks mobile distribution.
- Owner confirmation: mobile and sync API owners.

### DOC-005: Active runbooks contain stale operational state

- Category: operations
- Severity/Priority: High/P0
- Status: `CONTRADICTED`
- Confidence: High for repository conflict; medium for current external state
- Evidence: `OPERATIONS_RUNBOOK.md:123`; `docs/SERVICE_REMINDER_DELIVERY_RUNBOOK.md:9`; counter-evidence at `README.md:112`, `ROADMAP.md:22`, `docs/RELEASE_TRUTH.md:23,113`.
- Current/intended behavior: Sites/GitHub are active; Resend was enabled by the latest recorded observation; SMS remains blocked.
- Impact/root cause: operators can inspect the wrong scheduler or apply the wrong channel action. Runbooks combine procedure with mutable point-in-time state.
- Remediation/acceptance: separate stable procedure from a dated readiness table; assign owner and last-exercised date; remove unsupported Netlify claim after verifying the current monitor trigger.
- Validation/release blocking: exercise health, lead probe and non-customer test alert; inspect provider/channel state; confirm zero production mutation. Blocks operations-state claims and channel changes.
- Owner confirmation: operations owner, Google Workspace owner and Resend/Twilio account owner.

### DOC-006: Roadmap mixes obsolete current blockers with history and future scope

- Category: product planning
- Severity/Priority: High/P1
- Status: `PARTIAL`
- Confidence: High
- Evidence: `ROADMAP.md:5,116-146,168,177-217,735-751`; release records `docs/RELEASE_TRUTH.md:103,113,119,123`.
- Current/intended behavior: roadmap should distinguish completed history, current gaps and approved future outcomes.
- Impact/root cause: 763 lines of accreted narrative obscure the real next product decision and contain a wrong checkout path.
- Remediation/acceptance: create a small current roadmap with explicit `implemented`, `deployed`, `blocked`, `planned` states; move chronology to a release log; correct checkout routing.
- Validation/release blocking: automated path existence and cross-reference checks; product-owner approval of current priorities. Blocks reliance on roadmap as an executable queue, not current v199 operation.
- Owner confirmation: product owner.

### DOC-007: Link automation conflates web pages with provider contracts

- Category: validation tooling
- Severity/Priority: Medium/P1
- Status: `BROKEN`
- Confidence: High
- Evidence: `scripts/audit-links.mjs:31-43,49-60`; current command output: 177 checked, six broken; `docs/EXTERNAL_AUDIT_REMEDIATION.md:28`.
- Current/intended behavior: public links need reachability/semantic checks; OAuth and webhook endpoints need method-aware contract validation.
- Impact/root cause: releases fail on expected GET behavior while documentation URLs and semantic redirects can go unchecked.
- Remediation/acceptance: typed manifest, method/expected-status metadata, documentation scan and redirect policy; retain ReAmped as a genuine unresolved product decision.
- Validation/release blocking: command exits zero only when each typed check meets its own contract. Blocks claims that link validation currently passes; ReAmped blocks a consumer retailer link claim.
- Owner confirmation: validation owner and product owner for retailer replacement.

### DOC-008: Documentation has no ownership or freshness system

- Category: governance/discoverability
- Severity/Priority: High/P1
- Status: `PARTIAL`
- Confidence: High
- Evidence: zero tracked files with `Owner:` or `Maintainer:` metadata; only release truth has `Last verified:`; 15 non-AGENTS documents have zero inbound links.
- Current/intended behavior: current documents should be discoverable and have accountable freshness; historical documents should be unmistakable.
- Impact/root cause: stale operational and commercial state persists because no owner or review trigger exists.
- Remediation/acceptance: add minimal metadata (`status`, `owner`, `last reviewed`, `canonical replacement`, `review trigger`) to current documents and a generated docs index. Historical audit records may be immutable but must state disposition.
- Validation/release blocking: docs lint for required metadata and orphan report. P1 governance gate; P0 for active runbooks and canonical status files.
- Owner confirmation: repository maintainer and domain owners.

### DOC-009: Recovery, privacy/security and deployment controls lack canonical runbooks

- Category: operational/data protection
- Severity/Priority: Critical/P0
- Status: `UNKNOWN`
- Confidence: High for file absence; runtime capability unknown
- Evidence: `git ls-files` filename searches found no dedicated backup, restore, disaster recovery, retention, security, privacy, accessibility, API or deployment Markdown document; strategy expects export/retention at `docs/COMPETITIVE_PRODUCT_STRATEGY.md:40,65-67,96`.
- Current/intended behavior: a business system of record should have owned, exercised recovery and data-governance procedures.
- Impact/root cause: loss, breach or provider unavailability cannot be handled from a reviewed repository procedure; Database Console deletion has no documented restore path.
- Remediation/acceptance: create the minimum canonical documents in the coverage table and run a complete isolated D1/R2 restore exercise with reconciliation and measured RPO/RTO.
- Validation/release blocking: restore drill, access/key review and incident tabletop. Blocks sole-system-of-record, durable-backup and complete-security claims; blocks widening the released direct-database mutation policy.
- Owner confirmation: business/data owner, security/privacy owner and Sites/Cloudflare resource owner.

### DOC-010: Historical audits are not consistently frozen or superseded

- Category: documentation lifecycle
- Severity/Priority: Medium/P1
- Status: `PARTIAL`
- Confidence: High
- Evidence: stale saved-view statement at `docs/PLATFORM_SCALE_HARDENING_AUDIT.md:52`; stale More-menu statement at `docs/UI_UX_OPTIMISATION_AUDIT.md:7,41`; architecture alone has a clear historical warning at `PLATFORM_ARCHITECTURE.md:3-6`.
- Current/intended behavior: dated audits should preserve what was observed at the time and point to dispositions, not masquerade as live product truth.
- Impact/root cause: audit evidence and current instructions are intermixed.
- Remediation/acceptance: standard historical header with audit date, audited SHA, superseded-by links and finding disposition. Do not rewrite original evidence except for clearly marked errata.
- Validation/release blocking: docs lint and review. Not a runtime blocker; blocks using these files as current acceptance criteria.
- Owner confirmation: audit owner/repository maintainer.

### DOC-011: Repository-level decision and contribution governance is absent

- Category: maintainability/legal
- Severity/Priority: Medium/P2
- Status: `PARTIAL`
- Confidence: High
- Evidence: no tracked `CHANGELOG`, `CONTRIBUTING`, `CODEOWNERS`, `ADR`, `RFC` or `LICENSE` file; no tags; one recorded Git author identity across 237 commits.
- Current/intended behavior: significant architecture, commercial and data decisions should be attributable and reviewable without mining prose and commit history.
- Impact/root cause: bus factor, review ownership, legal distribution and reversal rationale are unclear.
- Remediation/acceptance: adopt a small decision-record template, ownership map, release ledger and explicit licence decision. Avoid process bloat; require records only for real cross-boundary decisions.
- Validation/release blocking: owner/legal review. Licence blocks external source distribution; remaining items are governance improvements rather than current runtime blockers.
- Owner confirmation: repository/business owner and legal adviser where needed.

### DOC-012: Two external evidence links are reachable but semantically degraded

- Category: source quality
- Severity/Priority: Low/P2
- Status: `PARTIAL`
- Confidence: High for redirect, medium for claim impact
- Evidence: current GET pass redirected Simpro service jobs to `/articles/` and Monday mobile features to the generic CRM features page.
- Current/intended behavior: competitor assertions should link to the page that directly supports the claim.
- Impact/root cause: HTTP-only validation returns false confidence after vendor information architecture changes.
- Remediation/acceptance: replace with direct current authoritative sources or qualify/remove unsupported details; store access date in dated research.
- Validation/release blocking: semantic review by product owner. Not a product release blocker.
- Owner confirmation: product research owner.

## Validation performed and results

| Check | Result |
| --- | --- |
| `git status --short --branch`, `git rev-parse HEAD`, `git rev-parse '@{u}'` | Branch/upstream both `ff3c8ef`; only audit output untracked. |
| `git ls-files '*.md'` plus line/byte/last-touch inventory | 23 tracked Markdown files; complete inventory above. |
| Relative Markdown target resolver | 13/13 occurrences present; no missing file target. |
| Markdown issue/PR reference classifier | 0/0 recognized `#number`, GitHub issue or GitHub pull references; `NOT APPLICABLE` target validation for the measured corpus. |
| Tracked Markdown URL extraction | 53 occurrences, 50 unique: 37 public, 10 first-party callback/probe, two `.example`, one localhost. |
| Concurrent GET over 37 ordinary public documentation URLs | 37 below HTTP 400; three redirects; two semantically degraded deep links. |
| Tracked `public/**` asset/reference reconciliation | 13/13 assets disposed: seven referenced/resolving and six apparent no-text-consumer orphans. |
| Static navigation/API reference reconciliation | 105 literal navigation occurrences resolve; 240 literal client API occurrences resolve to the 94 route modules. Report 07 separately expands 83 client API bases and all 151 fetch expressions. |
| Legacy comparator fixed external destinations | 11/11 classified on 22 July 2026: six direct 200, one one-hop redirected 200, three automated-access 403, one DNS/network-unverified. Three dynamic URL templates and one SVG namespace are separately excluded from the fixed denominator. |
| `npm.cmd run audit:links` | Exit 1; 177 checked, 171 non-broken including 16 automation-blocked, six reported broken. Five reported failures are method-sensitive provider endpoints; ReAmped remains unresolved. |
| `git grep` unfinished-marker classification | Zero TODO/FIXME/HACK/XXX; zero unchecked tasks; one roadmap `not implemented`; two fixture-dependent test skips; no code stub. |
| Dedicated-document filename search | No canonical backup/restore/DR, retention, security, privacy, accessibility, API, deployment, onboarding/support, changelog, contribution, ownership, ADR/RFC or licence document. |

## Conclusion

The repository has enough written evidence to reconstruct product intent and release history, but not yet a controlled documentation system. The immediate truth repairs are bounded: make future implementation/release transitions explicit and atomic, mark subscription-era documents superseded, align mobile on contract v3, correct Resend/Netlify runbook state, and make link validation method-aware. The most consequential missing evidence is owner-controlled recovery and data-governance documentation; until a restore is actually exercised, durable system-of-record claims and recovery from production database mutation remain unproven.
