# TLink and AEA release truth

Status: current repository snapshot

Truth owners: product owner and technical lead

Last reconciled locally: 1 August 2026

Deployment evidence last verified: 1 August 2026

This is the only current implementation and release-status document. The [dated complete audit](./audit/2026-07-21-complete-current-state/README.md) is the immutable evidence baseline. [ROADMAP.md](../ROADMAP.md) owns forward sequence. [HANDOVER_NEXT_TASK.md](./HANDOVER_NEXT_TASK.md) owns one executable milestone.

## Identity

| Layer | Identity | Status |
| --- | --- | --- |
| Audited repository baseline | `ff3c8efe3d5e501286d8e83e28086d6d4590be27` on `codex/sites-custom-domain-migration` | Verified by the 21 July audit |
| ABN schema expansion source | `7ebcb1905d3c28245fbcfede55525e0cfee8df8a` on `codex/abn-schema-expand` | Validated, pushed to GitHub and Sites managed `main` |
| Reviewed-ABN application activation | `481401d98ef2c0b294252a4cabeebc74eba40a52` | Validated and pushed to GitHub |
| Reviewed-ABN merged release | `fb9c80fb73bf2a0b5d461ed2ecbfa28df6022c71` | Preserves expansion and activation ancestry; Sites version 201 |
| Free-access application and contract source | `698a5057cc384d43112e5ccff38a99effbb01fa8` | Validated, pushed to GitHub and Sites managed `main`; Sites version 202 |
| Pre-advisor repository and production baseline | `01a8d09022b086c771c938960efa8d9a333542d3` | Documentation-only child of the application source; pushed to GitHub and live as Sites version 203 |
| Pre-advisor Sites deployment | Sites version 203 at `https://compare.ausenergyassessments.com` | Historical pre-change production identity |
| Customer home advisor application source | `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` | Validated on the exact clean commit and pushed to GitHub and Sites managed `main` |
| Customer home advisor production application | Sites version 204 from `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` | Historical customer-home-advisor release |
| Pre-context documentation checkpoint | `0a82a992e162087eb5ac76b4227dee3a505eae5b` | Documentation-only child of the home-advisor application; pushed to GitHub and live as Sites version 205 before this milestone |
| Advisor context and admin stability application source | `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 206 |
| Independent customer plan application source | `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 208 |
| Customer plan evidence and history application source | `6540ee671e64dbfdf80592283a1954b2ff482355` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 210 |
| Professional review, print and comfort application source | `ee75aadfd6800c01b92532b2d376a4a1e33c9d74` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 212 |
| Direct customer-plan PDF application source | `d5c675a5ceffa6e924df033e8cb8b505bb4d6336` | Validated, pushed to GitHub and Sites managed `main`; first saved and deployed as Sites version 214 |
| Browser-native customer PDF application source | `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 216 |
| Premium customer plan report application source | `fb6cacf8b0309a3fc26b40a43da5b025050d22d2` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 218 |
| Premium report documentation checkpoint | `a92e18b9ea79b53eaf6eda8665f37ec02c861972` | Historical documentation-only child of the version 218 application; published as Sites version 219 without changing the executable report source |
| Technical customer-plan presentation application source | `f401575a5bf463b85c7688424db0b99dddd220c5` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 220 |
| Customer-plan spacing and rounded-surface application source | `e74c2d95889a381cb3bb434607bc6584e54cf722` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 222 |
| Spacing release documentation checkpoint | `c2599eb5bedb11b1648da2b4a60e11b242cb2abb` | Historical documentation-only child of the version 222 application; published as Sites version 223 without changing the executable source |
| Customer-plan trust, evidence and revision application source | `bc427d295b3106907904a3c0b7bf9f2945561cd1` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 224 |
| Trust release documentation checkpoint | `23594c2b61dec855aeba0a10ba5a28eb3aeaf692` | Historical documentation-only child of executable Sites version 224 from `bc427d295b3106907904a3c0b7bf9f2945561cd1`; published as Sites version 225 without changing the executable source |
| Customer project cleanup application source | `9ecde96f8975f322be35283747cb7fe93b2579f9` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as intermediate Sites version 226 |
| Project-control readability application source | `da35ce60295d6c7150cddd9b35e33fcf64c8521b` | Validated after live visual QA, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 227 |
| Customer roadmap context application source | `0db488f325a79e22d126aace75647715b59c96f9` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 229 |
| Customer installer-request application source | `2607cc53f2e4c79546701e29d3d182fde4670952` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 230 |
| Customer installer-request saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_52a74079cae481918a86072452749e99` | Historical exact saved version 230 built from `2607cc53f2e4c79546701e29d3d182fde4670952` |
| Customer plan durability implementation source | `e74278c8b62c569541ea84b5a431917d03a1c13a` | Validated and pushed; saved as Sites version 231, whose deployment failed before public activation |
| Failed non-live saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda` | Deployment `appgdep_6a6bcf5c0f7c8191b877d27581f9d82e` failed with `__dirname is not defined`; version 231 never became public and version 230 remained live |
| Customer plan durability worker-safe application source | `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 232 |
| Customer plan durability saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8` | Historical exact saved version 232 built from `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` |
| Customer plan durability documentation checkpoint | `2c55430757c316b4045e3edd9a26263a24793f14` | Documentation-only child of the version 232 application; historical and not executable |
| Installer-request and multi-photo application source | `5acc4ccf37acd608dc437d3a074410b1d840f706` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 233 |
| Authoritative installer-submit application source | `7d7a821123d9b70cace08ac632d58ca1d3851b1b` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 234 |
| Installer enquiry-pack and business-notification application source | `eeba3679c30789cfe2e633a913a18492270fcc3e` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 235 |
| Complete customer-installer handoff application source | `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 236 |
| Quote-communications documentation-only saved checkpoint | `40b4396b9ef41166a61ee346b023c00bcc9df11b` | Saved as Sites version 237 with identity `appgprj_6a550c378000819185caf094173422bb~appgver_a2882f3eb264819199cedf74de7add75`; never deployed, so version 236 stayed public until version 238 |
| Customer quote communications application source | `35552796048df63c03409d03401d33a47f326434` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 238 |
| Customer-to-trade contact workflow application source | `97e6c7356483706e8e978ab53b842a9e41152f7e` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 239 |
| Customer-to-trade contact saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c` | Historical exact saved version 239 built from `97e6c7356483706e8e978ab53b842a9e41152f7e` |
| Customer-to-trade contact deployment | Sites version 239 from `97e6c7356483706e8e978ab53b842a9e41152f7e` at `https://compare.ausenergyassessments.com` | Historical deployment `appgdep_6a6c7cb6d6e0819187e9566a452e6850`; environment revision 19 |
| Customer-plan trade-enquiry application source | `b40c101939eec44b178b34ccb6397a989d2467d0` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 240 |
| Customer-plan trade-enquiry saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40` | Historical exact saved version 240 built from `b40c101939eec44b178b34ccb6397a989d2467d0` |
| Customer account trust application source | `da4fa911c0b6c7f520e266259af8882b95aaf14a` | Validated, pushed to GitHub and Sites managed `main`; saved and deployed as Sites version 241 |
| Customer account trust saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7` | Historical exact saved version 241 built from `da4fa911c0b6c7f520e266259af8882b95aaf14a` |
| Protected trade locality and reciprocal navigation application source | `399b04f4a5d680080610f9e88b994506bb60c16f` | Historical exact application source saved and deployed as Sites version 242 |
| Creditex compliance operations foundation application source | `2ef8ce19fd5423fd95652a7bc88265e80d7b827f` | Historical empty foundation; validated, pushed to GitHub and Sites managed `main`, then saved and deployed as Sites version 246 |
| Creditex foundation saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_3cef6ddd92e88191a54d034d3a6e72e3` | Exact historical saved version 246 from `2ef8ce19fd5423fd95652a7bc88265e80d7b827f`; package content hash `sha256:9d6ac6f6e5a3036ba8fedf14c94b0fdc61e608b32b203346fc327a8119f625ea` |
| Creditex foundation deployment | Sites version 246 from `2ef8ce19fd5423fd95652a7bc88265e80d7b827f` | Historical deployment `appgdep_6a6d5c42819081919d81dcd9451338bd`; environment revision 19 |
| Intermediate Creditex portal application source | `24a47a9f76b0bd5c390aab65b41b4e7a961db885` | Saved and deployed as Sites version 247; sign-in recovery worked, but live QA found the first operations aggregate was not accepted by production D1, so version 247 was superseded before release completion |
| Creditex operations portal application source | `7b08cb600bde30273774a544e07039acc6de1c03` | Historical exact validated source containing the activity-agnostic portal, assignment-scoped security corrections and D1-compatible aggregates; saved and deployed as Sites version 248 |
| Creditex operations portal saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_1b287ac469e88191aca7160bfa41c32c` | Historical exact saved version 248 built from `7b08cb600bde30273774a544e07039acc6de1c03`; package content hash `sha256:1928ee707d2076db876b6aa40e58219ae5e96273f8ee1ece08cfe74144cd2aac` |
| Creditex operations portal executable identity | Sites version 248 from `7b08cb600bde30273774a544e07039acc6de1c03` at `https://compare.ausenergyassessments.com` | Historical deployment `appgdep_6a6d733ea23c81918f4ccd8e4f30f98b`; environment revision 19 |
| Current Creditex evidence-policy governance application source | `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` | Exact validated source for `CREDITEX-EVIDENCE-POLICY-GOVERNANCE-26`; pushed to GitHub and Sites managed `main` |
| Current saved-version identity | `appgprj_6a550c378000819185caf094173422bb~appgver_bf90b67a89508191bbea3f1a2d926719` | Exact saved Sites version 249 built from `d40c803bfa0b614ed806624a375a1fa47bd0e5a4`; package content hash `sha256:3e66780f5d61ae46c650df39c711a9a26166f75f7d9eb58cf8461a39dc7bc123` |
| Current executable application identity | Sites version 249 from `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` at `https://compare.ausenergyassessments.com/creditex/compliance` | Deployment `appgdep_6a6da8704be08191a4d310adb523e0f3` succeeded; provider URL `https://aea-energy-comparison.info294029.chatgpt.site` |
| Current source checkpoint | Documentation-only child of `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` | This release record does not change the exact executable source for public Sites version 249 |
| Contract cleanup | `0080_retire_legacy_trade_commercial_data.sql`, SHA-256 `2CA1A250D9B6C637010480DEE0528906A932F40835EFBC786D90AD561CE99BA4` | Deployed from `698a5057cc384d43112e5ccff38a99effbb01fa8` |

The additive schema expansion, reviewed-ABN application, authorised contract cleanup, customer, installer and trade releases, protected-trade locality, Creditex foundation, operations portal and evidence-policy governance system are deployed to production. Sites version 249 from `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` is the exact current executable application source. Failed versions 243, 244 and 245 never activated. Intermediate version 247 activated long enough for signed-in QA, exposed a production-D1 incompatibility in one aggregate query and was replaced by version 248, which is now historical. Release QA for version 249 performed no production mutation. The current release has 0 governed programs, 0 activity versions, 0 policies and 0 cases, and keeps every unverified calculator and external execution path disabled.

## Prior released Creditex compliance operations portal

`CREDITEX-COMPLIANCE-OPERATIONS-25` is now a signed-in, activity-agnostic Creditex operations portal rather than a sign-in-only preview. Exact application commit `7b08cb600bde30273774a544e07039acc6de1c03` is deployed as Sites version 248 through `appgdep_6a6d733ea23c81918f4ccd8e4f30f98b` with environment revision 19.

The portal provides one audited workflow across every governed federal, state and territory program, activity, category and scenario. Program workspaces occupy a persistent bottom bar, while activities remain separate selectable dimensions within each program rather than hard-coded routes. The work areas cover privacy-minimised queues, deliberate case review, audit, tasks, participants, stock and decommissioning, submissions and reconciliation, certificates and settlement projections, reports, activity governance and access. Advanced search mirrors the Dataforce filter families for status, work and personnel, client and agent, customer and address, job, appointment, tags, product, audit and other filters. Unsupported legacy fields remain visibly unavailable with an exact reason instead of being fabricated.

Creditex administrators have organisation-wide access to governed work. Default queues exclude customer identity, exact address, contact, private notes, evidence filenames, object keys and raw geolocation. Opening private customer, installer, site, appointment or commercial details requires a deliberate case action and creates an audit record. Non-admin case details and every case-specific write recheck an active assignment at the server boundary; administrators are the explicit organisation-wide exception. An audited, receipt-bound evidence viewer streams only approved image and PDF types without revealing storage keys or original filenames. Concurrent dashboard and case requests use separate generation guards so an older response cannot overwrite a newer program or filter state.

