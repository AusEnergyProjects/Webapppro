# Frontend, UX and accessibility audit

Audit date: 2026-07-21 (Australia/Sydney)<br>
Repository: `C:\Webproject\aea-energy-domain-migration`<br>
Final repository snapshot: branch `codex/sites-custom-domain-migration`, commit `ff3c8efe3d5e501286d8e83e28086d6d4590be27`<br>
Application implementation snapshot: `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`<br>
Audit mode: static source review and existing automated checks only; no production mutation, signed-in browser action, package installation or deployment

## Result

The repository contains a substantial, connected web product and a bounded mobile field application. The current source has 41 App Router pages, one web root layout, two mobile layouts, 86 tracked React component files, 43 source files containing a form or submit handler, and 55 web components that call `fetch`. The public AEA information and comparison surfaces, household account, TLink trade workspace, token-scoped customer flows, and restricted operations portal are all represented in active source.

The current web implementation is `VERIFIED DEPLOYED`: a concurrent external task published application SHA `4a5cd19` as Sites version 199, deployment `appgdep_6a5f78c0b3cc81919214c0deb5a3a8f3`, then committed that exact release record in documentation-only child `ff3c8ef` (`docs/RELEASE_TRUTH.md:124`). Signed-in QA specifically covered the owner Database workspace at desktop and 390 px. Exact-SHA artifact deployment does not mean every route and user journey below was individually traversed.

The strongest user-experience concern found is an accessibility defect in the global skip link: the root layout always targets `#site-content`, but that target is emitted only by `SiteHeader`. TLink pages using `TLinkHeader`, token flows, the print page, the electricity preview and the operations portal can expose a skip link with no destination (`src/app/layout.tsx:38`, `src/components/ComparatorChrome.tsx:35`, `src/components/TLinkChrome.tsx:13-25`). Three membership-access links also target a missing `#membership` fragment. Dialog focus management is inconsistent. These findings prevent a WCAG-conformance or complete-navigation claim.

## Status summary

| Area | Status | Evidence-backed conclusion |
|---|---|---|
| Public AEA information and guides | `VERIFIED DEPLOYED` artifact; runtime journeys `UNKNOWN` | Active pages are part of Sites v199; this audit did not traverse them live. |
| Electricity and gas comparison | `VERIFIED DEPLOYED` artifact; runtime journeys `UNKNOWN` | Native electricity and gas comparator components are routed; the preview route is deliberately non-indexed. |
| Household account | `VERIFIED DEPLOYED` artifact; runtime journeys `UNKNOWN` | Account, projects, quotes, appointments, assets and profile routes all resolve to `CustomerDashboard`; no v199 household journey was run. |
| TLink trade workspace | `VERIFIED DEPLOYED` artifact; runtime journeys `PARTIAL` | Dashboard and workspaces are deployed; earlier release QA covered major flows, while v199 QA focused on the owner console. |
| Restricted operations portal | `VERIFIED DEPLOYED` | `/operations/control-centre` and the owner Database workspace were reached in signed-in v199 QA; authorization is reviewed separately. |
| Mobile field application | `PARTIAL` | Sign-in, job work, sync and settings screens exist and type-check. Store release and real-device accessibility remain unverified. |
| Route-level loading/error/not-found UX | `PARTIAL` | Components implement many local states, but no tracked `loading.*`, `error.*` or `not-found.*` App Router files were found. |
| Keyboard and screen-reader support | `PARTIAL` | Good semantic patterns coexist with a broken skip target and incomplete modal focus handling. |
| Responsive production behaviour | `PARTIAL` | V199 console QA covered desktop and 390 px without document overflow; the complete route set and real devices were not rechecked. |
| Dead buttons, broken links and unreachable UI | `BROKEN` for two unique membership fragment pairs; remaining runtime scope `UNKNOWN` | Static validation proves the missing fragment IDs; no live crawl or complete browser traversal proves the rest. |
| Browser end-to-end coverage | `PARTIAL` | Many source/contract tests exist, but no Playwright, Cypress, Webdriver or axe dependency/suite was found. |

## Complete web route inventory

The inventory below is reconciled to the 41 tracked `src/app/**/page.tsx` files. `VERIFIED DEPLOYED` means the route implementation is included in exact application SHA `4a5cd19`, recorded as Sites v199. It does not mean this audit individually visited the route or completed its journey.

### Public AEA and planning surfaces

