# TLink and AEA release truth

Status: current repository snapshot

Truth owners: product owner and technical lead

Last reconciled locally: 30 July 2026

Deployment evidence last verified: 30 July 2026

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
| Current executable application identity | Sites version 229 from `0db488f325a79e22d126aace75647715b59c96f9` at `https://compare.ausenergyassessments.com` | Deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24`; saved-version provenance, public deployment, environment revision 19 and live signed-in plus health evidence verified on 30 July 2026 |
| Current source checkpoint | Documentation-only child containing this release record | Its commit is recorded after this file is committed; it does not change the executable version 229 application |
| Contract cleanup | `0080_retire_legacy_trade_commercial_data.sql`, SHA-256 `2CA1A250D9B6C637010480DEE0528906A932F40835EFBC786D90AD561CE99BA4` | Deployed from `698a5057cc384d43112e5ccff38a99effbb01fa8` |

The additive schema expansion, reviewed-ABN application, authorised contract cleanup, customer home advisor, advisor-context release, independent customer-plan release, customer plan evidence-and-history release, professional-review, browser-native PDF, premium customer-report, technical presentation, spacing, customer-plan trust, customer-project cleanup and customer-roadmap-context releases are production. Sites version 229 is the exact executable application source. Version 214 is historical and superseded because its signed-in action could save the project, process pending images and upload evidence before PDF generation, then attempt a delayed synthetic download. Version 216 established the non-mutating attachment path. Version 218 established the shared premium PDF and email hierarchy, version 220 added the exact AEA mark, technical visual system, truthful completed-plan state and one non-duplicated household or professional evidence boundary, and version 222 applied consistent spacing and rounded surfaces. Version 224 adds shared premium preview, duplicated bottom actions, guided private photos, bounded revision compare and restore, a tagged-PDF foundation and adaptive email compatibility. Version 227 adds compact dashboard and project-detail controls plus guarded permanent deletion for unused private drafts. Version 229 moves recommendation-shaping home and work context before roadmap generation, makes goals authoritative for compatibility priorities, adds a clear roadmap-basis summary and removes the repeated priority questions from quote preparation. Live verification inspected an existing demo project without saving or changing it. Earlier free-access and integration boundary checks returned `200`; retired membership, billing, referral and payment-link routes returned `404`; and an unauthenticated trade CRM request returned `401`.

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

The 29 July 2026 `npm.cmd run audit:links` result is not green: 166 of 169 destinations were reachable or accepted, 16 were separately classified as automation-blocked, and 3 provider or network probes failed or timed out. Those failures do not change the source validation result and remain external evidence gaps.

The product owner stated on 28 July 2026 that the environment contains working-demo data only and no real customer, trade or wholesaler accounts. Existing field-pilot recruitment code remains an inactive future workflow and was not activated or populated by this release. Migration `0079_trade_abn_access_gate.sql` adds only the reviewed-ABN projection, indexes and append-only decision ledger. It is deployed and performs no row deletion, column removal, table drop or provider cleanup. Deployed forward contract migration `0080_retire_legacy_trade_commercial_data.sql` uses that explicit authorisation to remove only retired commercial fields, tables and Stripe/Square integration rows after the reviewed-ABN application became live. Its preservation test retains account identities, jobs, quotes, invoices, accounting, calendar and ABN review records. Sites environment revision 19 contains zero Stripe or Square keys after the 16 observed retired keys were removed. Deployment and worker-log evidence is clean, but independent direct querying of the managed live D1 schema and rows remains unavailable; external provider registrations also remain unknown.

## Active deployed platform

The last verified deployed topology remains:

- Web and API runtime: OpenAI Sites using a Vinext Cloudflare Worker build.
- Relational data: Sites binding `DB`, implemented with Cloudflare D1.
- Private evidence objects: Sites binding `EVIDENCE`, implemented with Cloudflare R2.
- Authentication: Firebase Authentication with application roles and tenant controls in D1.
- Source record: GitHub.
- Operational relay: Google Apps Script and Google Workspace.
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

Subsequent verified releases add the free reviewed-ABN application, contract cleanup, customer home advisor, advisor context, administrator notification stability, independent customer-plan sharing, the shared home-detail taxonomy, private evidence scope, bounded plan history, optional self-declared professional review, helpful everyday actions, browser-native PDF attachment downloads that avoid print APIs and account mutations, the shared premium PDF plus email report, the exact-brand technical presentation with truthful completed-plan and evidence-boundary handling, consistent spacing with rounded report surfaces, premium on-page preview, duplicated bottom actions, guided private photo capture, bounded revision compare and restore, tagged-PDF foundations, adaptive email compatibility, compact saved-project controls, guarded draft-only deletion, pre-roadmap home and work context, goal-derived priorities and a non-duplicated quote-preparation stage. Those capabilities are live in Sites version 229 alongside the earlier owner Database Console.

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
- Complete provider account, scope, webhook, quota, reconciliation and recovery evidence.
- Durable application telemetry, approved service objectives, load evidence and disaster-recovery exercises.
- Physical iOS and Android distribution, signing, device and accessibility acceptance.
- Full WCAG 2.2 AA evidence.
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

Until all nine steps are evidenced, the correct status is local implementation or validated source, not deployed.

## Release policy

- Preserve the compatibility electricity route until its approved stability and parity gate passes.
- Publish only validated commits to GitHub and the approved host.
- Never publish credentials, synthetic account output, secrets or customer data.
- Do not edit applied migration history. Use immutable staged forward migrations: a compatible expansion first and a separately approved, reconciled contract cleanup later.
- Keep the dated audit immutable. Correct current truth here and add new release evidence rather than rewriting the audit snapshot.