The original stuck sign-in had two independent causes. Runtime trigger verification compared formatting-sensitive SQL left by earlier pre-activation versions, and reauthentication of the already-current Firebase user did not always emit another identity-state callback. Guard verification now canonicalises whitespace only outside quoted SQL, remains fail-closed on substantive differences, returns a stable bounded retry response while installation progresses and displays progress in the portal. Email and Google sign-in now explicitly load the workspace after successful authentication, deduplicated with the identity callback. Live QA observed the staged installation message and then reached the signed-in dashboard.

Version 247 exposed a separate production-only issue: local SQLite accepted one 23-domain `WITH` and `UNION ALL` count query while production D1 returned HTTP 500 from the first operations aggregate. The production database console confirmed all 181 expected application tables were present. Version 248 replaces only that compound query with one bounded scalar-aggregate statement and retains identical organisation scoping. The operations dashboard then loaded successfully with a zero-case governed empty state and no false activity tabs.

No activity or evidence policy is seeded as published. Unverified calculators, manual response assertion, registry submission, certificate creation, trading, settlement, Dataforce or Runabout migration and real regulated cases remain hard-disabled. A policy withdrawn after a case is opened remains available for evidence correction and audit, but approvals and batch staging fail closed. `info@ausenergyassessments.com` is the claimed bootstrap administrator only. Routine Creditex access requires named verified individual users and least privilege; once two named administrators are active, the shared bootstrap membership should be suspended.

The post-review focused Creditex portal, API and operations-control suite passes 54 of 54 tests. The D1 aggregate regression subset passes 38 of 38. `npm.cmd run validate` passes type checking, warning-free lint, 31 of 31 integration tests, 1,089 main tests with 1,087 passed, 2 intentionally skipped and 0 failed, all 98 migrations through `0097_creditex_operations_lifecycle.sql`, the customer-plan PDF audit, production build and Sites server-bundle audit. `git diff --check` passes. The same complete gate passed both the assignment-boundary correction and the final D1-compatible executable source.

The version 248 local archive is 7,300,196 bytes with SHA-256 `5DDD878B2CAD584194DFCEC00B5245A353B9860DEF17CA83B4AE737860E9E3D2`. Sites stored 331 files and 28,968,960 bytes with content hash `sha256:1928ee707d2076db876b6aa40e58219ae5e96273f8ee1ece08cfe74144cd2aac`. GitHub `codex/sites-custom-domain-migration`, Sites managed `main`, saved-version provenance and the deployed executable all resolve to `7b08cb600bde30273774a544e07039acc6de1c03`.

Signed-in production verification confirmed the administrator dashboard, successful `/api/creditex/operations` rendering, all work-area navigation, the Dataforce-parity advanced filter families, the bottom program workspace bar, named-member invitation and role controls, and separate draft program and activity governance with registry code, specification part, product category and scenario fields. No case was auto-selected, so no private detail audit was created by queue load. The post-release Sites Worker error-only query returned zero events. Browser logging contained only the Chrome extension's closed asynchronous message-channel warning, not an application exception.

Physical-device capture, production original-evidence viewing, private rule-pack accuracy, calculator provenance, authorised submission adapters, retention, legal hold, backup, restore and real provider behavior remain unverified or blocked. Full Dataforce and Runabout equivalence still requires authorised exports, field dictionaries, reports, role maps and a Runabout walkthrough; the version-248 portal does not represent that unknown inventory as complete.

## Creditex evidence-policy governance release

`CREDITEX-EVIDENCE-POLICY-GOVERNANCE-26` is deployed from exact application commit `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` as Sites version 249. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_bf90b67a89508191bbea3f1a2d926719` reports the exact application source, and deployment `appgdep_6a6da8704be08191a4d310adb523e0f3` succeeded. The protected production route is `https://compare.ausenergyassessments.com/creditex/compliance`; the Sites provider URL is `https://aea-energy-comparison.info294029.chatgpt.site`.

The release makes activity rules and evidence policies program-scoped, effective-dated and activity agnostic. It adds complete ordered evidence-requirement authoring, immutable sealed snapshots, different-named-administrator publication control, database-enforced publication invariants and fail-closed field compatibility. AEA Field receives only published requirements it can currently execute. The server verifies assembled evidence bytes, SHA-256, file signatures and governed JPEG EXIF, GPS and capture-time consistency instead of accepting client-authored metadata claims. Evidence maxima, duplicate-byte prevention, upload cleanup, immutable audit boundaries and terminal job-state mutation guards are enforced at the server or database boundary.

The exact application tree passes `npm run validate`: 31 of 31 integration tests; 1,157 main tests with 1,155 passed, 2 intentionally skipped and 0 failed; all 99 migrations through `0098_creditex_rule_governance.sql`; type checking; warning-free lint; the customer-plan PDF audit; production build; and Sites server-bundle audit. AEA Field passes type checking, lint, 8 of 8 tests and Android and iOS export. Expo Doctor reports 19 of 20 because of dependency patch drift, so that check is recorded as a known deviation rather than a pass.

The local release package is 7,352,352 bytes with SHA-256 `4E9087A40A00613E4BBDD111D8D5E1CA4A3A5AED01BCF3DA8DD9635396CF920F`. Sites stored 332 files and 29,276,160 bytes with content hash `sha256:3e66780f5d61ae46c650df39c711a9a26166f75f7d9eb58cf8461a39dc7bc123`.

Signed-in Chrome QA as the AEA Creditex administrator with the `Admin` role confirmed that reload progressed from the protected loading state to Operations without a stuck sign-in. The work queue and advanced filters loaded, the bottom Dashboard and program rail remained available, and the Activity rules, evidence-policy authoring, four-eyes notice and Access membership screen rendered. The current real production inventory is 0 governed programs, 0 activity versions, 0 policies and 0 cases. No production mutation was performed during QA.

Physical-device acceptance, platform-backed camera attestation, production original-evidence viewing, private rule-pack accuracy, verified calculators, authorised provider connectors, retention, legal hold, backup, restore and real certificate, registry, trading or settlement behavior remain unverified or blocked. The empty production catalogue is an intentional safety boundary, not evidence that national program coverage is complete.

## Current product model

AEA and TLink contain four connected products:

1. Household energy planning and comparison, including electricity, gas, NEM12 processing, guides, scenarios, rebates and assessment intake.
2. A protected marketplace connecting reviewed household opportunities with approved installers and suppliers.
3. Free TLink trade software for CRM, customers, jobs, scheduling, quotes, forms, field work, assets, handover, invoices, integrations and teams.
4. The AEA Field iOS and Android client for assigned encrypted offline work.

TLink trade software costs A$0. Access has no recurring fee, seat charge, lead charge, job charge, quote charge or payment-card requirement. Customer invoices and job-payment records are operational business records only. They cannot grant, rank or expand TLink access.

## Trade access policy

- A trade applicant must sign in with a verified account email and provide required business and contact details.
- The application rejects an ABN that does not pass the 11-digit checksum.
- A valid checksum does not prove that the applicant owns or represents the business.
- A new or changed ABN remains pending until an authorised reviewer checks it against an authoritative source.
- The reviewer records the outcome, reviewer identity and decision time.
- Trade workspaces and APIs require an active account, an approved business review and the appropriate role.
- Changing the ABN resets the review and removes trade access until a new approval.
- Licence, insurance, accreditation, supplier evidence and jurisdiction checks remain separate controls where the workflow requires them.
- No commercial, invoice, provider-payment or legacy account field can grant trade access.

The deployed `FREE-ACCESS-ABN-01` implementation enforces this policy across signup, server authorization, administration, data and tests.

## Customer home advisor release

`CUSTOMER-HOME-ADVISOR-01` is deployed from exact application commit `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` as Sites version 204. It retires the dedicated customer Home records page and navigation while retaining completed-project handovers, warranty and correction integrity, consent events and administrator governance.

The project intake now:

- records owner or renter tenure separately from strata or common-property approval;
- accepts several goals and detailed home facts;
- uses a broad budget band only to sequence investigation;
- treats `Not sure` as useful information;
- generates an independent, brand-agnostic and editable starting plan;
- supports drag ordering, accessible arrow ordering, removal and bounded custom steps;
- preserves draught-proofing, insulation, glazing and window coverings through installer capability matching and accepted-work handoff;
- removes the household access-routine question;
- uses one optional evidence upload with durable sharing consent, generic installer filenames and safe-photo and privacy guidance;
- keeps private notes visibly editable; and
- places validation beside the customer action.

The flow is not a NatHERS assessment, certificate, formal evidence workflow, quote or savings promise. Forward migration `0081_customer_project_advisor.sql` adds and backfills the multi-goal projection, resets retired demo budgets, converts the old combined fabric category across matching and operational records, preserves complete matched-category lists through protected CRM enquiries and work orders, separates legacy strata approval from tenure, forces ambiguous legacy tenure back to an unanswered owner-or-renter choice, removes household occupancy from project context and anonymises stored evidence filenames without rewriting applied history.

## Advisor context and admin stability release

`CUSTOMER-ADVISOR-CONTEXT-02` is deployed from exact application commit `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77`, first saved and published as Sites version 206.

The administrator correction is intentionally narrow. Opening an unread notification case previously triggered an audited read update whose refresh could reorder the queue and collapse or move the active case. The current implementation pins that active case at its prior visible index during background refresh, restores its viewport anchor and preserves deliberate close or resolve behavior. A manual queue, search, category, priority, status, assignee or action-only change resets the pin so an out-of-filter case does not remain visible.

The household advisor now:

- records each important controlled fact as not known, customer reported, photo available for review or document available for review;
- states that those source labels do not prove a file is attached, linked to the fact, professionally reviewed or verified;
- derives a broad planning profile only from a valid residential postcode and matching state;
- labels that profile as an approximate planning aid, not a NatHERS climate zone, rating, assessment, equipment-size calculation or savings estimate;
- adjusts safe shading or building-shell sequencing from that bounded climate profile;
- accepts up to twelve private room profiles with controlled room types, comfort concerns and use periods;
- correlates heat, cold and time within the same room before changing advice;
- keeps private room names and routines out of generated wording and installer opportunities;
- puts renter-portable actions before permission-dependent fixed work;
- builds a maximum-thirty-item permission checklist from tenure, strata context, the current plan, evidence gaps and controlled customer classifications;
- separates portable options, owner or agent questions, strata or shared-property questions, licensed or site checks, and evidence questions into five previewable sections;
- retains every authoritative licensed or site-check rule even when a customer selects another classification;
- keeps arbitrary customer titles, identifiers and note wording inside the signed-in project and replaces them with controlled reminders in the shareable checklist; and
- states that the checklist is not legal advice and does not grant or confirm permission.

Only controlled broad climate, room-type and comfort-concern aggregates, and known or unknown evidence counts can enter an installer opportunity. Exact postcode remains available only at the protected matching boundary and is returned as an empty value to installers before the existing contact-release workflow. Private room names, use periods, permission titles, permission notes and project-private notes are excluded.

Forward migration `0082_customer_advisor_profile.sql` adds `customer_projects.advisor_profile` as additive JSON text with default `{}`. The server owns normalization and climate derivation. That release used plan version `2026-07-29-evidence-climate-advisor`; the prior `2026-07-29-home-advisor` version remains a safe legacy regeneration input through the existing edited-plan conflict boundary.

## Independent customer plan release

`CUSTOMER-PLAN-DECISION-03` is deployed from exact application commit `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e`, first saved and published as Sites version 208.

The release:

- gives every canonical plan item bounded `Based on`, `Still uncertain` and `Could change if` guidance without a false confidence score;
- asks at most three deterministic, safe questions linked to controlled inputs and accepts `Not sure`;
- keeps a bounded customer-owned review worksheet private and requires a second explicit action before an accepted proposal becomes a private plan step;
- builds one escaped, privacy-filtered HTML and plain-text email document from the server-owned saved plan;
- adds one verified, active, owner-scoped delivery route with explicit recipient confirmation, recipient-bound idempotency and a fail-closed five-attempt hourly limiter;
- adds an accessible recipient dialog and an A4 browser print or Save as PDF surface;
- excludes exact location, account and project identity, private notes, room names and routines, filenames, meter information, review text and custom plan wording from shared output;
- reconciles public `/plan`, account handoff and `/plan/print` with the current canonical goals, tenure, approval, budget, home facts, rationale and question engine;
- improves project-preparation guide and draft-status contrast; and
- makes no NatHERS, authenticated assessor, price, savings, brand or provider-ranking claim.

The current plan version is `2026-07-29-decision-support-advisor`. Legacy edited ordering, removals and private custom steps remain protected by the existing conflict boundary. Private review and custom content cannot enter installer opportunities, permission exports or independent shared output.

## Customer plan evidence and history release