| Route | Purpose and primary implementation | Status |
|---|---|---|
| `/` | Entry and product orientation via `GettingStarted` (`src/app/page.tsx:1-4`). | `VERIFIED DEPLOYED` |
| `/assessments` | NatHERS/BASIX assessment pathways (`src/app/assessments/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/case-studies` | Worked comparison and assessment examples (`src/app/case-studies/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/plan` | Server-created home-energy roadmap with `HomeEnergyPlanner` (`src/app/plan/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/plan/print` | Lightweight printable roadmap (`src/app/plan/print/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/platform` | Product/role explanation for households, trades and administration (`src/app/platform/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/privacy` | AEA/TLink privacy notice (`src/app/privacy/page.tsx:12-44`). | `VERIFIED DEPLOYED` |
| `/rebates` | Location-aware rebates hub via `RebatesHub` (`src/app/rebates/page.tsx:1-10`). | `VERIFIED DEPLOYED` |
| `/getting-started` | Server redirect to `/plan` (`src/app/getting-started/page.tsx:1-5`). | `VERIFIED DEPLOYED` |

### Comparators

| Route | Purpose and primary implementation | Status |
|---|---|---|
| `/compare` | Public native electricity plan comparison (`src/app/compare/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/compare/electricity-next` | Explicitly non-indexed native comparator preview (`src/app/compare/electricity-next/page.tsx:1-12`; `src/app/robots.ts:7-12`). | `VERIFIED DEPLOYED` |
| `/gas-compare` | Public gas comparison via `GasComparator` (`src/app/gas-compare/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/compare/gas` | Compatibility redirect to `/gas-compare` (`src/app/compare/gas/page.tsx:1-5`). | `VERIFIED DEPLOYED` |

### Guides

| Route | Purpose | Status |
|---|---|---|
| `/guides` | Guide directory and guided starting points (`src/app/guides/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/guides/batteries` | Battery sizing, use and warranty guidance. | `VERIFIED DEPLOYED` |
| `/guides/certificate-prices` | Certificate education and price tracker via `CertificatePriceTracker`. | `VERIFIED DEPLOYED` |
| `/guides/cooking` | Electric cooking conversion guidance. | `VERIFIED DEPLOYED` |
| `/guides/ev-charging` | Home and strata EV charging guidance. | `VERIFIED DEPLOYED` |
| `/guides/heating` | Heating and cooling planning guidance. | `VERIFIED DEPLOYED` |
| `/guides/hot-water` | Hot-water system planning guidance. | `VERIFIED DEPLOYED` |
| `/guides/insulation-draught-proofing` | Insulation, moisture and draught evidence guidance. | `VERIFIED DEPLOYED` |
| `/guides/solar` | Solar quote and installation-scope guidance. | `VERIFIED DEPLOYED` |

### Household account surfaces

All seven routes below render the large `CustomerDashboard` with a selected initial view. They are non-indexed where metadata is declared. The dynamic project route passes the requested project ID into the same dashboard (`src/app/account/projects/[id]/page.tsx:1-14`).

| Route | View | Status |
|---|---|---|
| `/account` | Account overview and projects | `VERIFIED DEPLOYED` |
| `/account/appointments` | Appointments | `VERIFIED DEPLOYED` |
| `/account/assets` | Home asset passport | `VERIFIED DEPLOYED` |
| `/account/profile` | Household profile/privacy | `VERIFIED DEPLOYED` |
| `/account/projects/[id]` | Saved project, optionally edit-selected | `VERIFIED DEPLOYED` |
| `/account/projects/new` | New project seeded from query parameters | `VERIFIED DEPLOYED` |
| `/account/quotes` | Customer trade quotes | `VERIFIED DEPLOYED` |

### TLink public, account and staff surfaces

| Route | Audience and purpose | Status |
|---|---|---|
| `/direct-trade` | Household project brief and protected trade-matching entry. | `VERIFIED DEPLOYED` |
| `/direct-trade/partners` | Installer/supplier account creation and service-area setup. | `VERIFIED DEPLOYED` |
| `/direct-trade/membership` | Free TLink access and feature explanation. | `VERIFIED DEPLOYED` |
| `/direct-trade/membership/terms` | Membership and marketplace terms. | `VERIFIED DEPLOYED` |
| `/direct-trade/standards` | Verification, matching and privacy standards. | `VERIFIED DEPLOYED` |
| `/direct-trade/integrations` | Google/Outlook calendar, accounting and payment integration explanation/configuration entry. | `VERIFIED DEPLOYED` |
| `/direct-trade/dashboard` | Main installer/supplier operating workspace through `DirectTradeDashboard`. | `VERIFIED DEPLOYED` |
| `/direct-trade/dashboard/verification` | Role-specific evidence and verification centre. | `VERIFIED DEPLOYED` |
| `/direct-trade/team` | Assigned-work portal for team members through `TradeTeamPortal`. | `VERIFIED DEPLOYED` |

### Token-scoped and operations surfaces

| Route | Boundary and purpose | Status |
|---|---|---|
| `/job-information/[token]` | Private customer photo/evidence upload from an opaque job request token; non-indexed and `no-referrer` metadata (`src/app/job-information/[token]/page.tsx:1-12`). | `VERIFIED DEPLOYED` |
| `/quote-review/[token]` | Customer quote review and question flow from an opaque quote token (`src/app/quote-review/[token]/page.tsx:1-7`). | `VERIFIED DEPLOYED` |
| `/operations/control-centre` | Restricted operations/admin/owner portal through `AdminOperationsPortal`; non-indexed (`src/app/operations/control-centre/page.tsx:1-12`). | `VERIFIED DEPLOYED` and reached in v199 QA |

## Layouts, navigation and information architecture

### Web layout

There is one tracked web layout, `src/app/layout.tsx`. It establishes English document language, global fonts, CSS, a global date picker and a global skip link (`src/app/layout.tsx:1-38`). There are no route-group layouts, so all web surfaces inherit that same skip link and global chrome assumptions.

The public AEA navigation is centralized in `SiteHeader`/`SiteNav` (`src/components/ComparatorChrome.tsx:21-35`). The separate TLink header exposes product-specific navigation (`src/components/TLinkChrome.tsx:13-25`). This is a reasonable product-boundary split, but it creates the skip-target inconsistency described below.

The sitemap lists 25 public routes (`src/app/sitemap.ts:4-38`). Robots policy excludes `/api/`, `/operations/`, `/plan/print` and the electricity preview (`src/app/robots.ts:7-12`). Account, token and operations pages additionally carry non-index/noarchive metadata where reviewed. The sitemap has a hard-coded `lastModified` date, so its freshness depends on a manual edit rather than Git history or content dates (`src/app/sitemap.ts:31-38`).

This frontend workstream did not traverse navigation in a browser. The separate documentation/link audit ran the repository URL checker and found method/automation classification limitations plus one unresolved ReAmped destination (`04_DOCUMENTATION_TRUTH_AND_LINK_AUDIT.md:117-134,357`). That command checks literal URLs rather than rendered internal navigation, so absence of dead in-app links remains `UNKNOWN` even though the two compatibility redirects are explicit in source.

### Mobile layouts

The Expo Router application has `mobile/src/app/_layout.tsx` and `mobile/src/app/(tabs)/_layout.tsx`. Its routed screens are sign-in, Work, Sync, Settings and job detail. Role selection in the tabs layout redirects users to the appropriate first screen (`mobile/src/app/(tabs)/_layout.tsx:7-24`). This is `PARTIAL`: mobile TypeScript passed, but store release, device behaviour and accessibility were not exercised.

## Forms, dashboards, search and client API contracts

- The source scan found 43 TSX files containing `<form` or `onSubmit`, spanning account registration, planning, trade acquisition, CRM, quoting, scheduling, invoicing, purchasing, integrations and admin operations. This count describes implementation surface, not successful form journeys.
- `CustomerDashboard`, `DirectTradeDashboard`, `TradeTeamPortal` and `AdminOperationsPortal` are the primary customer, business, field-staff and operations shells. They compose many role-specific workspaces rather than exposing each workspace as a separate URL.
- Product-local search is extensive: account/admin directories, jobs, invoices, supplier products, database tables and the TLink command centre expose scoped search controls. The command centre changes its placeholder and targets by partner type (`src/components/TLinkCommandCentre.tsx:177-198`). No public site-wide content search route was found; that is a product choice, not automatically a defect.
- The scan found 55 web component files with direct `fetch` calls. Twenty-two admin API bases share an authenticated `fetch(path)` helper in `AdminOperationsPortal`, while five admin bases and large surfaces such as `CustomerDashboard` construct authenticated requests in their own components (`src/components/AdminOperationsPortal.tsx:193-196`; `src/components/CustomerDashboard.tsx:392-396,2663-2682`). This is `PARTIAL`: it works as an explicit contract, but duplicated request/error handling increases drift risk and makes consistent timeout, cancellation and retry behaviour harder to prove.
- The mobile application has a central `apiRequest` that refreshes the Firebase ID token, attaches device/platform/version headers, parses structured errors and throws `ApiError` (`mobile/src/lib/api.ts:18-42`). This is a clearer transport boundary than the web components currently have.
- Client-side role visibility must not be treated as authorization. The portal conditionally exposes tools by role, including the owner-only database tab, but server route guards remain the authoritative boundary. Those guards are assessed in `10_AUTH_SECURITY_PRIVACY_AND_COMPLIANCE.md`.

### Reconciled form and submit-handler ledger

This is the complete result of the deterministic `src/**/*.tsx` scan for `<form` or `onSubmit`. It contains 43 unique files. Marker lines identify the matched source, not proof that a submit completed at runtime. Import/render references were then checked so an implementation file was not mistaken for a reachable surface. All 43 have a tracked consumer; none is a source orphan.

| # | Form or submit-handler file and marker line(s) | Known consumer | Disposition |
|---:|---|---|---|
| 1 | `src/components/AdminAccountDirectory.tsx:319,366` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:21,832,848`) | Connected |
| 2 | `src/components/AdminAccountWorkspace.tsx:187,204` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:31,1040`) | Connected |
| 3 | `src/components/AdminAssetGovernance.tsx:67,68` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:24,865`) | Connected |
| 4 | `src/components/AdminAssetSafety.tsx:67` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:23,864`) | Connected |
| 5 | `src/components/AdminDatabaseWorkspace.tsx:285,310` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:35,1106`) | Connected |
| 6 | `src/components/AdminFormTemplates.tsx:51` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:25,866`) | Connected |
| 7 | `src/components/AdminNotificationInbox.tsx:325` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:17-20,824`) | Connected |
| 8 | `src/components/AdminOperationsPortal.tsx:549,627,1131,1133` | `/operations/control-centre` (`src/app/operations/control-centre/page.tsx:2,11`) | Connected route shell |
| 9 | `src/components/AdminOpportunityWorkspace.tsx:272,285` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:29,1045`) | Connected |
| 10 | `src/components/AdminProductEnquiryWorkspace.tsx:76` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:32,1053`) | Connected |
| 11 | `src/components/AdminServiceFollowUpReporting.tsx:82` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:28,971`) | Connected |
| 12 | `src/components/AdminUsabilityPilot.tsx:110,115,118,119` | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:26,867`) | Connected |
| 13 | `src/components/CustomerAppointmentRescheduling.tsx:60` | `CustomerDashboard` (`src/components/CustomerDashboard.tsx:26,3236`) | Connected |
| 14 | `src/components/CustomerAssetOwnershipCentre.tsx:93,101` | `CustomerDashboard` (`src/components/CustomerDashboard.tsx:24,3232`) | Connected |
| 15 | `src/components/CustomerDashboard.tsx:435,615,622,794,3217` | Seven `/account` routes (`src/app/account/page.tsx:2,11`; `src/app/account/projects/[id]/page.tsx:2,16`) | Connected route shell |
| 16 | `src/components/DirectTradeDashboard.tsx:1099` | `/direct-trade/dashboard` (`src/app/direct-trade/dashboard/page.tsx:2,11`) | Connected route shell |
| 17 | `src/components/DirectTradePartnerForm.tsx:294,306` | `/direct-trade/partners` (`src/app/direct-trade/partners/page.tsx:2,10`) | Connected |
| 18 | `src/components/DirectTradeVerificationCentre.tsx:185` | `/direct-trade/dashboard/verification` (`src/app/direct-trade/dashboard/verification/page.tsx:2,11`) | Connected |
| 19 | `src/components/electricity/NativeElectricityComparator.tsx:633,780` | `/compare` and `/compare/electricity-next` (`src/app/compare/page.tsx:2,13`; `src/app/compare/electricity-next/page.tsx:2,14`) | Connected |
| 20 | `src/components/FirebaseAccountPanel.tsx:103` | `CustomerDashboard` (`src/components/CustomerDashboard.tsx:22,3036`) | Connected |
| 21 | `src/components/GasComparator.tsx:134` | `/gas-compare` (`src/app/gas-compare/page.tsx:1,17`) | Connected |
| 22 | `src/components/HomeEnergyPlanner.tsx:32` | `/plan` (`src/app/plan/page.tsx:2,26`) | Connected |
| 23 | `src/components/InstallerCrmWorkspace.tsx:759,798,839,876,877,897,900,901,903,904,943,944,945` | `TradeBusinessHub` (`src/components/TradeBusinessHub.tsx:6,136`) | Connected |
| 24 | `src/components/InstallerPlatformQuote.tsx:118` | `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:21,920`) | Connected |
| 25 | `src/components/InstallerProductMarketplace.tsx:717` | `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:20,1247`) | Connected |
| 26 | `src/components/SupplierCatalogueWorkspace.tsx:1080,1083` | `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:19,602`) | Connected |
| 27 | `src/components/SupplierLocationManager.tsx:14` | `SupplierCatalogueWorkspace` (`src/components/SupplierCatalogueWorkspace.tsx:8,873`) | Connected |
| 28 | `src/components/TradeAssetLifecycle.tsx:110,113` | `TradeHandoverCentre` (`src/components/TradeHandoverCentre.tsx:9,305`) | Connected |
| 29 | `src/components/TradeAssetWorkspace.tsx:73` | `InstallerCrmWorkspace` (`src/components/InstallerCrmWorkspace.tsx:22,852,947`) | Connected |
| 30 | `src/components/TradeBusinessHub.tsx:316,428,436` | `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:8,595,641`) | Connected |
| 31 | `src/components/TradeEnquiryInbox.tsx:102,109` | `InstallerCrmWorkspace` (`src/components/InstallerCrmWorkspace.tsx:21,755`) | Connected |
| 32 | `src/components/TradeFieldWorkPanel.tsx:234,244,253` | `InstallerCrmWorkspace` and `TradeTeamPortal` (`src/components/InstallerCrmWorkspace.tsx:17,898`; `src/components/TradeTeamPortal.tsx:8,60`) | Connected |
| 33 | `src/components/TradeHandoverCentre.tsx:290,324` | `TradeBusinessHub` and `InstallerCrmWorkspace` (`src/components/TradeBusinessHub.tsx:5,446`; `src/components/InstallerCrmWorkspace.tsx:14,905`) | Connected |
| 34 | `src/components/TradeHandoverCorrections.tsx:64` | `TradeHandoverCentre` (`src/components/TradeHandoverCentre.tsx:10,306`) | Connected |
| 35 | `src/components/TradeJobFormsPanel.tsx:71` | `InstallerCrmWorkspace` and `TradeTeamPortal` (`src/components/InstallerCrmWorkspace.tsx:19,899`; `src/components/TradeTeamPortal.tsx:9,60`) | Connected |
| 36 | `src/components/TradeJobPacketWorkspace.tsx:29,74` | `TradePriceBookWorkspace` (`src/components/TradePriceBookWorkspace.tsx:7,121`) | Connected |
| 37 | `src/components/TradeNewJobForm.tsx:67,191,194` | `InstallerCrmWorkspace` (`src/components/InstallerCrmWorkspace.tsx:28,759`) | Connected |
| 38 | `src/components/TradePriceBookWorkspace.tsx:125` | `InstallerCrmWorkspace` (`src/components/InstallerCrmWorkspace.tsx:26,851`) | Connected |
| 39 | `src/components/TradePurchasingWorkspace.tsx:179,215,225,226` | `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:23,610`) | Connected |
| 40 | `src/components/TradeScheduleWorkspace.tsx:596` | Three shells (`src/components/DirectTradeDashboard.tsx:25,651`; `src/components/InstallerCrmWorkspace.tsx:30,794`; `src/components/TradeTeamPortal.tsx:10,58`) | Connected |
| 41 | `src/components/TradeTeamCentre.tsx:103` | `InstallerCrmWorkspace` (`src/components/InstallerCrmWorkspace.tsx:18,854`) | Connected |
| 42 | `src/components/TradeTeamPortal.tsx:55` | `/direct-trade/team` (`src/app/direct-trade/team/page.tsx:2,11`) | Connected route shell |
| 43 | `src/components/WorkspaceSavedViews.tsx:42` | `InstallerCrmWorkspace` (`src/components/InstallerCrmWorkspace.tsx:10,780,824`) | Connected |

Count reconciliation: 12 admin/operations files + 10 public/household/TLink-entry files + 21 trade-workflow files = 43. This lexical inventory does not assert successful validation, submission, provider delivery or persistence.

### Dashboard, workspace and shell ledger

The name-based scan finds 18 `*(Dashboard|Workspace|Shell).tsx` files. Four route-shell complements are added because their filenames use `Portal` or `Chrome` even though they provide the same composition responsibility. The resulting 22-file surface ledger is non-overlapping: 18 name-matched files + 4 complements. Feature `Panel`, `Centre`, `Hub` and form components remain in the form/direct-fetch/route inventories and are not silently reclassified as shells. Every file in this defined set has a tracked page or parent consumer; none is an orphan.

| Surface file | Classification | Route or parent consumer | Disposition and static limit |
|---|---|---|---|
| `src/components/AdminAccountWorkspace.tsx` | Named workspace | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:31,1040`) | Connected; nested owner/admin surface, not a route |
| `src/components/AdminCatalogueWorkspace.tsx` | Named workspace | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:30,1049`) | Connected; nested surface |
| `src/components/AdminDatabaseWorkspace.tsx` | Named workspace | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:35,1106`) | Connected; owner-only visibility in the shell, server authorization assessed separately |
| `src/components/AdminOpportunityWorkspace.tsx` | Named workspace | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:29,1045`) | Connected; nested surface |
| `src/components/AdminProductEnquiryWorkspace.tsx` | Named workspace | `AdminOperationsPortal` (`src/components/AdminOperationsPortal.tsx:32,1053`) | Connected; nested surface |
| `src/components/CustomerDashboard.tsx` | Named dashboard and primary shell | Seven `/account` pages | Connected; route-specific initial view, no separate route boundary per workspace |
| `src/components/DirectTradeDashboard.tsx` | Named dashboard and primary shell | `/direct-trade/dashboard` | Connected; composes installer and supplier workspaces |
| `src/components/GuideShell.tsx` | Named shell | Nine guide pages, for example `src/app/guides/solar/page.tsx:1,18,32` | Connected; shared guide chrome |
| `src/components/InstallerCrmWorkspace.tsx` | Named workspace | `TradeBusinessHub` (`src/components/TradeBusinessHub.tsx:6,136`) | Connected; many internal views share one component boundary |
| `src/components/SupplierCatalogueWorkspace.tsx` | Named workspace | `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:19,602`) | Connected |
| `src/components/TradeAssetWorkspace.tsx` | Named workspace | `InstallerCrmWorkspace` (`src/components/InstallerCrmWorkspace.tsx:22,852,947`) | Connected |
| `src/components/TradeDataImportWorkspace.tsx` | Named workspace | `DirectTradeDashboard` and `InstallerCrmWorkspace` (`src/components/DirectTradeDashboard.tsx:24,611`; `src/components/InstallerCrmWorkspace.tsx:20,850`) | Connected |
| `src/components/TradeInvoiceWorkspace.tsx` | Named workspace | `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:26,656`) | Connected |
| `src/components/TradeJobPacketWorkspace.tsx` | Named workspace | `TradePriceBookWorkspace` (`src/components/TradePriceBookWorkspace.tsx:7,121`) | Connected |
| `src/components/TradePriceBookWorkspace.tsx` | Named workspace | `InstallerCrmWorkspace` (`src/components/InstallerCrmWorkspace.tsx:26,851`) | Connected |
| `src/components/TradePurchasingWorkspace.tsx` | Named workspace | `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:23,610`) | Connected |
| `src/components/TradeScheduleWorkspace.tsx` | Named workspace | `DirectTradeDashboard`, `InstallerCrmWorkspace`, `TradeTeamPortal` | Connected in three shells |
| `src/components/TradeServiceFollowUpWorkspace.tsx` | Named workspace | `DirectTradeDashboard` and `TradeTeamPortal` (`src/components/DirectTradeDashboard.tsx:27,661`; `src/components/TradeTeamPortal.tsx:11,59`) | Connected |
| `src/components/AdminOperationsPortal.tsx` | Primary route-shell complement | `/operations/control-centre` (`src/app/operations/control-centre/page.tsx:2,11`) | Connected; v199 owner Database view alone has current signed-in QA |
| `src/components/TradeTeamPortal.tsx` | Primary route-shell complement | `/direct-trade/team` (`src/app/direct-trade/team/page.tsx:2,11`) | Connected |
| `src/components/ComparatorChrome.tsx` | Public chrome complement | Public pages and `CustomerDashboard`, including `src/app/compare/page.tsx:1,11` and `src/components/CustomerDashboard.tsx:21,2997` | Connected; owns the only `#site-content` target, causing the skip-link defect outside this chrome |
| `src/components/TLinkChrome.tsx` | TLink chrome complement | TLink pages and portals, including `src/components/DirectTradeDashboard.tsx:9,500` and `src/components/TradeTeamPortal.tsx:7,54` | Connected; does not emit `#site-content` |

Count reconciliation: 18 filename-matched surfaces + `AdminOperationsPortal` + `TradeTeamPortal` + `ComparatorChrome` + `TLinkChrome` = 22 unique files. Page presence and import reachability are confirmed statically; runtime visibility under every role and state remains `UNKNOWN`.

### Direct-fetch component ledger

The complete case-sensitive scan for the global identifier `fetch(` under `src/components/**/*.tsx` resolves to 55 files and 151 call expressions. `fetch` lines below count the global call only, not wrapper calls such as `authorisedFetch(...)`. API entries include same-file literals and closed dynamic helper inputs. `AdminOperationsPortal` is special: its one `fetch(path)` transports a closed set of 22 `/api/admin/*` bases passed by itself and nested `api`-prop consumers. Five other admin bases use their component's own direct fetch; all 27 are enumerated in the contract table that follows.

The exact 22-base portal dispatcher set is `/api/admin/accounts`, `/api/admin/admins`, `/api/admin/database`, `/api/admin/directory`, `/api/admin/ecosystem-health`, `/api/admin/form-templates`, `/api/admin/jobs`, `/api/admin/list-views`, `/api/admin/lookups`, `/api/admin/notifications`, `/api/admin/opportunities`, `/api/admin/opportunities/allocate`, `/api/admin/opportunities/matches`, `/api/admin/performance`, `/api/admin/product-enquiries`, `/api/admin/products`, `/api/admin/recovery`, `/api/admin/referrals`, `/api/admin/service-follow-up-reporting`, `/api/admin/service-reminder-delivery`, `/api/admin/session` and `/api/admin/usability-pilot`. The five component-owned direct bases are `/api/admin/asset-safety`, `/api/admin/asset-transfers`, `/api/admin/evidence`, `/api/admin/handover-corrections` and `/api/admin/handovers`.

State codes are deliberately narrow: `B` = file-local loading/busy/pending indication; `E` = caught request failure path; `A` = `role="status"`, `role="alert"`, `aria-live` or `aria-busy`; `R` = rendered, deliberate refresh/retry control; `O` = explicit online/offline handling; `T` = elapsed-time abort; `C` = lifecycle/debounce cancellation without a request timeout; `D` = blocking dialog/drawer focus limitation already described in this report. A missing code means that behavior was not established in that file, not that the browser or framework cannot provide it.

| # | Direct-fetch component and exact global `fetch` line(s) | API literal(s) or dynamic prefix | Consumer and orphan disposition | Contract | Static state evidence |
|---:|---|---|---|---|---|
| 1 | `src/components/AdminAccountWorkspace.tsx:175` (1) | `/api/admin/accounts`, `/api/admin/evidence`, `/api/admin/list-views` | `AdminOperationsPortal`; connected | `MATCH` | `B,E`; no file-local live region |
| 2 | `src/components/AdminAssetGovernance.tsx:28,29,52` (3) | `/api/admin/asset-transfers`, `/api/admin/handover-corrections` | `AdminOperationsPortal`; connected | `MATCH` | `B,E,A` |
| 3 | `src/components/AdminAssetSafety.tsx:25` (1) | `/api/admin/asset-safety` | `AdminOperationsPortal`; connected | `MATCH` | `B,E,A,R` |
| 4 | `src/components/AdminHandoverReview.tsx:64,110` (2) | Dynamic `path` closed to `/api/admin/handovers`; direct `/api/trade-handover/documents` | `AdminOperationsPortal`; connected | `MATCH` | `B,E,A,R` |
| 5 | `src/components/AdminOperationsPortal.tsx:196` (1) | Dynamic `path`; closed 22-base admin set in the contract ledger | `/operations/control-centre`; connected route shell | `MATCH` | `B,E,A,R` |
| 6 | `src/components/CertificatePriceTracker.tsx:57` (1) | `/api/certificate-prices` | `/guides/certificate-prices`; connected | `MATCH` | `B,E,A,C` |
| 7 | `src/components/CustomerAppointmentRescheduling.tsx:25` (1) | `/api/customer-appointment-rescheduling` | `CustomerDashboard`; connected | `MATCH` | `B,E,A` |
| 8 | `src/components/CustomerAssetLifecycle.tsx:30` (1) | `/api/customer-asset-lifecycle` with query form for GET | `CustomerDashboard`, `CustomerAssetOwnershipCentre`; connected | `MATCH` | `B,E,A` |
| 9 | `src/components/CustomerAssetOwnershipCentre.tsx:28,78` (2) | `/api/customer-asset-ownership`, `/api/trade-handover/documents` | `CustomerDashboard`; connected | `MATCH` | `B,E,A` |
| 10 | `src/components/CustomerDashboard.tsx:392,2663,2681,2726,2765,2863,2902,2941` (8) | `/api/customer-account`, `/api/customer-projects`, `/api/customer-project-evidence`, `/api/trade-handover/documents` | Seven `/account` pages; connected route shell | `MATCH` | `B,E,A` |
| 11 | `src/components/CustomerTradeQuotes.tsx:57` (1) | `/api/customer-trade-quotes` | `CustomerDashboard`; connected | `MATCH` | `B,E,A` |
| 12 | `src/components/DirectTradeDashboard.tsx:258,304,352,406,454,487` (6) | `/api/trade-profile`, `/api/trade-opportunities`, `/api/trade-work-orders`, `/api/customer-project-evidence` | `/direct-trade/dashboard`; connected route shell | `MATCH` | `B,E,A,C` |
| 13 | `src/components/DirectTradePartnerForm.tsx:122,245` (2) | `/api/trade-profile` | `/direct-trade/partners`; connected | `MATCH` | `B,E,A` |
| 14 | `src/components/DirectTradeVerificationCentre.tsx:78` (1) | Dynamic `path` closed to `/api/trade-profile`, `/api/trade-verification/documents` | `/direct-trade/dashboard/verification`; connected | `MATCH` | `B,E,A` |
| 15 | `src/components/electricity/NativeElectricityComparator.tsx:465,587` (2) | `/api/electricity-plans`, `/api/leads` | `/compare`, `/compare/electricity-next`; connected | `MATCH` | `B,E,A,T` (25 s plan timeout) |
| 16 | `src/components/GasComparator.tsx:104` (1) | `/api/gas-plans` | `/gas-compare`; connected | `MATCH` | `B,E,A,T` (25 s timeout) |
| 17 | `src/components/InstallerArrivalWindows.tsx:46` (1) | `/api/trade-opportunities` | `DirectTradeDashboard`; connected | `MATCH` | `B,E`; no file-local live region |
| 18 | `src/components/InstallerCrmWorkspace.tsx:252,282,320,342,399,413,431,444,461,521,535,549,616,639,662,689,864,869` (18) | `/api/trade-crm`, `/api/trade-list-views`, `/api/trade-work-orders` | `TradeBusinessHub`; connected | `MATCH` | `B,E,A,C` |
| 19 | `src/components/InstallerPlatformQuote.tsx:60,93,108` (3) | `/api/product-selections`, `/api/trade-opportunities` | `DirectTradeDashboard`; connected | `MATCH` | `B,E`; no file-local live region |
| 20 | `src/components/InstallerProductMarketplace.tsx:211` (1) | Dynamic `path` closed to `/api/product-marketplace`, `/api/product-marketplace/preferences`, `/api/product-selections` | `DirectTradeDashboard`; connected | `MATCH` | `B,E,A,C` |
| 21 | `src/components/JobInformationUpload.tsx:53,108,120,140` (4) | Dynamic `/api/job-information/${token}` | `/job-information/[token]`; connected | `MATCH` to `/api/job-information/[token]` | `B,E,A` |
| 22 | `src/components/QuoteLinkReview.tsx:22,29` (2) | Dynamic `/api/quote-review/${token}` | `/quote-review/[token]`; connected | `MATCH` to `/api/quote-review/[token]` | `B,E,A` |
| 23 | `src/components/SupplierCatalogueWorkspace.tsx:273,274,313,347,383,477,660,696,712` (9) | `/api/supplier-products`, `/api/supplier-enquiries`, `/api/trade-list-views` | `DirectTradeDashboard`; connected | `MATCH` | `B,E,A` |
| 24 | `src/components/SupplierLocationManager.tsx:9` (1) | `/api/supplier-locations` | `SupplierCatalogueWorkspace`; connected | `MATCH` | `B,E,A` |
| 25 | `src/components/TLinkCommandCentre.tsx:98` (1) | `/api/tlink-search` | Rendered by `DirectTradeDashboard` (`src/components/DirectTradeDashboard.tsx:10,544`); six other files import only its target type | `MATCH` | `B,E,A,T` (6 s search timeout) |
| 26 | `src/components/TradeAccountingPanel.tsx:47,81,97` (3) | `/api/trade-accounting` | `TradeQuickInvoicePanel`, `TradeCommercialHandoffPanel`; connected | `MATCH` | `B,E,A,R` |
| 27 | `src/components/TradeAssetLifecycle.tsx:41` (1) | `/api/trade-asset-lifecycle` with query form for GET | `TradeHandoverCentre`; connected | `MATCH` | `B,E,A` |
| 28 | `src/components/TradeAssetWorkspace.tsx:45` (1) | Dynamic suffix on `/api/trade-assets` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 29 | `src/components/TradeBusinessHub.tsx:186,213` (2) | `/api/trade-work-orders` | `DirectTradeDashboard`; connected | `MATCH` | `B,E,A` |
| 30 | `src/components/TradeCommercialHandoffPanel.tsx:31,47` (2) | `/api/trade-commercial-handoff` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A,R` |
| 31 | `src/components/TradeDataImportWorkspace.tsx:63` (1) | Dynamic `path` closed to `/api/trade-imports` | `DirectTradeDashboard`, `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 32 | `src/components/TradeEnquiryInbox.tsx:47` (1) | Dynamic `path` closed to `/api/trade-enquiries` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 33 | `src/components/TradeFieldWorkPanel.tsx:41,95,113,127,139,148,175` (7) | `/api/trade-field-work`, `/api/trade-photo-requests` | `InstallerCrmWorkspace`, `TradeTeamPortal`; connected | `MATCH` | `B,E,A,O,D`; blocks the primary job-stage transition offline, does not queue it |
| 34 | `src/components/TradeHandoverCentre.tsx:116,136,185,207,234` (5) | `/api/trade-handover`, `/api/trade-handover/documents` | `TradeBusinessHub`, `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 35 | `src/components/TradeHandoverCorrections.tsx:26,52` (2) | `/api/trade-handover-corrections` | `TradeHandoverCentre`; connected | `MATCH` | `B,E,A` |
| 36 | `src/components/TradeIntegrationCentre.tsx:45,77,94` (3) | `/api/trade-integrations` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 37 | `src/components/TradeInvoiceWorkspace.tsx:34` (1) | `/api/trade-invoices` | `DirectTradeDashboard`; connected | `MATCH` | `B,E,A` |
| 38 | `src/components/TradeJobFormsPanel.tsx:19` (1) | `/api/trade-job-forms` with query form for GET | `InstallerCrmWorkspace`, `TradeTeamPortal`; connected | `MATCH` | `B,E,A` |
| 39 | `src/components/TradeJobNotifications.tsx:31,61` (2) | `/api/trade-job-notifications` | `DirectTradeDashboard`; connected | `MATCH` | `E,A`; no initial busy/loading state, 30 s background poll and focus reload |
| 40 | `src/components/TradeJobPacketWorkspace.tsx:36` (1) | `/api/trade-job-packets` with dynamic `serviceCategory` query | `TradePriceBookWorkspace`; connected | `MATCH` | `B,E,A,C` |
| 41 | `src/components/TradeJobReadinessPanel.tsx:23,25` (2) | `/api/trade-job-readiness` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 42 | `src/components/TradeNewJobForm.tsx:34,106,110,118,156` (5) | `/api/trade-address-suggestions`, `/api/trade-crm` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 43 | `src/components/TradePaymentPanel.tsx:17,36` (2) | `/api/trade-integrations`, `/api/trade-payment-links` | `TradeQuickInvoicePanel`, `TradeCommercialHandoffPanel`; connected | `MATCH` | `B,E,A,R` |
| 44 | `src/components/TradePhotoRequestPanel.tsx:74,111,130,146,163,179` (6) | `/api/trade-photo-requests` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A,R` |
| 45 | `src/components/TradePhotoTemplateLibrary.tsx:79,103` (2) | `/api/trade-photo-templates` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 46 | `src/components/TradePriceBookWorkspace.tsx:45` (1) | Dynamic suffix on `/api/trade-price-book` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A,C` |
| 47 | `src/components/TradePurchasingWorkspace.tsx:77,92,138` (3) | `/api/trade-purchasing`, `/api/trade-list-views` | `DirectTradeDashboard`; connected | `MATCH` | `B,E,A` |
| 48 | `src/components/TradeQuickInvoicePanel.tsx:49,78` (2) | `/api/trade-quick-invoices` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A,D` |
| 49 | `src/components/TradeQuickInvoiceStep.tsx:34,35,100` (3) | `/api/trade-price-book`, `/api/trade-integrations` | `TradeNewJobForm`; connected | `MATCH` | `B,E,A,D`; focus-triggered refresh is not retry/backoff |
| 50 | `src/components/TradeQuotePanel.tsx:58` (1) | Dynamic suffix on `/api/trade-quotes` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A,D` |
| 51 | `src/components/TradeScheduleWorkspace.tsx:151,194,212,278,298,309` (6) | `/api/trade-schedule`, `/api/trade-calendar-sync`, `/api/trade-integrations` | Three route shells; connected | `MATCH` | `B,E,A,C` |
| 52 | `src/components/TradeServiceFollowUpWorkspace.tsx:34,48` (2) | `/api/trade-service-follow-ups` | `DirectTradeDashboard`, `TradeTeamPortal`; connected | `MATCH` | `B,E,A,R` |
| 53 | `src/components/TradeTeamCentre.tsx:30,31,50,63` (4) | `/api/trade-team`, `/api/trade-team/devices` | `InstallerCrmWorkspace`; connected | `MATCH` | `B,E,A` |
| 54 | `src/components/TradeTeamPortal.tsx:35` twice, `36,49` (4) | `/api/trade-team` | `/direct-trade/team`; connected route shell | `MATCH` | `B,E,A` |
| 55 | `src/components/WholesalerProfileDrawer.tsx:27` (1) | `/api/product-marketplace/supplier` | `InstallerProductMarketplace`; connected | `MATCH` | `B,E,A,C,D` |

Count reconciliation: 55 files and 151 global `fetch(...)` calls. All 55 have a caught failure path; 54 have a loading/busy/pending marker, with `TradeJobNotifications` the exception; 52 contain a live-region or busy semantic, with `AdminAccountWorkspace`, `InstallerArrivalWindows` and `InstallerPlatformQuote` the exceptions. Only `NativeElectricityComparator`, `GasComparator` and `TLinkCommandCentre` implement elapsed-time aborts. Eight additional files cancel work on lifecycle/debounce changes but do not impose a request timeout. Only `TradeFieldWorkPanel` observes browser online/offline state, and it blocks the primary job-stage transition rather than queuing that action (`src/components/TradeFieldWorkPanel.tsx:59-60,89`). Other writes in that component still rely on request failure handling, so complete offline safety is not established.

The `R` rows are eight components with a rendered business refresh or retry action: `AdminAssetSafety`, `AdminHandoverReview`, `AdminOperationsPortal`, `TradeAccountingPanel`, `TradeCommercialHandoffPanel`, `TradePaymentPanel`, `TradePhotoRequestPanel` and `TradeServiceFollowUpWorkspace`. No shared automatic retry, exponential backoff or idempotent transport retry was found in the 55-file web fetch layer. User-triggered retry controls are not equivalent to a transport retry policy.

### Reconciled client/server API contract ledger

The ledger below expands same-file wrappers and the `AdminOperationsPortal` `fetch(path)` boundary. Query strings are normalized to their base route. The two opaque-token prefixes are mapped to their App Router dynamic segments. `MATCH` means the client base path has a tracked route and every statically observed client verb is exported by that route. It does not prove request/response schema compatibility, authorization success, provider success or runtime reachability.

| # | Client API literal or dynamic prefix | Observed client verbs | Tracked server contract | Known web consumer(s) | Status |
|---:|---|---|---|---|---|
| 1 | `/api/admin/accounts` | `GET/PATCH` | `GET/PATCH` (`src/app/api/admin/accounts/route.ts:86-193`) | `AdminAccountWorkspace`, `AdminOperationsPortal` | `MATCH` |
| 2 | `/api/admin/admins` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/admin/admins/route.ts:8-59`) | `AdminOperationsPortal` | `MATCH` |
| 3 | `/api/admin/asset-safety` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/admin/asset-safety/route.ts:68-102`) | `AdminAssetSafety` | `MATCH` |
| 4 | `/api/admin/asset-transfers` | `GET/PATCH` | `GET/PATCH` (`src/app/api/admin/asset-transfers/route.ts:60-68`) | `AdminAssetGovernance` | `MATCH` |
| 5 | `/api/admin/database` | `GET/POST/DELETE` | `GET/POST/DELETE` (`src/app/api/admin/database/route.ts:113-188`) | `AdminDatabaseWorkspace` | `MATCH` |
| 6 | `/api/admin/directory` | `GET/PATCH` | `GET/PATCH` (`src/app/api/admin/directory/route.ts:65-285`) | `AdminAccountDirectory` | `MATCH` |
| 7 | `/api/admin/ecosystem-health` | `GET` | `GET` (`src/app/api/admin/ecosystem-health/route.ts:17`) | `AdminOperationsPortal` | `MATCH` |
| 8 | `/api/admin/evidence` | `GET` | `GET` (`src/app/api/admin/evidence/route.ts:15`) | `AdminAccountWorkspace` | `MATCH` |
| 9 | `/api/admin/form-templates` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/admin/form-templates/route.ts:62-97`) | `AdminFormTemplates` | `MATCH` |
| 10 | `/api/admin/handover-corrections` | `GET/PATCH` | `GET/PATCH` (`src/app/api/admin/handover-corrections/route.ts:44-52`) | `AdminAssetGovernance` | `MATCH` |
| 11 | `/api/admin/handovers` | `GET/PATCH` | `GET/PATCH` (`src/app/api/admin/handovers/route.ts:14-96`) | `AdminHandoverReview` | `MATCH` |
| 12 | `/api/admin/jobs` | `GET` | `GET` (`src/app/api/admin/jobs/route.ts:6`) | `AdminJobDirectory` | `MATCH` |
| 13 | `/api/admin/list-views` | `GET/PATCH/DELETE` | `GET/PATCH/DELETE` (`src/app/api/admin/list-views/route.ts:10-35`) | `AdminAccountDirectory`, `AdminAccountWorkspace`, `AdminCatalogueWorkspace`, `AdminOpportunityWorkspace`, `admin-workspace.ts` | `MATCH` |
| 14 | `/api/admin/lookups` | `GET` | `GET` (`src/app/api/admin/lookups/route.ts:10`) | `AdminOpportunityWorkspace` | `MATCH` |
| 15 | `/api/admin/notifications` | `GET/PATCH` | `GET/PATCH` (`src/app/api/admin/notifications/route.ts:85-202`) | `AdminNotificationInbox` | `MATCH` |
| 16 | `/api/admin/opportunities` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/admin/opportunities/route.ts:50-160`) | `AdminOpportunityWorkspace` | `MATCH` |
| 17 | `/api/admin/opportunities/allocate` | `POST` | `POST` (`src/app/api/admin/opportunities/allocate/route.ts:6`) | `AdminOpportunityWorkspace` | `MATCH` |
| 18 | `/api/admin/opportunities/matches` | `POST/PATCH` | `POST/PATCH` (`src/app/api/admin/opportunities/matches/route.ts:29-202`) | `AdminOpportunityWorkspace` | `MATCH` |
| 19 | `/api/admin/performance` | `GET` | `GET` (`src/app/api/admin/performance/route.ts:19`) | `AdminPerformancePanel` | `MATCH` |
| 20 | `/api/admin/product-enquiries` | `GET` | `GET` (`src/app/api/admin/product-enquiries/route.ts:12`) | `AdminOperationsPortal`, `AdminProductEnquiryWorkspace` | `MATCH` |
| 21 | `/api/admin/products` | `GET/PATCH` | `GET/PATCH` (`src/app/api/admin/products/route.ts:39-121`) | `AdminCatalogueWorkspace` | `MATCH` |
| 22 | `/api/admin/recovery` | `POST` | `POST` (`src/app/api/admin/recovery/route.ts:14`) | `AdminOperationsPortal` | `MATCH` |
| 23 | `/api/admin/referrals` | `GET/PATCH` | `GET/PATCH` (`src/app/api/admin/referrals/route.ts:14-54`) | `AdminOperationsPortal` | `MATCH` |
| 24 | `/api/admin/service-follow-up-reporting` | `GET` | `GET` (`src/app/api/admin/service-follow-up-reporting/route.ts:11`) | `AdminServiceFollowUpReporting` | `MATCH` |
| 25 | `/api/admin/service-reminder-delivery` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/admin/service-reminder-delivery/route.ts:52-81`) | `AdminServiceReminderDelivery` | `MATCH` |
| 26 | `/api/admin/session` | `GET/POST` | `GET/POST` (`src/app/api/admin/session/route.ts:19-91`) | `AdminOperationsPortal` | `MATCH` |
| 27 | `/api/admin/usability-pilot` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/admin/usability-pilot/route.ts:89-172`) | `AdminUsabilityPilot` | `MATCH` |
| 28 | `/api/certificate-prices` | `GET` | `GET` (`src/app/api/certificate-prices/route.ts:6`) | `CertificatePriceTracker` | `MATCH` |
| 29 | `/api/customer-account` | `GET/POST` | `GET/POST` (`src/app/api/customer-account/route.ts:30-67`) | `CustomerDashboard` | `MATCH` |
| 30 | `/api/customer-appointment-rescheduling` | `GET/POST` | `GET/POST` (`src/app/api/customer-appointment-rescheduling/route.ts:92-98`) | `CustomerAppointmentRescheduling` | `MATCH` |
| 31 | `/api/customer-asset-lifecycle` | `GET/PATCH` | `GET/PATCH` (`src/app/api/customer-asset-lifecycle/route.ts:134-145`) | `CustomerAssetLifecycle` | `MATCH` |
| 32 | `/api/customer-asset-ownership` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/customer-asset-ownership/route.ts:138-238`) | `CustomerAssetOwnershipCentre` | `MATCH` |
| 33 | `/api/customer-project-evidence` | `GET/POST/DELETE` | `GET/POST/DELETE` (`src/app/api/customer-project-evidence/route.ts:102-206`) | `CustomerDashboard`, `DirectTradeDashboard` | `MATCH` |
| 34 | `/api/customer-projects` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/customer-projects/route.ts:283-334`) | `CustomerDashboard` | `MATCH` |
| 35 | `/api/customer-trade-quotes` | `GET/POST` | `GET/POST` (`src/app/api/customer-trade-quotes/route.ts:83-89`) | `CustomerTradeQuotes` | `MATCH` |
| 36 | `/api/electricity-plans` | `GET` | `GET` (`src/app/api/electricity-plans/route.js:34`) | `NativeElectricityComparator` | `MATCH` |
| 37 | `/api/gas-plans` | `GET` | `GET` (`src/app/api/gas-plans/route.ts:35`) | `GasComparator` | `MATCH` |
| 38 | Dynamic `/api/job-information/${token}` | `GET/POST/DELETE` | `/api/job-information/[token]` exports `GET/POST/DELETE` (`src/app/api/job-information/[token]/route.ts:138-260`) | `JobInformationUpload` | `MATCH` |
| 39 | `/api/leads` | `POST` | `POST` (`src/app/api/leads/route.js:57`) | `NativeElectricityComparator` | `MATCH` |
| 40 | `/api/product-marketplace` | `GET` | `GET` (`src/app/api/product-marketplace/route.ts:125`) | `InstallerProductMarketplace` | `MATCH` |
| 41 | `/api/product-marketplace/preferences` | `GET/PATCH/DELETE` | `GET/PATCH/DELETE` (`src/app/api/product-marketplace/preferences/route.ts:106-168`) | `InstallerProductMarketplace` | `MATCH` |
| 42 | `/api/product-marketplace/supplier` | `GET` | `GET` (`src/app/api/product-marketplace/supplier/route.ts:15`) | `WholesalerProfileDrawer` | `MATCH` |
| 43 | `/api/product-selections` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/product-selections/route.ts:97-204`) | `InstallerPlatformQuote`, `InstallerProductMarketplace` | `MATCH` |
| 44 | Dynamic `/api/quote-review/${token}` | `GET/POST` | `/api/quote-review/[token]` exports `GET/POST` (`src/app/api/quote-review/[token]/route.ts:70-80`) | `QuoteLinkReview` | `MATCH` |
| 45 | `/api/supplier-enquiries` | `GET/PATCH` | `GET/PATCH` (`src/app/api/supplier-enquiries/route.ts:76-86`) | `SupplierCatalogueWorkspace` | `MATCH` |
| 46 | `/api/supplier-locations` | `GET/POST` | `GET/POST` (`src/app/api/supplier-locations/route.ts:18-24`) | `SupplierLocationManager` | `MATCH` |
| 47 | `/api/supplier-products` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/supplier-products/route.ts:445-758`) | `SupplierCatalogueWorkspace` | `MATCH` |
| 48 | `/api/tlink-search` | `GET` | `GET` (`src/app/api/tlink-search/route.ts:31`) | `TLinkCommandCentre` | `MATCH` |
| 49 | `/api/trade-accounting` | `GET/POST` | `GET/POST` (`src/app/api/trade-accounting/route.ts:619-651`) | `TradeAccountingPanel` | `MATCH` |
| 50 | `/api/trade-address-suggestions` | `GET` | `GET` (`src/app/api/trade-address-suggestions/route.ts:18`) | `TradeNewJobForm` | `MATCH` |
| 51 | `/api/trade-asset-lifecycle` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-asset-lifecycle/route.ts:155-250`) | `TradeAssetLifecycle` | `MATCH` |
| 52 | `/api/trade-assets` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-assets/route.ts:174-246`) | `TradeAssetWorkspace` | `MATCH` |
| 53 | `/api/trade-calendar-sync` | `GET/POST` | `GET/POST` (`src/app/api/trade-calendar-sync/route.ts:32-40`) | `TradeScheduleWorkspace` | `MATCH` |
| 54 | `/api/trade-commercial-handoff` | `GET/POST` | `GET/POST` (`src/app/api/trade-commercial-handoff/route.ts:85-94`) | `TradeCommercialHandoffPanel` | `MATCH` |
| 55 | `/api/trade-crm` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-crm/route.ts:689-1189`) | `InstallerCrmWorkspace`, `TradeNewJobForm` | `MATCH` |
| 56 | `/api/trade-enquiries` | `GET/POST` | `GET/POST` (`src/app/api/trade-enquiries/route.ts:68-100`) | `TradeEnquiryInbox` | `MATCH` |
| 57 | `/api/trade-field-work` | `GET/POST` | `GET/POST/DELETE` (`src/app/api/trade-field-work/route.ts:212-332`) | `TradeFieldWorkPanel` | `MATCH`; server `DELETE` not called here |
| 58 | `/api/trade-handover` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-handover/route.ts:219-323`) | `TradeHandoverCentre` | `MATCH` |
| 59 | `/api/trade-handover-corrections` | `GET/POST` | `GET/POST` (`src/app/api/trade-handover-corrections/route.ts:81-92`) | `TradeHandoverCorrections` | `MATCH` |
| 60 | `/api/trade-handover/documents` | `GET/POST/DELETE` | `GET/POST/DELETE` (`src/app/api/trade-handover/documents/route.ts:71-174`) | `AdminHandoverReview`, `CustomerAssetOwnershipCentre`, `CustomerDashboard`, `TradeHandoverCentre` | `MATCH` |
| 61 | `/api/trade-imports` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-imports/route.ts:157-352`) | `TradeDataImportWorkspace` | `MATCH` |
| 62 | `/api/trade-integrations` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-integrations/route.ts:43-184`) | `TradeIntegrationCentre`, `TradePaymentPanel`, `TradeQuickInvoiceStep`, `TradeScheduleWorkspace` | `MATCH` |
| 63 | `/api/trade-invoices` | `GET` | `GET` (`src/app/api/trade-invoices/route.ts:17`) | `TradeInvoiceWorkspace` | `MATCH` |
| 64 | `/api/trade-job-forms` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-job-forms/route.ts:71-122`) | `TradeJobFormsPanel` | `MATCH` |
| 65 | `/api/trade-job-notifications` | `GET/PATCH` | `GET/PATCH` (`src/app/api/trade-job-notifications/route.ts:181-189`) | `TradeJobNotifications` | `MATCH` |
| 66 | `/api/trade-job-packets` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-job-packets/route.ts:67-109`) | `TradeJobPacketWorkspace` | `MATCH` |
| 67 | `/api/trade-job-readiness` | `GET/POST` | `GET/POST` (`src/app/api/trade-job-readiness/route.ts:100-114`) | `TradeJobReadinessPanel` | `MATCH` |
| 68 | `/api/trade-list-views` | `GET/POST/PATCH/DELETE` | `GET/POST/PATCH/DELETE` (`src/app/api/trade-list-views/route.ts:38-80`) | `InstallerCrmWorkspace`, `SupplierCatalogueWorkspace`, `TradePurchasingWorkspace` | `MATCH` |
| 69 | `/api/trade-opportunities` | `GET/PATCH` | `GET/PATCH` (`src/app/api/trade-opportunities/route.ts:76-237`) | `DirectTradeDashboard`, `InstallerArrivalWindows`, `InstallerPlatformQuote` | `MATCH` |
| 70 | `/api/trade-payment-links` | `POST` | `POST` (`src/app/api/trade-payment-links/route.ts:163`) | `TradePaymentPanel` | `MATCH` |
| 71 | `/api/trade-photo-requests` | `GET/POST/DELETE` | `GET/POST/DELETE` (`src/app/api/trade-photo-requests/route.ts:196-382`) | `TradeFieldWorkPanel`, `TradePhotoRequestPanel` | `MATCH` |
| 72 | `/api/trade-photo-templates` | `GET/POST` | `GET/POST` (`src/app/api/trade-photo-templates/route.ts:200-209`) | `TradePhotoTemplateLibrary` | `MATCH` |
| 73 | `/api/trade-price-book` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-price-book/route.ts:119-171`) | `TradePriceBookWorkspace`, `TradeQuickInvoiceStep` | `MATCH` |
| 74 | `/api/trade-profile` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-profile/route.ts:79-211`) | `DirectTradeDashboard`, `DirectTradePartnerForm`, `DirectTradeVerificationCentre` | `MATCH` |
| 75 | `/api/trade-purchasing` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-purchasing/route.ts:171-275`) | `TradePurchasingWorkspace` | `MATCH` |
| 76 | `/api/trade-quick-invoices` | `GET/POST` | `GET/POST` (`src/app/api/trade-quick-invoices/route.ts:87-98`) | `TradeQuickInvoicePanel` | `MATCH` |
| 77 | `/api/trade-quotes` | `GET/POST` | `GET/POST` (`src/app/api/trade-quotes/route.ts:178-190`) | `TradeQuotePanel` | `MATCH` |
| 78 | `/api/trade-schedule` | `GET/PATCH` | `GET/PATCH` (`src/app/api/trade-schedule/route.ts:149-159`) | `TradeScheduleWorkspace` | `MATCH` |
| 79 | `/api/trade-service-follow-ups` | `GET/PATCH` | `GET/PATCH` (`src/app/api/trade-service-follow-ups/route.ts:141-232`) | `TradeServiceFollowUpWorkspace` | `MATCH` |
| 80 | `/api/trade-team` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-team/route.ts:88-204`) | `TradeTeamCentre`, `TradeTeamPortal` | `MATCH` |
| 81 | `/api/trade-team/devices` | `GET/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-team/devices/route.ts:76-132`) | `TradeTeamCentre` | `MATCH`; server `POST` not called here |
| 82 | `/api/trade-verification/documents` | `GET/POST/DELETE` | `GET/POST/DELETE` (`src/app/api/trade-verification/documents/route.ts:74-186`) | `DirectTradeVerificationCentre` | `MATCH` |
| 83 | `/api/trade-work-orders` | `GET/POST/PATCH` | `GET/POST/PATCH` (`src/app/api/trade-work-orders/route.ts:281-454`) | `DirectTradeDashboard`, `InstallerCrmWorkspace`, `TradeBusinessHub` | `MATCH` |

Count reconciliation: 69 unique API bases are literal or prefix values inside the 55 direct-fetch files. Fourteen additional bases occur in nested admin components that call the typed `api(path, init)` prop, bringing the expanded web-client set to 83: 27 admin bases + 56 public, customer, marketplace and trade bases. Each has at least one named web consumer and a tracked server route. The repository has 94 tracked `src/app/api/**/route.ts|js` files; this client-ledger subset does not classify the remaining 11 as orphans because mobile sync/media, callbacks, webhooks, health, internal probes and server-mediated billing/referral routes are outside this web-component scan. Full endpoint consumer/orphan classification remains in `08_BACKEND_API_WORKERS_AND_JOBS.md`.

Static verb matching found no missing web route or unsupported observed HTTP method in this 83-path set. That result is narrower than end-to-end compatibility: query/action discriminators, request schemas, response fields, authorization branches and persisted side effects were not executed here. Those remain `PARTIAL` unless covered by the route/contract tests catalogued in the testing report.

## Loading, empty, error, retry and offline states

The application contains many component-local busy, status, empty and failure messages. Representative evidence includes:

- Authentication reports an accessible status message and maps common Firebase failures to non-sensitive copy (`src/components/FirebaseAccountPanel.tsx:20-29`, `97-110`).
- The mobile work list exposes connected/offline state, pull-to-refresh and an explicit no-assigned-jobs state (`mobile/src/app/(tabs)/work.tsx:37-53`).
- Mobile sync retains queued work on a required upgrade and purges protected local data when a device is revoked (`mobile/src/lib/sync.ts:74-113`).
- The address-suggestion API has a manual-entry degraded path, and several provider-facing surfaces return explicit unavailable states; these are useful patterns but were not exercised here.

No tracked App Router `loading.*`, `error.*` or `not-found.*` files were found. Page-level failure containment therefore relies on component code and framework defaults. That is `PARTIAL`, especially for the very large customer and TLink workspaces. A component exception or slow initial chunk does not have a product-specific route boundary proven by source.

Retry design is inconsistent by feature. Some components support refresh or retry explicitly, while many direct `fetch` call sites have only a busy state and a returned error. A complete behavioural retry matrix would require browser and provider-failure testing and remains `UNKNOWN`.

## Accessibility review

### What is implemented well

- The root document declares `lang="en"`, includes a visible-on-focus skip link, and uses native semantic elements (`src/app/layout.tsx:38`; `src/app/globals.css:3041-3043`).
- Many state messages use `role="status"`; inputs generally have labels, fieldsets and appropriate input types.
- Tabular operational data uses tables, column headers and keyboard-scrollable regions. The database workspace is one example (`src/components/AdminDatabaseWorkspace.tsx:244-282`).
- `AccessibleMenu` handles Escape, outside dismissal and focus return (`src/components/AccessibleMenu.tsx:30-40`).
- The native electricity enquiry and audit dialogs set initial focus, trap Tab, handle Escape and return focus (`src/components/electricity/NativeElectricityComparator.tsx:788-818`, `841-873`).
- The schedule appointment dialog has a focus reference, Escape handling and bounded focus movement (`src/components/TradeScheduleWorkspace.tsx:252-270`, `581`).
- Mobile sign-in exposes loading and error/status copy, while the work list has meaningful empty/offline text (`mobile/src/app/index.tsx:32-80`; `mobile/src/app/(tabs)/work.tsx:37-53`).

### Confirmed defect: broken global skip target

Status: `BROKEN` on page families that do not render `SiteHeader`.

The root layout always renders `<a ... href="#site-content">Skip to main content</a>` (`src/app/layout.tsx:38`). The audited source defines that target in `SiteHeader` (`src/components/ComparatorChrome.tsx:35`), but TLink uses `TLinkHeader` without that target (`src/components/TLinkChrome.tsx:13-25`), and token, print, preview and operations shells do not establish `#site-content`. Keyboard users can therefore invoke a skip link that has no destination on those surfaces. `CustomerDashboard` does render `SiteHeader` (`src/components/CustomerDashboard.tsx:2996-2997`) and is not part of this defect.