`CUSTOMER-PLAN-EVIDENCE-04` is deployed from exact application commit `6540ee671e64dbfdf80592283a1954b2ff482355`, first saved and published as Sites version 210 through deployment `appgdep_6a695ca742d081918d73196751713f98`.

The release:

- uses one categorized fourteen-question home-detail intake in public `/plan` and the signed-in project builder;
- supports several main goals, owner or renter tenure, approval context, budget and staging as separate decisions;
- distinguishes roof, wall and underfloor insulation condition plus glazing, basic blinds, higher-performing coverings and external shade in plain language;
- derives answered, `Not sure` and unanswered counts from the same authoritative question contract;
- adds one action to mark every unanswered home question `Not sure` and one email-dialog action to review missing details;
- uses one concise privacy-filtered projection for inline email HTML, plain text, public print, signed-in print and browser Save as PDF;
- keeps plan steps reorderable, removable and open to bounded home-specific additions;
- makes every new upload `private-plan` by default and requires explicit `allocated-installers` scope plus current consent before an allocated verified installer can view it;
- strips JPEG, PNG and WebP metadata before any accepted image category is stored;
- makes fact-link edits independent from installer-sharing consent;
- adds bounded owner-scoped plan revisions and private outcome check-ins with atomic revision numbering and retention limits; and
- prevents private file counts, private notes, filenames, exact location, room routines and custom plan text from entering installer or shared report output.

The current plan version is `2026-07-29-home-feature-taxonomy-v2`, the advisor profile version is `2026-07-29-advisor-profile-v3`, the document version is `2026-07-29-plan-document-v1`, and the concise report version is `2026-07-29-concise-report-v1`. Forward migration `0083_customer_plan_evidence_history.sql` adds evidence fact links and sharing scope plus private revision and outcome tables without rewriting applied history. The prior `2026-07-15`, `2026-07-29-home-advisor`, `2026-07-29-evidence-climate-advisor` and `2026-07-29-decision-support-advisor` plan versions remain accepted legacy inputs through the existing edited-plan conflict boundary. Household answers and linked files are not represented as professionally reviewed or verified, no NatHERS claim is made, and no price or savings outcome is guaranteed.

## Professional review, responsive print and everyday comfort release

`CUSTOMER-PLAN-PRO-PRINT-05` is deployed from exact application commit `ee75aadfd6800c01b92532b2d376a4a1e33c9d74`, first saved and published as Sites version 212 through deployment `appgdep_6a69c4f838bc8191a0e050da219ab4a6`.

The release:

- adds an optional self-declared accredited energy or home-comfort adviser review to the signed-in Goals stage;
- records a controlled role, adviser name, accreditation scheme or body, reference and bounded professional notes;
- requires the current declaration version at the server boundary and removes the declaration whenever an advice-affecting household, room, plan or adviser input changes;
- attributes the home-answer review to the named self-declared adviser while clearly stating that AEA did not independently verify the person, accreditation, reference, evidence or observations;
- preserves household-supplied wording when no current declaration is present;
- adds a deterministic, capped and product-neutral `Helpful things you can try now` section to public, signed-in, email and print outputs;
- covers moisture and ventilation, personal warmth, safe seasonal airflow, appliance controls and timers, window coverings and landscaping, and renter-friendly or bounded do-it-yourself options only when the recorded facts support them;
- keeps helpful actions separate from the ordered upgrade roadmap, quotes, permissions and installer matching;
- replaced top-level account-page printing with one isolated privacy-filtered temporary-frame lifecycle, including single-print guarding, cancellation, timeout, unmount, `afterprint` and idempotent cleanup boundaries; this historical mitigation later proved insufficient when the product owner reproduced a Chrome freeze and is superseded by the direct-PDF release; and
- wraps long adviser names, references and notes and preserves semantic report section headings in A4 output.

The current plan version is `2026-07-29-adviser-print-comfort-v3`, the advisor profile version is `2026-07-29-advisor-profile-v4`, the professional declaration version is `2026-07-29-self-declared-adviser-v1`, the document version is `2026-07-29-plan-document-v2`, and the concise report version is `2026-07-29-concise-report-v2`. No schema or migration changed. Earlier plan versions remain accepted through the existing edited-plan conflict boundary.

## Direct customer plan PDF download fix

`CUSTOMER-PLAN-DIRECT-PDF-06` is deployed from exact application commit `d5c675a5ceffa6e924df033e8cb8b505bb4d6336`, first saved and published as Sites version 214 through deployment `appgdep_6a69e79a91548191987f12631559cb1f`.

The release:

- replaces public and signed-in customer-plan browser printing with one shared direct-PDF download contract;
- projects only the normalized privacy-filtered report into the PDF, while the account path continues to save the exact plan before generation and the public path remains non-mutating;
- generates A4 bytes in a dedicated lazy worker so font embedding and layout do not block the page;
- uses `pdf-lib`, fontkit and locally bundled DejaVu Sans TrueType fonts, preserves supported Unicode and fails explicitly for unsupported glyphs;
- downloads an `application/pdf` Blob through a privacy-safe filename with duplicate-generation guards and bounded worker, Blob and object-URL cleanup;
- removes customer-plan iframe, `srcdoc`, `contentWindow`, `afterprint` and `window.print()` paths; and
- makes no schema or migration change.

The PDF format version is `2026-07-29-direct-download-pdf-v1`. The plan version remains `2026-07-29-adviser-print-comfort-v3`, the advisor profile remains `2026-07-29-advisor-profile-v4`, the professional declaration remains `2026-07-29-self-declared-adviser-v1`, the document remains `2026-07-29-plan-document-v2`, and the concise report remains `2026-07-29-concise-report-v2`.

The public version 214 download passed its release checks, but the signed-in path was not exercised. Product-owner testing then proved that the account action could freeze or fail because it synchronously saved the project and could decode, resize and JPEG-encode pending photos on Chrome's main thread before PDF generation. The later hidden synthetic link click could also be suppressed after the original user activation had expired. This release did not meet the signed-in operational outcome and is superseded by `CUSTOMER-PLAN-NATIVE-PDF-07`.

## Browser-native customer plan PDF reliability correction

`CUSTOMER-PLAN-NATIVE-PDF-07` is deployed from exact application commit `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642`, saved and published as Sites version 216 through deployment `appgdep_6a69f763e0b08191b6ac8539e0828d84`.

The correction:

- creates the privacy-filtered report directly from the current in-memory plan and never saves the project, prepares photos, uploads evidence or calls a customer-project API from the PDF action;
- submits one synchronous same-origin form request and returns a standard `application/pdf` attachment, preserving the real user gesture without a print dialog, client worker, font fetch, Blob URL or hidden synthetic-link click;
- generates the bounded A4 report at the edge with `pdf-lib` standard fonts and safe fallbacks for unsupported display characters;
- rejects cross-origin, wrong-content-type, malformed, oversized and unbounded report requests;
- removes the client PDF worker, fontkit and bundled DejaVu dependencies, eliminating about 2.76 MB of cold worker and font requests;
- excludes `/account` and all `/account/*` HTML from shared edge caching and returns `private, no-store, max-age=0`, so a fresh navigation cannot receive a stale customer-dashboard shell; and
- makes no schema or migration change and does not alter working-demo data.

The PDF format version is `2026-07-29-native-response-pdf-v2`. The plan, advisor profile, professional declaration, document and concise-report versions remain unchanged.

## Premium customer plan PDF and email report

`CUSTOMER-PLAN-PREMIUM-REPORT-08` is deployed from exact application commit `fb6cacf8b0309a3fc26b40a43da5b025050d22d2`, saved and published as Sites version 218 through deployment `appgdep_6a6a11c02e088191bb27cc302c8b35af`.

The release:

- adds one shared design and customer-copy contract for A4 PDF, responsive email HTML and plain text;
- replaces the dense report export with a branded cover, home snapshot, prominent first three actions, later roadmap, everyday comfort advice, plan confidence, professional attribution, trade checks and privacy;
- uses readable ten-point PDF body copy, editorial serif headings, compact page furniture and the site's navy, teal, green, mint and warm warning palette;
- keeps recommendation cards together across page breaks and gives completed plans an explicit progress state instead of an empty priority section;
- creates real allowlisted same-origin PDF link annotations with customer-friendly labels and no raw visible URL;
- uses a table-based, inline-styled 640-pixel email that stacks at narrow widths and contains no remote image dependency;
- preserves exact household and self-declared professional boundaries, private-field exclusions and safe HTML escaping;
- preserves the synchronous native form download, no-store response, route bounds and zero-mutation customer-project contract; and
- makes no schema or migration change and does not alter working-demo data.

The PDF format version is `2026-07-29-premium-report-pdf-v3`, the report version is `2026-07-29-premium-report-v3`, and the shared design version is `2026-07-29-premium-report-v1`. The plan, advisor profile, professional declaration and document versions remain unchanged.

## Technical customer plan presentation release

`CUSTOMER-PLAN-TECH-PRESENTATION-09` is deployed from exact application commit `f401575a5bf463b85c7688424db0b99dddd220c5`, saved and published as Sites version 220 through deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f` with environment revision 19.

The release:

- replaces the temporary PDF initials tile with the exact 96 by 96 transparent AEA navigation mark from one shared in-source asset;
- serves that same mark to email from `https://compare.ausenergyassessments.com/api/aea-brandmark` with a stable PNG response and immutable public caching;
- gives PDF and responsive email a more distinctive technical presentation using the site's deep navy, electric blue, teal, aqua, green, mint and warm warning palette;
- improves hierarchy and spacing across the branded cover, plan signals, lead home fact, remaining snapshot, first actions, later roadmap, everyday ideas, confidence, trade checks and privacy;
- retains the same normalized, privacy-filtered report content across PDF, HTML email and plain text;
- preserves the exact household-supplied or self-declared professional evidence boundary once in the PDF instead of repeating or weakening it;
- gives a completed plan truthful progress signals, including all steps complete and zero left to plan, without inventing a next action;
- preserves same-origin guide annotations, customer-friendly labels, bounded edge generation, native attachment download and zero project or evidence mutation; and
- makes no schema or migration change and does not alter working-demo data.

The PDF format version for that release is `2026-07-30-tech-presentation-pdf-v1`, the shared design version is `2026-07-30-tech-presentation-design-v1`, and the report version remains `2026-07-29-premium-report-v3`. Sites versions 218 and 219 are historical premium-report application and documentation checkpoints; version 220 is the historical technical-presentation checkpoint superseded by the spacing release below.

## Customer plan spacing and rounded-surface release

`CUSTOMER-PLAN-SPACING-10` is deployed from exact application commit `e74c2d95889a381cb3bb434607bc6584e54cf722`, saved and published as Sites version 222 through deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28` with environment revision 19.

The release:

- centralises PDF and email spacing, padding and radius values in the shared report design module;
- gives repeated PDF information, priority, roadmap, snapshot, comfort and closing panels the same measured internal rhythm;
- uses clipped cubic-Bezier rounded paths for gradient surfaces so their corners cannot remain square behind a rounded border;
- softens PDF logo surrounds, metric tiles, number badges and accent bars without changing report facts;
- gives email 40 px desktop and 32 px mobile section spacing, 16 px tile gaps, 20 px content padding and 16 to 22 px radii;
- separates each everyday action into an individual rounded email tile and adds a visible gap between stacked mobile snapshot cells;
- removes transport-only whitespace so the maximum-content email remains below the existing 60,000-byte guard;
- preserves the exact AEA mark, customer wording, privacy projection, evidence boundary, same-origin annotations, native attachment route and provider controls; and
- makes no schema, migration, account, customer, project, trade, wholesaler or evidence-data change.

The PDF format version is `2026-07-30-tech-presentation-pdf-v2`, the shared design version is `2026-07-30-tech-presentation-design-v2`, and the report version remains `2026-07-29-premium-report-v3`. Sites version 220 is the historical technical-presentation source; version 222 is the historical spacing application source superseded by the trust release below.

## Customer plan trust, evidence and revision release

`CUSTOMER-PLAN-TRUST-11` is deployed from exact application commit `bc427d295b3106907904a3c0b7bf9f2945561cd1`, saved and published as Sites version 224 through deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2` with environment revision 19.

The release:

- uses one semantic premium report renderer for public `/plan/print` and the accessible signed-in preview dialog;
- repeats the complete applicable plan action set after the final ordered step so `Preview full report`, `Email this plan`, `Download PDF` and conditional `Reset advisor suggestions` remain available without a return scroll;
- adds optional guided photo capture with deterministic categories, three explicit safety and privacy confirmations, rear-camera preference, local preview, a 12-photo bound and the existing owner-scoped private evidence path;
- keeps meter-box guidance to a safely accessible closed exterior and never asks a customer to climb, enter a roof space, disturb insulation or remove a cover;
- adds immutable owner-scoped plan revisions through `0084_customer_plan_revision_restore.sql`, bounded retention and comparison of goals, home facts, pace, budget, plan version and ordered-step changes;
- requires explicit confirmation for draft-only restore and preserves project identity, address, work categories, private notes, adviser details, evidence, sharing permissions, quotes and installer activity;
- uses a typed `PLAN_REVISION_CONFLICT` boundary so only stale revision conflicts offer an explicit reload, while unrelated `409` business errors preserve their server message and unsaved edits remain mounted;
- adds PDF format `2026-07-30-tagged-plan-pdf-v3` with `en-AU` language, document and section structure, reading-order references, link objects and artifacts, but does not claim PDF/UA conformance;
- keeps the full saved plan and PDF authoritative while adaptively constraining only extreme email rendering below 88,000 HTML bytes;
- discloses every email-only shortening or omission in HTML and plain text and changes provider success wording so acceptance is not presented as inbox delivery; and
- preserves the exact AEA mark, premium visual system, normalized customer facts, evidence boundary, no-store delivery and zero project or evidence mutation during PDF download.

The release used synthetic report and email data only. No real email was sent, no real or working-demo account project was created or saved, no evidence was uploaded and no native print API was invoked. Controlled delivered-client acceptance in Gmail and Outlook and an independent PDF accessibility conformance audit remain unknown and are forward gates, not release claims.

## Customer project cleanup release

`CUSTOMER-PROJECT-CLEANUP-12` is deployed from exact application commit `da35ce60295d6c7150cddd9b35e33fcf64c8521b`, saved and published as Sites version 227 through deployment `appgdep_6a6b22db21c48191a2dedbdbf05274ef` with environment revision 19.

The release:

- places a compact, quiet `Delete draft` control beside the primary `Continue project` action on draft cards;
- keeps permanent deletion absent from every non-draft project card and removes the confusing draft archive action from project details;
- uses a labelled confirmation dialog with `Keep draft` focused first, forward and reverse Tab containment, Escape cancellation, background scroll lock and protected busy-state dismissal;
- requires same-origin Firebase authentication, an active owning customer account, explicit confirmation and matching plan-revision plus update-time tokens;
- forces the destructive action through HTTP `DELETE` so the existing PATCH action surface cannot request permanent deletion;
- refuses submitted projects and any project connected to opportunity, quote, contact-release, appointment, arrival or handover activity;
- selects private evidence object keys only on the server, removes R2 objects before owner-scoped dependent records and deletes the project row last;
- retains a retryable private draft and never reports success when object or database cleanup fails;
- keeps project-detail controls content-sized and top-aligned instead of stretching buttons through a long roadmap; and
- preserves readable primary action labels by overriding the older project-footer link colour at the exact component boundary.

Application commit `9ecde96f8975f322be35283747cb7fe93b2579f9` was the validated core implementation and was published as intermediate Sites version 226. The first signed-in visual check found that an older, more specific link-colour selector hid the `Continue project` label against its green background. Corrective child `da35ce60295d6c7150cddd9b35e33fcf64c8521b` added the narrow selector override and regression assertion, passed the complete release gate and superseded version 226 as version 227.

Live verification used an existing working-demo account only for read-only inspection. Four draft cards exposed the new delete control, the installer-matching card did not, the confirmation was opened and cancelled with `Keep draft`, and an existing project detail showed compact controls. No delete confirmation was activated, no project was edited and no demo account, project, evidence or workflow record was created or removed.

## Customer roadmap context release

`CUSTOMER-ROADMAP-CONTEXT-13` is deployed from exact application commit `0db488f325a79e22d126aace75647715b59c96f9`, saved and published as Sites version 229 through deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24` with environment revision 19.

The release:

- renames the five formal project stages to Home, Plan details, Your roadmap, Quote prep and Privacy;
- gathers goals, five bounded home basics, detailed home facts, considered work, room context, budget and pace before roadmap generation;
- gives home height, approximate age, floor area, roof type and switchboard state explicit `Not sure` answers and safe explanatory hints;
- derives compatibility priorities from the selected goals on the server, ignoring a conflicting client priority payload when goals exist;
- uses home basics and considered work in the canonical plan, `What shaped this roadmap` summary, saved plan snapshot, bounded revision comparison and restore, PDF and email;
- preserves current context and work choices when restoring a legacy revision that predates those fields;
- keeps current approval and access context outside revision restore;
- limits quote preparation to quote-stage facts, access constraints, optional evidence and private notes; and
- removes the repeated priority selectors from quote preparation and privacy review.

The exact application source passes the focused 85-test workflow, document, revision, taxonomy and enquiry set. The complete `npm.cmd run validate` gate passes: type checking, warning-free lint, 31 of 31 integration tests, the full 868-test suite with 866 passed, 2 intentionally skipped and 0 failed, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. The saved archive is 6,464,162 bytes with SHA-256 `F786B36378B6D9E2912527C2D146600610D1FE52CAC79CCD969E35E7D8FD9C73`.

The signed-in production project was reloaded after publication. Step 2 showed goals, the five home basics, detailed home categories, considered work, room profile, budget and pace. Step 3 showed `What shaped this roadmap` with goals, tenure, home basics, current home answers, considered work and budget or pace. Step 4 showed quote-only information and a read-only work summary, with no repeated priority selector. Live `/api/health` returned HTTP `200`, `Cache-Control: no-store` and `{"ok":true,"service":"aea-energy"}`. The recent Sites worker error-only query returned zero events. No working-demo answer, project, evidence item, account or email was created, saved, edited or deleted.

## Customer installer request completion release

`CUSTOMER-INSTALLER-REQUEST-14` is deployed from exact application commit `2607cc53f2e4c79546701e29d3d182fde4670952`, saved and published as Sites version 230 through deployment `appgdep_6a6b5469c8bc81919f0e2c9ef22da602` with environment revision 19.

The release:

- gives valid saved stages a green completed state, check mark and accessible completion label;
- opens the reusable `Where should the installer work?` dialog from the request action instead of placing missing-contact guidance at the top of the project;
- collects phone number, street address, optional unit detail and suburb while deriving postcode and state from the owned project;
- saves only private contact and derived location fields against the active owning customer profile and exact observed revision;
- retains the existing withheld-during-matching and named contact-release boundaries;
- uses an idempotent request identifier, exact project update token and bounded recovery fingerprint to reconcile uncertain submission results;
- prevents a recovered matching or quote-review project from accepting a contact change without an explicit recovery flag and profile compare-and-swap; and
- presents a clear success state with a direct return to the customer overview.

The exact application source passes 44 of 44 focused installer-request, profile, recovery, project and UI regressions. The complete `npm.cmd run validate` gate passes: type checking, warning-free lint, 31 of 31 integration tests, the full test suite, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. Independent final review closed all P1 and P2 findings. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. The local release archive is 6,471,181 bytes with SHA-256 `4A8A79645C5F3C27D07B7069B481DD013EBB0E739FA83A16263783E3027EBE91`.

The signed-in production project showed `Plan details, complete` with a green check, green text and accessible completion state. The request action opened the centred private-details dialog with phone, service street address, optional unit detail, suburb, project postcode and state in context. Required-field guidance remained inside the dialog, and the dialog was closed without entering or saving customer contact data. No profile revision, project, evidence item or installer request was created or changed.

## Customer plan durability, evidence and history release

`CUSTOMER-PLAN-DURABILITY-15` was implemented in `e74278c8b62c569541ea84b5a431917d03a1c13a`. That commit was saved as Sites version 231, but deployment `appgdep_6a6bcf5c0f7c8191b877d27581f9d82e` failed before public activation with `__dirname is not defined` because the generated Worker contained a private Next Fontkit runtime. Saved identity `appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda` is failed non-live evidence only. Version 230 remained public throughout that failed attempt.

Corrective child `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` replaced the private runtime with public `@pdf-lib/fontkit`, added an audited production-bundle boundary and became the executable source for Sites version 232. It is saved under `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8` and was deployed through `appgdep_6a6bd28a71888191be19f89db9b82ca5` with environment revision 19 before version 233 superseded it.

The release:

- shows pending and saved guided-photo previews, filenames and progress in the exact prompt where the customer added them, with save/reload, replacement and removal handling;
- preserves guided photos if later work selections change while excluding generic evidence, empty slots and PDFs from that retained group;
- adds stable capture slots, metadata stripping, resumable multipart private uploads and compare-and-swap retake or removal;
- keeps draft deletion in a durable `deleting` state, freezes evidence writes, supports recoverable D1 and R2 cleanup and suppresses normal active, recommended, continue and edit behavior;
- replaces opaque revision numbers with plain labels, two-version comparison, a privacy-filtered export, private household check-ins and guarded draft-only restore;
- saves the latest private profile and submits the installer request from one confirmation with one bounded authoritative conflict recovery and no replay of project, evidence or request writes;
- embeds Liberation Sans, retains a tagged-document foundation, semantic lists and links, and fails before save when the current fonts do not support supplied text; and
- uses document format `2026-07-31-tagged-plan-pdf-v6` with public `@pdf-lib/fontkit` and a build gate that rejects `__dirname` or the private Next Fontkit marker in the Sites server bundle.

The focused PDF and email correction set passes 18 of 18. The complete `npm.cmd run validate` gate passes: type checking, warning-free lint, 31 of 31 integration tests, 914 total tests with 912 passed and 2 intentionally skipped, all 86 migrations through `0085_customer_evidence_resumable_retake.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. The nine-page tagged-PDF audit was rendered and inspected page by page with no clipping, overlap, missing glyph, harsh corner, spacing or footer defect. Unsupported scripts fail before save instead of producing replacement characters. `git diff --check` and the Sites server-bundle audit pass.

GitHub `main`, the working branch and Sites managed `main` contain exact application SHA `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`. The local release archive `aea-sites-7e1f0a8.tar.gz` is 7,085,796 bytes with SHA-256 `9555352A7F723A615F2D97E2BFEE736DCD6D491C4189B5E100D179D7CB121974`. Sites reports 311 stored archive files, 27,760,640 bytes and content hash `sha256:e48b4226de4114a1c68ab45ed29021778470a3333b477a44131f07b080e5f2f0`.

Signed-in production inspection loaded the saved roadmap, plain-language two-version comparison, privacy-filtered summary action and private check-in UI. A selected working-demo photo remained visibly named with `Added privately to this draft` directly inside its matching guided card. No photo, project, profile or installer request was saved, replaced, removed or submitted. The post-deployment Sites Worker error-only query returned zero events. Real Outlook desktop, independent assistive-technology or PDF/UA acceptance, pan-Unicode rendering, pixel-level redaction and restoration of a browser `File` object across a full reload remain unverified forward work.

## Customer installer request and multi-photo release

`CUSTOMER-INSTALLER-PHOTOS-16` is released from exact application commit `5acc4ccf37acd608dc437d3a074410b1d840f706`. Production logs from the reported failure showed the project draft save returning `200`, followed by two `409` profile saves and no installer-request submission. Source and local trigger reproduction proved the profile row was updated successfully, but D1 reported three total changes because `tlink_customer_search_update` also deletes and reinserts the search row. The API incorrectly required exactly one change and therefore returned a false revision conflict after committing the update.

The release:

- treats any positive conditional profile or request-submission change count as success while preserving zero as the real compare-and-swap conflict;
- covers both the customer-profile search trigger and the triggered trade-opportunity insert;
- keeps the one-confirmation flow, bounded uncertain-response reconciliation and idempotent request boundary;
- allows several independent photos under one guided prompt and renders every saved and pending photo in that section;
- provides per-photo retake, replace, remove or cancel controls plus `Add another photo` and `Choose another photo`;
- keeps earlier-selection photos grouped and visible;
- retains same-origin authentication, owner scope, private-by-default storage, metadata stripping, 8 MB per-file validation, the 12-file project cap, client-upload idempotency and exact-photo replacement locking; and
- applies `0086_customer_evidence_multi_photo_prompts.sql`, which removes only the obsolete active-prompt and in-progress-prompt uniqueness indexes.

The focused request, recovery, profile, project, evidence and guided-photo set passes 55 of 55. Exact application commit `5acc4ccf37acd608dc437d3a074410b1d840f706` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 916 total tests with 914 passed and 2 intentionally skipped, all 87 migrations through `0086_customer_evidence_multi_photo_prompts.sql` against fresh SQLite and Cloudflare D1 paths, the tagged-PDF audit, Vinext production build and Sites server-bundle audit. `git diff --check` passes.