Required correction: put one authoritative main-content target in the root layout or require every page shell to use the same ID, then test focus movement on every route family. Do not create different skip targets per dashboard.

### Confirmed defect: missing membership fragment targets

Status: `BROKEN`.

`SupplierCatalogueWorkspace` renders two `#membership` links (`src/components/SupplierCatalogueWorkspace.tsx:855,1028`) and `TradeHandoverCentre` renders another (`src/components/TradeHandoverCentre.tsx:264`). No tracked static `id="membership"` exists; the dedicated membership page instead uses `membership-access-title` (`src/app/direct-trade/membership/page.tsx:47`). These controls therefore do not navigate to a valid fragment in their rendered document.

Required correction: use an actual route to the membership/access explanation or provide one stable in-document target where the control is rendered. A static route/fragment crawler and keyboard activation check must prove every hash target before release.

### Confirmed inconsistency: dialog focus management

Status: `PARTIAL`.

Static review found dialog markup with uneven keyboard behaviour:

- `WholesalerProfileDrawer` declares a modal dialog but has no proven initial focus, Escape close, focus trap or focus return (`src/components/WholesalerProfileDrawer.tsx:19-50`).
- `TradeQuickInvoicePanel` locks body scrolling and closes on Escape, but no initial-focus, Tab-trap or return-focus logic is present in the reviewed block (`src/components/TradeQuickInvoicePanel.tsx:64-71`, `120-128`). The related quick-invoice step and quote/field preview dialogs use similar Escape-only patterns.
- `UpgradeEnquiryModal` sets initial focus and handles Escape, but no focus trap or return to the opener is evident (`src/components/UpgradeEnquiryModal.tsx:15-36`).