GitHub `main`, branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-5acc4cc.tar.gz` is 7,086,372 bytes with SHA-256 `B110B28AE3F5D1A5256E478C20D44A5727084C51C6D0159FA20E91D31F6D69B0`. Sites reports 312 stored files, 27,770,880 bytes and content hash `sha256:47e85a2c9289437ee38c3c478a6191687e46ffec393215a59092ac1185bc8c6f`.

Sites version 233 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_218ad21977748191a3283723f395cadd` and deployed through `appgdep_6a6be56ca9ac8191918423bd57f0a05d` with environment revision 19. Signed-in production inspection loaded the quote-preparation photo cards, privacy review and the active `Save details and request responses` modal. Customer-account and customer-project reads returned `200`; the post-deployment Worker error-only query returned zero events. The dialog was closed without saving a profile, submitting another working-demo request or changing project evidence.

## Authoritative customer installer submission release

`CUSTOMER-INSTALLER-SUBMIT-17` is released from exact application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b`. Production reproduction showed the modal contact PATCH returning `200`, followed by the project submission falsely reporting that the street address was missing. The submit query selected the raw D1 column `address_line_1`, while the shared readiness helper checked only camel-case `addressLine1`. Contact had already been committed, but the split client/server flow then rejected its own authoritative data.

The release:

- sends modal contact in the customer-project submission rather than performing a separate profile PATCH;
- validates phone, street, unit and suburb at the server boundary while deriving postcode and state from the owner-scoped project;
- persists contact, transitions the project, creates the installer opportunity and records consent in one guarded D1 batch;
- preserves project revision protection while removing the obsolete client-side profile revision token and retry loop;
- normalises both raw D1 snake-case and API camel-case address projections at the shared readiness boundary;
- makes matching and quote-review replays idempotent contact updates without duplicating opportunity or consent records;
- rejects terminal project states rather than returning a false success;
- returns the normalised saved profile and refreshed project state to the client; and
- keeps identity and contact withheld during matching until the customer separately approves direct contact.

The focused authoritative-submit set passes 50 of 50. Exact application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 915 total tests with 913 passed and 2 intentionally skipped, all 87 migrations through `0086_customer_evidence_multi_photo_prompts.sql` against fresh SQLite and Cloudflare D1 paths, the tagged-PDF audit, Vinext production build and Sites server-bundle audit. `git diff --check` passes. An independent final semantic review found no remaining actionable submit-flow issue.

GitHub `main`, branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-7d7a821.tar.gz` is 7,086,533 bytes with SHA-256 `22DE94F3E9B22493FF79ED9DC70FF62F6D8B7259DC02AEB93E33B28445EEF2C3`. Sites reports 312 stored files, 27,770,880 bytes and content hash `sha256:3ffeb4fb493c6426cb78aceb8792de7e2e65830181d410c23d53ea9a8a87cc9f`.

Sites version 234 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_06f96686a8dc8191a0e01c2555c2de1b` and deployed through `appgdep_6a6bf3695b6081918ce2a9dd77bc3869` with environment revision 19. Signed-in production verification opened project `154aee4d-3648-4c7c-b393-c6715c518b24`, confirmed the screenshot-equivalent modal contact and selected `Save details and request responses`. Request `a238af3e5f81164e` returned HTTP `200`; the dialog reported `Request sent`, the account overview reported `Installer matching`, and the post-deployment Worker error-only query returned zero events.

This live verification intentionally changed working-demo data: that project moved from draft to installer matching, transactionally created the opportunity and consent records, and triggered normal administrator-notification and allocation processing. The HTTP `200` submit proves the guarded transaction completed; it does not independently prove downstream allocation rows because allocation failures are intentionally isolated from customer submission. No real customer, trade or wholesaler account was involved.

## Installer enquiry pack, approved evidence and business notification release

`INSTALLER-ENQUIRY-PACK-18` is deployed from exact application commit `eeba3679c30789cfe2e633a913a18492270fcc3e`.

The release:

- derives one bounded installer enquiry pack from the authoritative customer-plan document;
- shows goals, plan boundary, controlled home context, quote readiness and the first three ordered roadmap steps high in the matching lead;
- excludes customer and account identity, contact, exact location, private notes, room names and routines, permission notes, adviser identity and review text, arbitrary customer plan items, evidence filenames and meter data;
- reports the approved-evidence count and lazy-loads images only after the exact allocated installer selects `Show approved photos`;
- keeps PDFs behind an explicit protected download and reuses the authenticated, audited installer-evidence endpoint;
- rechecks reviewed-installer access, exact allocation, opportunity state and active evidence-sharing consent at every evidence read;
- opens notification links directly in the signed-in Leads workspace;
- enqueues exactly one durable business notification when a new match is created, without backfilling historical matches;
- dispatches outside the customer request, rechecks installer eligibility, consent, current recipient and suppression immediately before send, retries bounded synchronous delivery failures with frozen content, and treats terminal provider callbacks monotonically;
- limits the notification email to business name, state, service labels, timing or expiry, approved-evidence count and the signed-in Leads link;
- stops awaiting the independent administrator webhook during customer submission; and
- runs independent owner and project hydration reads concurrently before the authoritative transaction.

Focused notification tests pass 10 of 10, the enquiry-pack privacy and UI contract passes 3 of 3, and the related submit, contact and cron regressions pass. Exact application commit `eeba3679c30789cfe2e633a913a18492270fcc3e` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 931 total tests with 929 passed and 2 intentionally skipped, all 88 migrations through `0087_trade_opportunity_notifications.sql` against fresh SQLite and Cloudflare D1 paths, the tagged-PDF audit, Vinext production build and Sites server-bundle audit. `git diff --check` passes. Independent implementation and notification reviews were closed before publication.

GitHub `main`, branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-eeba367.tar.gz` is 7,098,588 bytes with SHA-256 `326DD4224505C9364A8D2852877D4037C397422788F97394B00A0EA9D80D48F1`. Sites reports 313 stored files, 27,822,080 bytes and content hash `sha256:7eea5f36d7a31df1213c163a8d0f836b6f02dd18e3bdc6a60cc5cc5831b24121`.

Sites version 235 from `eeba3679c30789cfe2e633a913a18492270fcc3e` is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_0fac9e3297808191afc57d58d9377584` and deployed through `appgdep_6a6c0908063081919b2e985a27141e34` with environment revision 19. The required Resend environment names are present and the post-deployment Worker error-only query returns zero events.

No new working-demo match was created after this release, so no opportunity email was sent and the measured production submit duration was not repeated. The pre-release working-demo lead is intentionally not backfilled. Chrome control could list but not reliably claim the existing signed-in trade tab; the stable in-app browser reached the expected signed-out account gate. The automated privacy, API, UI, migration and delivery contracts pass, but live signed-in Leads/photo presentation, real provider delivery and the reduced production submit duration remain unverified. Deployment identity is verified; release acceptance is incomplete until those bounded checks are performed with dedicated non-customer fixtures.

## Complete customer-installer handoff release

`CUSTOMER-INSTALLER-HANDOFF-19` is deployed from exact application commit `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb`.

The release:

- records one durable dispatch job in the authoritative customer-request transaction before returning compact HTTP `202`;
- drains allocation, operations email and business email outside the customer response with `waitUntil`, while the scheduled Worker remains the recovery path;
- retries provider work with bounded backoff and does not mark the dispatch complete while any exact admin or trade delivery is still outstanding;
- lets an explicit resubmit revive only exhausted pending or failed dispatch jobs, preserving completed and actively processing jobs;
- independently attempts the operations alert so an allocation failure cannot suppress it;
- treats offered, viewed, interested and connected allocations as eligible for their exact business alert;
- turns final project-request consent into explicit sharing of every active image that existed at that request boundary, while arbitrary PDFs and documents retain their separate explicit sharing choice;
- provides an owner-only `Share all project photos` repair for an existing matching or quote-review working-demo project without manufacturing historical allocations;
- replaces the first-three-step extract with the complete ordered privacy-safe plan, protected preview and protected PDF for the exact reviewed and allocated installer;
- renders every authorised evidence card, loads image previews concurrently, preserves partial success and keeps a protected download when a preview fails;
- clears protected plan and evidence state before sign-out or user change, revokes object URLs and blocks stale asynchronous responses from repopulating another user session; and
- reports checking, plan save, per-photo upload percentage and request dispatch in the modal, with reassurance after eight seconds and a longer-delay message after 25 seconds.

The complete non-release-integrity suite passes 941 tests with 939 passed, 2 intentionally skipped and 0 failed. The backend-focused dispatch, timing, notification and property-arrival set passes 32 of 32. Type checking, warning-free lint, all 89 migrations through `0088_customer_opportunity_dispatch_jobs.sql`, the tagged-PDF audit, the Vinext production build and the Sites server-bundle audit pass. `git diff --check` passes. Independent integrated QA found no remaining actionable privacy, idempotency, notification, progress, authentication-transition or migration issue.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-059f2ff.tar.gz` is 7,107,950 bytes with SHA-256 `D32307C4B0FABF955FB4CF878CBD31290F053E06BA3CA67A92DBFBED6FD262E4`. Sites reports 318 stored files, 27,873,280 bytes and content hash `sha256:6c489fbaa560f2df5dc6cb9d807d1ae7c1d7b7a752632909bc45bc1f71a9c090`.

Sites version 236 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8` and deployed through `appgdep_6a6c3b56a1b881919e82e97eaa286bc4` with environment revision 19.

The executable application and deployment identity are verified. Signed-in production presentation, measured production submit duration and provider inbox receipt are not yet claimed. Automated authorization, privacy, idempotency, retry, progress and complete-projection contracts pass, but those live acceptance checks require the existing working-demo sessions and must not be inferred from configuration.

## Customer quote communications and discovery release

`CUSTOMER-QUOTE-COMMS-20` is deployed from exact application commit `35552796048df63c03409d03401d33a47f326434`.

The release:

- queues a customer email when an approved installer submits a new structured quote;
- queues an installer email when the customer accepts that exact quote and records the same accepted event in the trade Work updates bell and dialog;
- adds a top-level customer Quotes centre so waiting and accepted responses are visible without opening each project and scrolling through its detail;
- uses exact owner-scoped project and quote deep links from both email and dashboard surfaces;
- makes installer quote submission retry-safe through one durable request and revision ledger, with exact target fetch after submission;
- gives each project one durable accepted-quote claim so a stale competing acceptance cannot withdraw the winner, create a false acceptance event or replace the chosen installer, while a retry for the same accepted quote remains idempotent; and
- records authenticated Resend callbacks monotonically and preserves bounded retry processing for eligible frozen delivery payloads.

The exact application commit passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 973 total tests with 971 passed, 2 intentionally skipped and 0 failed, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the tagged-PDF audit, the Vinext production build and the Sites server-bundle audit. The focused customer quote-communications set passes 26 of 26 and the focused Resend callback set passes 7 of 7. `git diff --check` passes.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-3555279.tar.gz` is 7,110,732 bytes with SHA-256 `387A5D0FC4A5BF74DB78964348EC3577457818FBC9BC35F86BCFF1C04F83B616`. Sites reports 321 stored files, 27,965,440 bytes and content hash `sha256:291666539b26173a276dc09c76bbba6e94955b434d6ab5f524b850e5cda6ad52`.

The documentation-only commit `40b4396b9ef41166a61ee346b023c00bcc9df11b` was saved as Sites version 237 with identity `appgprj_6a550c378000819185caf094173422bb~appgver_a2882f3eb264819199cedf74de7add75`, but it was never deployed. Sites version 236 stayed public until the exact version-238 application source was ready. Sites version 238 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_c9b4dbcee8408191a3fdce1aaef5548d` and deployed through `appgdep_6a6c5f96df388191a5e68ffd53fb68b0` with environment revision 19 at the custom domain.

The historical executable identity was Sites version 238 from `35552796048df63c03409d03401d33a47f326434`.

Signed-in Chrome verification confirmed that the top-level customer Quotes centre showed the accepted quote and the trade Work updates bell and dialog showed the accepted event. Opening the dialog moved focus into it and closing restored focus to the trigger. Production provider inbox receipt, provider credentials and sender approval, and hosted activity, delivery and acceptance-claim row counts remain unverified. Those provider-side and hosted-data facts are not inferred from source, local validation, environment-name presence or the signed-in visual check.

## Customer-to-trade contact and compact lead workflow release

`CUSTOMER-TRADE-CONTACT-21` is deployed from exact application commit `97e6c7356483706e8e978ab53b842a9e41152f7e`.

The release:

- replaces the customer shortlist and acceptance sequence with one `Get in touch with this business` action;
- states before and after the handover that contact permission does not accept a quote, create a contract or invoice, make a payment, or authorise work;
- commits the exact one-business claim, contact release, match connection, competing-option closure, consent receipt, activity event and durable installer follow-up in one owner-scoped batch;
- retains the legacy internal `accepted` identifier only for compatibility with the existing one-business claim, while refusing to let a legacy flag create first-time contact disclosure;
- derives one deterministic unread `New lead ready to review` Work update for the exact business that owns each new allocation, with no customer identity or private household content in the notification;
- collapses lead cards by default, retains a compact work summary and lets exact deep links expand and focus the authorised lead;
- groups structured quote inputs into aligned responsive price, timing and warranty sections without changing integer-cent calculations or immutable submissions; and
- focuses and scrolls the customer to the active project-builder heading after Continue, after the next panel renders and with reduced-motion support.

The exact application commit passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the full test suite with no failures and 2 intentionally skipped tests, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the customer-plan PDF audit, the Vinext production build and the Sites server-bundle audit. The integrated focused customer-contact, lead-notification, trade-card, quote-layout and navigation set passed 68 of 68 tests; additional direct-trade and business-hub coverage passed 16 of 16; and the final privacy regression set passed 35 of 35. `git diff --check` passed.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA. Local archive `aea-sites-97e6c73.tar.gz` is 7,127,725 bytes with SHA-256 `BF9EAAE34B1FBB197C30AF94F0ADB9DBE92BBC347F8B60424C6D0444D9FCD7DF`. Sites reports 321 stored files, 27,985,920 bytes and content hash `sha256:8554bdbdbcc6c54afc9b04cb4d37b96d7ab423ed2ed64d591247bfa3ee6c6136`.

Sites version 239 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c` and deployed through `appgdep_6a6c7cb6d6e0819187e9566a452e6850` with environment revision 19 at `https://compare.ausenergyassessments.com`.

Signed-in Chrome verification confirmed three unread new-lead bell items, the `New lead ready to review` wording and exact lead target, default-collapsed lead cards, exact expansion, the customer Quotes centre and the connected-state contact-only disclosure. Release QA did not submit a quote, release another contact, send a new provider email or mutate working-demo data. The Sites error-only query returned two informational canceled GET invocations caused while pages were reloaded and no Worker exception attributable to this release. A direct `/api/health` browser navigation was blocked by the local client extension and is not claimed as a successful health probe. Production provider inbox receipt and hosted row counts remain unverified.

## Customer plan trade enquiry and home-fact refinement release

`CUSTOMER-PLAN-TRADE-ENQUIRY-22` is deployed from exact application commit `b40c101939eec44b178b34ccb6397a989d2467d0`.

The release:

- replaces the public roadmap account-only continuation with `Enquire with verified trades` at both the roadmap action row and the actual bottom of the completed plan;
- explains the private account boundary before sign-in or account creation: the household can save its plan, ask for installer responses and compare inside AEA before choosing whether one verified business receives direct contact details;
- carries the exact selected public roadmap query into the account bridge, avoiding repeated owner or renter, goal, budget and home-fact entry;
- separates gas storage hot water, continuous-flow gas hot water and `Not sure`;
- records a household-reported single-phase, three-phase or unknown electricity clue without treating it as verified capacity, and directs the customer to an existing record, safe front-on photograph or licensed electrician rather than unsafe inspection;
- records whether kitchen and bathroom exhausts discharge outside, into the roof cavity or are not known, separately records a visible self-closing or backdraft damper clue, and prohibits entering the ceiling or dismantling equipment to answer;
- keeps anonymous and collapsed trade leads privacy-safe while making the released customer name the connected lead heading and placing the one authorised phone, email and service-address block first after expansion; and
- preserves the exact-match active contact-release gate, accessible expand and collapse relationship, and one non-duplicated customer-contact presentation.

The integrated focused customer plan, account bridge, taxonomy, trade identity and privacy set passed 99 of 99 tests. Independent public-plan coverage passed 52 of 52 tests plus type checking. The focused connected-trade set passed 13 of 13 tests. The complete `npm.cmd run validate` gate passed type checking, warning-free lint, 31 of 31 integration tests, 994 total tests with 992 passed, 0 failed and 2 intentionally skipped, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the nine-page customer-plan PDF audit, the Vinext production build and the Sites server-bundle audit. `git diff --check` passed.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain exact application commit `b40c101939eec44b178b34ccb6397a989d2467d0`. Sites version 240 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40` and deployed through `appgdep_6a6c971b63988191a92e4031fc74692b` with environment revision 19 at `https://compare.ausenergyassessments.com`.

The historical executable identity for that release was Sites version 240 from `b40c101939eec44b178b34ccb6397a989d2467d0`.

Live verification confirmed two `Enquire with verified trades` actions, including the true plan-bottom action. The selected handoff retained owner tenure, continuous-flow gas hot water, the reported three-phase clue, cavity-discharge exhaust and the visible damper clue in the query. The account privacy screen explained why an account or sign-in was required. A connected trade lead showed the released customer identity and contact block first after expansion. The post-deployment Sites Worker error-only query returned zero events. Verification did not create an account, save a plan, submit an enquiry, change a release or mutate production data.

No Sites version 240 release archive was uploaded or recorded, so no archive hash, stored-file count, stored-byte total or content hash is claimed. Production provider inbox receipt and hosted row counts remain unverified.

## Customer account trust and plain household ventilation release

`CUSTOMER-ACCOUNT-TRUST-23` is deployed from exact application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`.

The release:

- replaces separate customer-facing exhaust-discharge and backdraft-damper questions with one shared visible-fan question used by public `/plan` and the signed-in project builder;
- asks whether a kitchen exhaust fan or rangehood and a bathroom exhaust fan are fitted, while retaining explicit `No fans` and `Not sure` choices;
- tells the household that it does not need to know where a fan vents or whether it has a shutter or damper;
- maps retained legacy technical ventilation answers conservatively to `Not sure` unless a newer explicit fan answer already exists;
- keeps any later discharge-path investigation with a property manager or suitably qualified trade when moisture, steam or smells do not clear;
- gives every email-account input, including the password, a visible full-width control with a persistent requirement and field-associated errors;
- presents equal-width responsive create-account and sign-in tabs with a clear selected state and keyboard focus;
- supplies Firebase's hosted verification handler with an authorised current-origin customer return URL;
- reloads the Firebase customer identity and forces a fresh ID token before the application trusts a newly verified email state; and
- reports a verification-send failure accurately rather than silently claiming delivery.

The integrated focused customer taxonomy, decision-support, account UI and verification set passed 72 of 72 tests. Independent final review passed 18 of 18 customer account and verification tests, 25 of 25 trade-isolation tests and type checking, and reported no actionable defect. The complete `npm.cmd run validate` gate passed type checking, warning-free lint, the integration and full test suites, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the nine-page customer-plan PDF audit, the Vinext production build and the Sites server-bundle audit. `git diff --check` passed.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain exact application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`. Sites version 241 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7` and deployed through `appgdep_6a6caabc547c81919c4642b1f7cfcde1` with environment revision 19 at `https://compare.ausenergyassessments.com`.

Live public production verification confirmed the simple fan question, its `No fans` and `Not sure` paths, and the absence of customer-facing discharge-path and damper questions. The live private-account entry measured a visible 364 by 48 pixel password control and equal 175 by 46 pixel account tabs at the desktop viewport with no horizontal overflow. The live `/account?verification=complete` return rendered the customer account entry without a route error. Local 390 by 844 visual inspection confirmed the responsive account layout. Browser error logs and the post-deployment Sites Worker error-only query returned zero events. Verification did not create an account, send an email or mutate production data.

No Sites version 241 release archive was uploaded or recorded, so no archive hash, stored-file count, stored-byte total or content hash is claimed. A newly generated provider verification email, inbox receipt and action-code completion were not exercised during release QA and remain unverified. Existing trade verification behavior is unchanged by this customer-only milestone.

## Protected trade locality and reciprocal product navigation release

`CUSTOMER-TRADE-LOCALITY-24` is deployed from exact application commit `399b04f4a5d680080610f9e88b994506bb60c16f`.

The release:

- places the installer-request consent in the sticky action area immediately above submit and renders a missing-consent alert beside that action;
- focuses the consent control after an invalid submission and associates the checkbox, error and other request fields through the same accessible error description;
- uses one shared aligned customer navigation on the account dashboard and profile, with current-page semantics and a branded TLink destination;
- exposes the real white Australian Energy Assessments mark and full-name return destination in public and signed-in TLink headers;
- adds immutable suburb to each new opportunity's existing postcode and state snapshot through migration `0092_trade_opportunity_matching_locality.sql`;
- writes the exact-current `2026-08-01-anonymized-matching-locality-v1` notice receipt for purpose `anonymized_installer_matching` in the guarded installer-request transaction;
- shows suburb, postcode and state to an eligible trade or its business notification only when the exact project has that active exact-version receipt; and
- keeps legacy, missing, mismatched and withdrawn receipts state-only without reading mutable customer profile locality or backfilling older opportunities.

The household's name, phone, email, street address, unit, precise distance, project names, private notes, meter data and unapproved documents remain excluded from installer matching. The customer-facing shareable plan and PDF continue to exclude exact postcode. The narrower locality disclosure is confined to the protected matching boundary and uses the opportunity snapshot, not the current customer profile.

The focused consent, navigation, privacy, locality, trade-enquiry and notification set passed 96 of 96 tests. The complete `npm.cmd run validate` gate passed type checking, warning-free lint, 31 of 31 integration tests, 1,014 main tests with 1,012 passed, 2 intentionally skipped and 0 failed, all 93 migrations through `0092_trade_opportunity_matching_locality.sql`, the nine-page customer-plan PDF audit, the Vinext production build and the Sites server-bundle audit. Targeted ESLint and `git diff --check` passed.

GitHub branch `codex/sites-custom-domain-migration` and Sites managed `main` contain exact application commit `399b04f4a5d680080610f9e88b994506bb60c16f`. Sites version 242 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_bc9f3157a9e88191881c5989f7de7ba0`, with package content hash `sha256:3d7535003e6b3fae6b2b7f4f86b5c69a59737a8aa607ba7feabdbd407fd890f0`, and deployed through `appgdep_6a6cc08dc6f881919a349de607f5a8a9` with environment revision 19 at `https://compare.ausenergyassessments.com`. The temporary local release package was deleted after deployment.

Live signed-in verification confirmed equal customer-navigation alignment at desktop, 900 and 768 pixel widths and no document overflow at 520 pixels. The profile route renders the same navigation with current-page semantics. TLink exposes the real white Australian Energy Assessments mark and full return name, wraps cleanly at 900 pixels and retains the full return at 520 pixels without document overflow. The installer-request dialog keeps its checkbox, missing-consent alert and submit action together; at 360 by 800 pixels the alert occupied 629.1 to 708.7 and the submit action 719.9 to 780.0 within the viewport. The production preview describes suburb, postcode and state as the protected job area. Browser inspection did not submit the form or change production data, and the post-deployment Sites Worker error-only query returned zero events.

Release QA deliberately did not create a new production opportunity. A newly written version-242 opportunity row and its locality-bearing business email were therefore not observed live and must not be inferred from the existing legacy state-only leads. Existing opportunities remain state-only by design. Hosted row counts and independent direct querying of the managed D1 database remain unavailable.

## Local validation evidence

The last complete shared-worktree validation was recorded before the release was split into compatible expansion, application activation and contract cleanup:

- `npm.cmd run validate`, including type checking, warning-free lint, 35 integration tests, 717 full-suite tests with 715 passed and 2 intentionally skipped, all 80 migrations replayed against a fresh local D1 database, and the production build.
- `npm.cmd --prefix mobile run typecheck`.
- The isolated `DatabaseSync(":memory:")` benchmark with 100,000 rows in each of five datasets. All guarded queries remained below the 75 ms p95 threshold; reviewed-supplier catalogue first-page p95 was 0.118 ms and deep-cursor p95 was 0.127 ms in the final recorded run.
- The audit snapshot contains exactly 22 nonempty Markdown reports with an H1 and balanced fences. Its redundant duplicate archive is excluded from public source; the two user-profile path roots in the manifest were generalised to `%USERPROFILE%` before publication without changing a substantive finding.

The exact expansion commit `7ebcb1905d3c28245fbcfede55525e0cfee8df8a` passed `npm.cmd run validate`, including all 80 migrations and the production build. The application activation passed type checking, warning-free lint, 29 integration tests, 718 full-suite tests with 716 passed and 2 intentionally skipped, all 80 migrations and the production build. The exact contract commit `698a5057cc384d43112e5ccff38a99effbb01fa8` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 30 integration tests, 719 full-suite tests with 717 passed and 2 intentionally skipped, all 81 migrations and the production build. Mobile type checking passes. The isolated 500,000-row benchmark passes every 75 ms p95 guard; reviewed-supplier first-page p95 is 0.168 ms and deep-cursor p95 is 0.124 ms.