Required correction: use one tested modal primitive for all blocking dialogs. It must set an accessible name, move focus on open, contain Tab/Shift+Tab, close on Escape when safe, restore focus, lock background interaction and handle nested confirmation states.

### Screen-reader and responsive limitations

The source contains extensive labels, headings, live regions and semantic controls, but this is not proof of screen-reader usability. No automated axe suite, manual NVDA/VoiceOver result or WCAG 2.2 conformance report was found. The correct status is `UNKNOWN` for conformance and `PARTIAL` for implemented semantics. The applicable technical benchmark is [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

The mobile app is portrait-only while declaring tablet support (`mobile/app.json:6`, `14`). This may limit users who require landscape orientation; no documented essential-orientation exception or real-device accessibility test was found. Status: `PARTIAL`.

Sites version 199 records signed-in owner-console inspection at desktop and 390 px with no document-level overflow (`docs/RELEASE_TRUTH.md:124`). Earlier releases record responsive QA for major TLink surfaces. This is `PARTIAL`, not a complete responsive/accessibility certification: v199 did not re-traverse all 41 routes, test real devices, zoom/reflow, orientation or assistive technology.

## Placeholder, demo, mock and reachability review

- The electricity-next page is intentionally a preview and is blocked from indexing; it is not evidence of an abandoned route (`src/app/compare/electricity-next/page.tsx:4-7`; `src/app/robots.ts:7-12`).
- Some admin catalogue records can be explicitly labelled `Demo`; release documentation says historical databases may contain marked synthetic records, while fresh databases no longer receive them automatically (`docs/RELEASE_TRUTH.md:127`). Whether any production account currently sees such records is `UNKNOWN` because production data was not read.
- No tracked route-level placeholder page or `coming soon` screen was established as an active user destination in this review. Absence of a string match is not proof that every feature is complete.
- Reachability behind Firebase, account status, role, verification, subscription, opaque token and provider configuration boundaries cannot be established by static page files. Those states are `UNKNOWN` unless independently covered by route tests or dated runtime evidence.

## Critical journeys without proven end-to-end coverage

No Playwright, Cypress, Webdriver or equivalent browser suite was found in the package manifest, and this audit workstream did not drive a browser. The concurrent v199 release task performed a bounded signed-in owner-console inspection, not an end-to-end suite. Existing tests are valuable but predominantly unit, helper, source-contract and route-contract tests. The following journeys therefore remain `PARTIAL` even where many component/API tests exist:

1. Create account -> verify email -> create household project -> upload evidence -> save and reopen.
2. Upload/parse NEM12 locally -> calculate offers -> inspect assumptions -> submit an enquiry.
3. Create protected project brief -> match eligible installer -> release contact deliberately -> receive/respond to quote.
4. Trade sign-in -> verification -> customer/job creation -> schedule -> field update -> invoice -> payment reconciliation.
5. Token quote review and token photo upload, including expired/replayed/invalid token and storage failure states.
6. Offline mobile edit/upload -> reconnect -> conflict -> retry -> remote device revocation and local purge on real iOS/Android devices.
7. Admin invitation/recovery/role change and all destructive operations, including owner separation-of-duties scenarios.
8. Keyboard-only and screen-reader completion of each high-value form and every modal/drawer.
9. Responsive navigation and data tables at 320 px, zoom to 200/400 percent, reduced motion, high contrast and text resizing.
10. Broad v199 deployment smoke beyond the owner console: canonical navigation, auth redirects, page metadata, sitemap/robots, API contracts and route-family error logs.

## Priority findings and recommendations

| Priority | Status | Finding | Smallest complete remediation |
|---|---|---|---|
| P0 | `BROKEN` | Global skip link has no target on major route families. | Establish one root-owned main target and regression-test every page shell with keyboard focus. |
| P1 | `BROKEN` | Supplier catalogue and handover surfaces link to a missing `#membership` fragment. | Route to the access page or add one stable in-document target, then gate all hash links with static and keyboard checks. |
| P1 | `PARTIAL` | Blocking dialogs use inconsistent focus, Escape and return behaviour. | Consolidate on one accessible dialog primitive and migrate every blocking overlay. |
| P1 | `PARTIAL` | No browser end-to-end or automated accessibility gate protects the highest-value journeys. | Add a small, production-like Playwright suite with axe checks for auth, account, core trade, token and admin read-only paths; keep destructive actions against fixtures/local D1. |
| P1 | `PARTIAL` | V199 has signed-in desktop/390 px evidence for the database workspace, but the complete route set lacks current keyboard/device/runtime traversal. | After the console security decision, perform read-only desktop/phone/keyboard QA for each route family with console/network inspection. |
| P2 | `PARTIAL` | Web request handling is duplicated across 55 components. | Introduce one narrow authenticated JSON client only after mapping current semantics; preserve cancellation, no-store and public/token exceptions. |
| P2 | `PARTIAL` | No route-level loading/error/not-found boundaries. | Add product-specific boundaries around the account, TLink, token and operations families without replacing useful component-local states. |
| P2 | `PARTIAL` | Portrait-only mobile configuration may impair orientation accessibility. | Test the field workflow in landscape/tablet and remove the lock unless a documented essential exception exists. |

## Validation and limits

The application implementation passed the repository test suite in this audit (699 total, 697 passed, 2 intentionally skipped), ESLint, root TypeScript, mobile TypeScript and a fresh local replay of all 79 migrations. The release task separately recorded complete validation/build and bounded v199 browser QA. Exact results are in `12_TESTING_DEPLOYMENT_OPERATIONS_AND_RESILIENCE.md`.

This frontend audit workstream did not run `npm run validate`, a production build, a live link crawler, a signed-in browser, a screen reader, a physical mobile device, provider integrations or production writes. The external release evidence is identified separately. Consequently:

- route and component presence is confirmed;
- selected source contracts and static checks are confirmed;
- exact-SHA deployment and owner-console read reachability are confirmed by the v199 record, but all-route reachability, real user data states, complete responsive rendering, dead-button absence, full keyboard completion and WCAG conformance are not confirmed.