Exact application commit `53e6cf96aff6f48e9e393a23c4eedbeba997eb39` passes 174 of 174 integrated focused customer-project, quote-preparation, capability-matching, consent, compatibility, operational-category and Home-record retirement tests. The complete `npm.cmd run validate` gate passes on that clean commit: type checking, warning-free lint, 32 integration tests, the full 755-test suite with 753 passed and 2 intentionally skipped, all 82 migrations against a fresh local D1 database, and the production build. `git diff --check` also passes. Desktop and 375-pixel browser checks confirm the redesigned Home, Goals, Plan, Work and Privacy stages, accurate progress, no preselected goal, explicit preservation or refresh of an edited plan, one evidence-upload boundary, action-local validation, the separate preparation guide and no mobile horizontal overflow. Sites version 204 has matching saved-source provenance; public health, the new guide and signed-out project entry return `200`, the retired Home records route returns `404`, and the recent worker-error query returns zero events.

Exact application commit `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77` passes 38 of 38 focused advisor and administrator stability tests. The complete `npm.cmd run validate` gate passes on the exact release source: type checking, warning-free lint, 32 of 32 integration tests, the full 770-test suite with 768 passed and 2 intentionally skipped, all 83 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passes. An independent final review found and closed two pre-release safety defects: customer classifications can no longer replace an authoritative site-check rule, and room concerns can no longer combine with the use period of another room. A malicious permission-title, identifier and note regression proves that arbitrary private wording is not copied into the shareable checklist.

Desktop visual inspection confirmed readable project-guide contrast. A 390 by 844 computed responsive check reported a 390-pixel viewport, 375-pixel root content width and no horizontal overflow. Signed-in working-demo customer verification confirmed five directly selectable steps, multiple goals, explicit source labels, room profiles, broad climate wording, editable linked plan steps and the five-section permission preview. Signed-in owner verification opened the first unread demo notification; after the audited read update removed its `Mark read` action, the record still had one `Close case` control, remained expanded and retained its first visible position. Public health, guide, signed-out customer route and administrator shell returned `200`. Sites version 206 has matching saved-source provenance and environment revision 19.

Exact application commit `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e` passes 51 of 51 focused plan, privacy, provider, accessibility and navigation regressions. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 784-test suite with 782 passed and 2 intentionally skipped, all 83 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passes. Independent privacy, security, accessibility, print and release reviews were closed before publication. Sites version 208 has matching saved-source provenance and environment revision 19.

Live public verification confirmed the reconciled seven-part `/plan` intake, multiple goals, owner-or-renter first, separate shared-property approval, current home facts, budget, pace, optional state, bounded questions and controlled rationales. The guide text renders as `rgb(185, 204, 215)` on the navy canvas without horizontal overflow. The live print route contains the ordered plan, decision questions, guide links and browser Print or Save as PDF action. A representative four-page A4 output was inspected without clipped cards, dark artifacts or application chrome. Required Sites delivery and limiter configuration names are present, but secret values were not read or reproduced. The authenticated email path was not exercised against a real recipient; ownership, privacy, idempotency, rate-limit and provider behavior are covered by automated regressions. No real account was created or used and no demo data changed.

Exact application commit `6540ee671e64dbfdf80592283a1954b2ff482355` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, the full 803-test suite with 801 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. A final focused privacy, report and compatibility set passed 27 of 27 tests. `git diff --check` passed. Independent taxonomy, evidence, privacy and final-diff reviews were closed before commit. GitHub and the Sites managed source branch both resolve to the exact application SHA. Sites saved version 210 reports that SHA as its source and deployment `appgdep_6a695ca742d081918d73196751713f98` succeeded with environment revision 19.

Local desktop and 390 by 844 planner checks found no horizontal overflow. A representative three-page, 137,415-byte A4 PDF was rendered and inspected without clipped content or application chrome. Live public `/plan` and `/plan/print` checks confirmed the categorized home questions, several goals, renter guidance, concise readiness language, ordered actions and readable desktop plus 390 px report layouts. Signed-in working-demo inspection confirmed five clickable builder steps, the same categorized taxonomy, `Not sure` bulk completion, budget, email and PDF actions, reorder and remove controls, the email-dialog `Review home details` correction path and the installer-only file count. The temporary project title existed only in unsaved browser state. No project was saved, no evidence was uploaded, no email was sent and no real customer, trade, wholesaler or assessor account was created. Live email-provider delivery and live authorization-denial mutation paths were deliberately not exercised; ownership, rate-limit, consent, privacy and provider-acceptance boundaries are covered by automated regressions.

Exact application commit `ee75aadfd6800c01b92532b2d376a4a1e33c9d74` passes 70 of 70 focused professional-review, print, report and compatibility tests; the final print-lifecycle subset was rerun after the cleanup review and passed 17 of 17. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 816-test suite with 814 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed. Independent taxonomy and final-diff reviews closed before publication. GitHub and the Sites managed source branch both resolve to the exact application SHA. Sites saved version 212 reports that SHA as its source and deployment `appgdep_6a69c4f838bc8191a0e050da219ab4a6` succeeded with environment revision 19.

Public desktop and narrow-viewport computed checks found no horizontal overflow and confirmed the categorized home facts, helpful-action section and separate roadmap. Signed-in working-demo inspection confirmed the optional adviser declaration and its controlled fields on Goals, plus helpful actions, email and print controls on Plan. A representative maximum-content six-page A4 report rendered in about half a second and was visually inspected without clipped professional text, split action cards, dark artifacts or application chrome. Browser screenshot capture timed out, so live layout evidence came from semantic snapshots and computed geometry rather than a screenshot. No working-demo value was saved, no evidence was uploaded, no email was sent, the live print dialog was not opened and both signed-in inspection tabs were discarded after verification.

The post-release Sites error-only query returned three informational canceled `/api/electricity-plans` health-monitor invocations and no exception message attributable to the newly checked release routes. This does not prove an end-to-end electricity-plan provider result and remains an operational monitor observation. No real account was created or used.

Exact application commit `d5c675a5ceffa6e924df033e8cb8b505bb4d6336` passes 40 of 40 focused PDF, customer-project UI and navigation tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 820-test suite with 818 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed. GitHub and the Sites managed source branch both contain the exact application SHA. Sites saved version 214 reports that SHA as its source and deployment `appgdep_6a69e79a91548191987f12631559cb1f` succeeded with environment revision 19.

A maximum-content seven-page A4 PDF with long adviser content and six everyday actions was rendered and visually inspected without clipped text, unreadable contrast or application chrome. Live public verification confirmed the exact `Preview and download PDF` route, one enabled `Download PDF` action, no native-print copy, no alert and no JavaScript dialog. The production action created a 29,002-byte three-page PDF. Independent parsing confirmed the `%PDF-` signature, A4 `595.28 × 841.89` page boxes, expected title and author, readable first-page text, no encryption and no embedded JavaScript. No project or account record was created or saved, no evidence was uploaded, no email was sent and no provider delivery path was exercised.

Exact application commit `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, the full 820-test suite with 818 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. The focused PDF, mutation-boundary, navigation and account-cache regression set passes 45 of 45 tests. `git diff --check` passed. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 216 reports that SHA and deployment `appgdep_6a69f763e0b08191b6ac8539e0828d84` succeeded with environment revision 19.

A cold local Chrome-channel check completed the native PDF response in 139 ms. The live custom-domain action completed in 1,906 ms and made exactly one `POST /api/customer-plan-pdf` request. It downloaded `home-energy-plan-2026-07-29.pdf`, returned `200`, `application/pdf`, `Content-Disposition: attachment` and `Cache-Control: no-store`, and produced a 6,532-byte, unencrypted, three-page A4 document with a valid `%PDF-` signature. The button recovered to enabled `Download PDF`; there was no alert, page error, print dialog, client PDF worker, font fetch, project save or evidence upload. Live `/account` and `/account/projects/new` HTML returned `private, no-store, max-age=0`. The post-deployment Sites error-only log query returned zero events. The signed-in handler's zero-mutation contract is covered by source regression because the isolated release browser did not create or mutate a working-demo account.

Exact application commit `fb6cacf8b0309a3fc26b40a43da5b025050d22d2` passes 33 of 33 focused report, PDF and customer-project UI tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 822-test suite with 820 passed and 2 intentionally skipped, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 218 reports that SHA and deployment `appgdep_6a6a11c02e088191bb27cc302c8b35af` succeeded with environment revision 19.

A representative maximum-content professional-review report produced a 20,125-byte, unencrypted eight-page A4 PDF with no JavaScript, no blank page, no clipped or split action card, 13 same-origin link annotations and no raw visible URL. Every rendered PDF page was inspected. The matching email was inspected at 760-pixel desktop and 375-pixel mobile widths with no horizontal overflow or remote image. The live custom-domain action emitted one download event, recovered the enabled `Download PDF` button, opened no JavaScript dialog and produced no browser error. The post-deployment Sites error-only log query returned zero events. No project or account record was created or saved, no evidence was uploaded, no email was sent and no provider delivery path was exercised.

Exact application commit `f401575a5bf463b85c7688424db0b99dddd220c5` passes 56 of 56 focused final report, PDF, email, brand and navigation tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 826-test suite with 824 passed, 2 intentionally skipped and 0 failed, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 220 reports that SHA and deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f` succeeded with environment revision 19.

A representative household report produced a 41,925-byte, unencrypted nine-page A4 PDF with no JavaScript. Every page was rendered and visually inspected, including page 2 where the exact household-supplied evidence boundary appears once. A completed-plan PDF cover and second page were separately inspected and reported `16 STEPS COMPLETE` and `0 LEFT TO PLAN`, without inventing a next step. Live `GET /api/aea-brandmark` returned `200`, `image/png`, `Cache-Control: public, max-age=31536000, immutable`, 3,595 bytes and a valid PNG signature; browser inspection showed the exact 96 by 96 mark. Live `/plan` returned `200`, 54,406 bytes and was visually inspected. Sites logs recorded the new logo and plan requests with outcome `ok` and status `200`. No email was sent, no customer, project or other data was mutated, and native print was not invoked. Browser security blocked a local-file email render, so delivered Gmail and Outlook rendering remains unverified and is retained as explicit forward work.

Exact application commit `e74c2d95889a381cb3bb434607bc6584e54cf722` passes 56 of 56 focused final report, PDF, email, brand, navigation and customer-project tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 826-test suite with 824 passed, 2 intentionally skipped and 0 failed, all 84 migrations against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 222 reports that SHA and deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28` succeeded with environment revision 19.

A synthetic representative report produced a 47,059-byte seven-page A4 PDF. Every page was rendered and visually inspected for repeated-card spacing, rounded clipping, section transitions, footer clearance and the privacy-to-closing sequence. The matching 42,249-byte email was served only from a local loopback preview and inspected across its priority, roadmap, separated comfort tiles, climate, confidence, trade and privacy sections. Automated regressions confirm the narrow-width snapshot gap, mobile section rhythm, rounded shell and tiles, PDF clipping operators and maximum-content email size guard. Live `/plan` returned `200` with 54,406 bytes and `/api/aea-brandmark` returned `200`, `image/png` with 3,595 bytes. The post-deployment Sites error-only query returned zero events. No email was sent, no customer, project or other data was mutated, and native print was not invoked. Delivered Gmail and Outlook rendering remains unverified and is retained as explicit forward work.

Exact application commit `bc427d295b3106907904a3c0b7bf9f2945561cd1` passes 73 of 73 focused preview, PDF, email, evidence, revision, photo and customer-project tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 850-test suite with 848 passed, 2 intentionally skipped and 0 failed, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and the Sites managed source branch contain the exact application SHA. Sites saved version 224 reports that SHA and deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2` succeeded with environment revision 19.

A synthetic representative report produced a 60,177-byte eight-page tagged A4 PDF with no encryption or JavaScript. Every page was rendered with Poppler and visually inspected for hierarchy, readable contrast, rounded surfaces, clipping, overlap and footer clearance. The document declares `en-AU`, a structure tree, reading-order references, link objects and artifacts; it is a tagged foundation, not a PDF/UA conformance claim. A synthetic responsive email was inspected at desktop and 375 px widths with no horizontal overflow. The true maximum-field fixture produced 62,289 HTML bytes and 9,143 plain-text bytes, retained the full saved plan and PDF and explicitly disclosed the email-only six-step and two-tip projection.

Live `/plan` and `/plan/print` loaded from the custom domain with no captured console errors or horizontal overflow. The premium `/plan/print` hierarchy exposed its expected download action, first-party navigation and normalized roadmap. Live `/api/health` returned `{"ok":true,"service":"aea-energy"}`. Signed-in action-bar, revision and photo behavior is covered by source regression because live verification deliberately did not create or save an account project, upload evidence or use real customer data. No email was sent and native print was not invoked. Delivered Gmail and Outlook acceptance and independent assistive-technology testing remain unverified.

Exact application commit `da35ce60295d6c7150cddd9b35e33fcf64c8521b` passes the focused 23-test server, revision and enquiry set plus the focused 7-test layout, UI and accessibility set. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 863-test suite with 861 passed, 2 intentionally skipped and 0 failed, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. Sites saved version 227 reports that SHA and deployment `appgdep_6a6b22db21c48191a2dedbdbf05274ef` succeeded with environment revision 19.

The signed-in production dashboard was reloaded after publication and visually inspected. Draft actions were compact, aligned and readable; the non-draft installer-matching project did not expose deletion. The confirmation dialog showed a clear permanent-action warning, held initial focus on `Keep draft` and was cancelled without issuing a delete request. The saved-project detail showed two compact top-aligned controls rather than oversized full-column controls. Live `/api/health` returned HTTP `200`, `Cache-Control: no-store` and `{"ok":true,"service":"aea-energy"}`. No demo project, evidence record, account, email or other working-demo data was created, edited or deleted.

Exact application commit `0db488f325a79e22d126aace75647715b59c96f9` passes the focused 85-test workflow, document, revision, taxonomy and enquiry set. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full 868-test suite with 866 passed, 2 intentionally skipped and 0 failed, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. Sites saved version 229 reports that SHA and deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24` succeeded with environment revision 19.

The signed-in production project was reloaded after publication and inspected without saving. Step 2 showed the goals, five home basics, detailed home categories, optional considered work, room profile, budget and pace before the roadmap. Step 3 showed the six expected `What shaped this roadmap` groups. Step 4 showed only quote-preparation content and a read-only work summary, with no repeated priority selector. Live `/api/health` returned HTTP `200`, `Cache-Control: no-store` and `{"ok":true,"service":"aea-energy"}`. The recent Sites worker error-only query returned zero events. No demo project, evidence record, account, email or other working-demo data was created, edited or deleted.

Exact application commit `2607cc53f2e4c79546701e29d3d182fde4670952` passes 44 of 44 focused installer-request, private-profile, recovery, project and UI tests. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, the full test suite, all 85 migrations through `0084_customer_plan_revision_restore.sql` against fresh SQLite and Cloudflare D1 paths, and the Vinext production build. `git diff --check` passed before publication. GitHub `main`, the working branch and Sites managed `main` contain the exact application SHA. Sites saved version 230 reports that SHA and deployment `appgdep_6a6b5469c8bc81919f0e2c9ef22da602` succeeded with environment revision 19.

The signed-in production project displayed `Plan details, complete` with the expected green completion styling and opened the private `Where should the installer work?` dialog from `Request private installer responses`. Phone, address and suburb remained blank in the working-demo profile; project postcode `3006` and state `VIC` were derived and shown read-only. Browser-side required-field guidance remained within the dialog. The dialog was closed without entering or saving contact data, submitting a request or mutating the project.

Exact corrective application commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` passes the focused 18-test PDF and email correction set. The complete `npm.cmd run validate` gate passes on the exact source: type checking, warning-free lint, 31 of 31 integration tests, 914 total tests with 912 passed and 2 intentionally skipped, all 86 migrations through `0085_customer_evidence_resumable_retake.sql`, the Vinext production build and the post-build Sites server-bundle audit. The generated server bundle contains neither `__dirname` nor the private Next Fontkit marker. Every page of the nine-page `2026-07-31-tagged-plan-pdf-v6` audit was visually inspected. GitHub `main`, the working branch and Sites managed `main` contain the exact SHA. Sites saved version 232 reports the same SHA and deployment `appgdep_6a6bd28a71888191be19f89db9b82ca5` succeeded with environment revision 19.

The signed-in production project loaded the current roadmap, plain-language revision comparison, privacy-filtered summary action and private check-in UI. The live guided evidence section showed a selected working-demo photo beneath its matching prompt with the filename and `Added privately to this draft`. No evidence, project, profile or installer request was changed. The recent Sites Worker error-only query returned zero events.

The 29 July 2026 `npm.cmd run audit:links` result is not green: 166 of 169 destinations were reachable or accepted, 16 were separately classified as automation-blocked, and 3 provider or network probes failed or timed out. Those failures do not change the source validation result and remain external evidence gaps.

The product owner stated on 28 July 2026 that the environment contains working-demo data only and no real customer, trade or wholesaler accounts. Existing field-pilot recruitment code remains an inactive future workflow and was not activated or populated by this release. Migration `0079_trade_abn_access_gate.sql` adds only the reviewed-ABN projection, indexes and append-only decision ledger. It is deployed and performs no row deletion, column removal, table drop or provider cleanup. Deployed forward contract migration `0080_retire_legacy_trade_commercial_data.sql` uses that explicit authorisation to remove only retired commercial fields, tables and Stripe/Square integration rows after the reviewed-ABN application became live. Its preservation test retains account identities, jobs, quotes, invoices, accounting, calendar and ABN review records. Sites environment revision 19 contains zero Stripe or Square keys after the 16 observed retired keys were removed. Deployment and worker-log evidence is clean, but independent direct querying of the managed live D1 schema and rows remains unavailable; external provider registrations also remain unknown.

## Active deployed platform

The current verified deployed topology for Sites version 249 is:

- Web and API runtime: OpenAI Sites using a Vinext Cloudflare Worker build.
- Relational data: Sites binding `DB`, implemented with Cloudflare D1.
- Private evidence objects: Sites binding `EVIDENCE`, implemented with Cloudflare R2.
- Authentication: Firebase Authentication with application roles and tenant controls in D1.
- Source record: GitHub.
- Operational relay: Google Apps Script and Google Workspace.
- Customer and installer activity-email provider: Resend integration and callback handling are deployed; production inbox receipt, provider credentials and sender approval remain unverified.
- Active public deployment target: Sites.
- Inactive deployment targets: Netlify and Vercel.

Logical binding access does not prove independent ownership of a Cloudflare account or resource. Ownership, complete export, off-platform backup, point-in-time recovery, transfer and workspace-loss behavior remain unproved.

## Verified deployed capability lineage

The 21 July audit reconciled these capability groups to deployed source:

- Native electricity and gas comparison plus the noindex electricity rollback route.
- Household accounts, project planning and protected opportunity intake.
- Installer and supplier profiles, verification, marketplace and catalogue flows.
- Installer CRM, customers, sites, assets, jobs, scheduling, quotes, invoices, field work, handover and team workflows.
- Owner-scoped integrations, provider-reconciliation foundations and the AEA Field sync contract.
- Restricted administration, operational notifications, pagination, search, query telemetry and saved Jobs and Customers views.

Subsequent verified releases add the free reviewed-ABN application, contract cleanup, customer home advisor, advisor context, administrator notification stability, independent customer-plan sharing, the shared home-detail taxonomy, private evidence scope, bounded plan history, optional self-declared professional review, helpful everyday actions, browser-native PDF attachment downloads that avoid print APIs and account mutations, the shared premium PDF plus email report, the exact-brand technical presentation with truthful completed-plan and evidence-boundary handling, consistent spacing with rounded report surfaces, premium on-page preview, duplicated bottom actions, guided private photo capture, plain-language two-version comparison, privacy-filtered export, private check-ins, guarded restore, tagged-PDF foundations, adaptive email compatibility, compact saved-project controls, recoverable deletion, pre-roadmap home and work context, goal-derived priorities, a non-duplicated quote-preparation stage, explicit completed-stage styling, one-confirmation private installer requests, resumable evidence, a worker-safe embedded-font boundary, trigger-safe request submission, multiple photos per guided prompt, one authoritative installer-submit transaction, a bounded installer enquiry pack, complete request-bound photo sharing, the full installer-safe plan and PDF, durable dispatch jobs, independent operations and business alerts, staged submit progress, a top-level customer Quotes centre, exact owner-scoped quote deep links, customer quote-submitted email, trade Work updates, quote submission idempotency, one immutable one-business claim, Resend callback retry handling, contact-only customer handover, owner-scoped new-lead bell items, compact lead cards, aligned quote sections, reliable next-step scroll focus, a privacy-first public-plan enquiry bridge, precise gas hot-water choices, reported electrical-phase planning clues, plain household exhaust-fan choices, a visible account form, refreshed customer verification state, connected-customer identity presented first in the authorised trade lead, consent beside installer-request submission, aligned shared customer navigation, reciprocal product branding, exact-current protected suburb/postcode/state matching, the Creditex compliance foundation, the signed-in activity-agnostic Creditex operations portal and the Creditex evidence-policy governance release. Those capabilities are deployed in Sites version 249 alongside the earlier owner Database Console. Public enquiry placement and handoff, account privacy explanation, selected home-fact continuity, simplified fan intake, account-control presentation, verification return routing, signed-in Quotes, connected contact disclosure, lead compaction, Work updates, consent presentation, reciprocal navigation, the signed-out Creditex boundary, signed-in Creditex administration, bottom program workspaces, Dataforce-parity advanced filters, activity rules, evidence-policy authoring, four-eyes notice and Access membership are verified. A newly written version-242 opportunity and locality-bearing notification were not created during release QA; production provider inbox receipt and a newly generated customer verification email action remain unverified. The current Creditex production inventory is exactly 0 governed programs, 0 activity versions, 0 policies and 0 cases; regulated cases and hosted private-evidence rows remain incomplete as recorded above.

The audit recommends withdrawing the generic Database Console because broad catalogue access and generic mutation bypass domain services. That withdrawal is forward work and is not claimed complete here.

## P0 operating restrictions

- The current source contains no payment initiation or checkout route and excludes payment providers from the active integration and callback models. Legacy webhook endpoints acknowledge without reading the request or mutating state. Re-enablement requires written OpenAI and legal determination for the exact flow or migration to an approved host.
- The application must not collect or process payment-card data.
- No provider is treated as production ready from source configuration alone.
- The generic Database Console should not be expanded. Its withdrawal is the first administration-safety milestone after free-access cleanup.
- The specifically authorised demo-only commercial cleanup uses separate forward migration `0080_retire_legacy_trade_commercial_data.sql` after the expansion and application were live and reconciled. Any other production-data deletion remains prohibited without exact scope and evidence.

## Current unknowns and blockers

- Legal, billing and administrative ownership of every Sites, D1, R2, Firebase and provider component.
- Complete relational and object export, owner-held backup and isolated restore.
- Approved privacy, residency, retention, regulated-service and public-claim boundaries.
- Current Firebase MFA, revocation, recovery and authorised-domain settings.
- Fresh customer verification-email receipt and hosted Firebase action-code completion on the custom-domain return.
- Complete provider account, scope, webhook, quota, reconciliation and recovery evidence.
- Durable application telemetry, approved service objectives, load evidence and disaster-recovery exercises.
- Physical iOS and Android distribution, signing, device and accessibility acceptance.
- Full WCAG 2.2 AA evidence.
- Production Resend inbox receipt for the version-238 quote-submitted delivery and the version-239 business-contact handover wording.
- Provider credentials and sender approval for the deployed Resend integration.
- Independent hosted row counts for customer-project activity events and deliveries, quote-submission ledger entries and one-business contact claims.
- Delivered rendering and clipping acceptance in controlled non-customer Gmail and Outlook inboxes.
- Independent tagged-PDF reading-order, link, assistive-technology and PDF/UA conformance evidence.

These remain `UNKNOWN` or `BLOCKED`. Source code and passing local tests cannot close them.

## Validation and release contract

Before this document can claim a new deployment:

1. Focused tests for the changed access, ABN, admin, migration and documentation boundaries pass.
2. `npm run validate` passes on the exact commit.
3. `npm run build` passes on the exact commit.
4. The final diff contains only authorised changes and no secrets, generated credentials or customer data.
5. The exact commit is pushed to the approved source branch.
6. A Sites version is saved from that exact commit.
7. Only the saved version is deployed.
8. Public health, relevant signed-in journeys, authorization denials, responsive behavior and provider-error evidence are checked.
9. This identity table is updated with the exact source, saved version, deployment, environment revision, checks and known deviations.

Steps 1 through 7 prove whether an exact deployment occurred. When those steps pass but a relevant step-8 acceptance check cannot be completed, record the application as deployed with acceptance incomplete and list the exact unverified journey or provider evidence. Do not promote that missing evidence to a passing claim.

## Release policy

- Preserve the compatibility electricity route until its approved stability and parity gate passes.
- Publish only validated commits to GitHub and the approved host.
- Never publish credentials, synthetic account output, secrets or customer data.
- Do not edit applied migration history. Use immutable staged forward migrations: a compatible expansion first and a separately approved, reconciled contract cleanup later.
- Keep the dated audit immutable. Correct current truth here and add new release evidence rather than rewriting the audit snapshot.
