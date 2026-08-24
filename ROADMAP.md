# AEA Energy and TLink forward roadmap

Status: current

Roadmap owner: product owner

Engineering owner: technical lead

Last reconciled: 24 August 2026

Baseline: [Complete current-state audit](./docs/audit/2026-07-21-complete-current-state/README.md)

## How this roadmap is used

The dated audit is the immutable evidence baseline. [Release truth](./docs/RELEASE_TRUTH.md) records the latest reconciled implementation and deployment state. The [next-task handover](./docs/HANDOVER_NEXT_TASK.md) contains one executable milestone. This roadmap contains only approved forward work and measurable gates.

Sequence is dependency based, not a calendar promise. A source change is not a release. A roadmap item is complete only when its required tests, release identity and runtime evidence are recorded.

## Product decisions

- TLink trade software costs A$0.
- Access is never granted by a payment, plan, seat, lead, job or quote state.
- A trade applicant must supply a checksum-valid Australian Business Number.
- A valid checksum is only an input check. An authorised reviewer must verify the business against an authoritative source before any trade workspace or trade API becomes available.
- Installer and supplier access is governed by authoritative per-member permissions and own-work or team-work scopes. Saved presets copy defaults only and never authorize access. Licences, insurance, product evidence, privacy controls and jurisdiction rules remain separate approval gates where applicable.
- Household accounts remain free and private.
- Household planning remains independent, brand-agnostic and advisory. It is not represented as a NatHERS assessment, certificate, quote or savings guarantee.
- Household advice records owner or renter tenure separately from strata or common-property approval and supports several concurrent goals because authority, comfort, budget and upgrade sequencing can differ.
- TLink remains the authoritative trade record until an approved migration changes that boundary.
- The hosted product remains a pre-launch test environment until the product owner explicitly declares it live. Test customer, wholesaler, trade-account and job data may be replaced during testing, but the final wipe remains a separately authorised launch operation.
- Applied database migration history is immutable. Database change uses staged forward migrations: a compatible expansion before application activation, followed by a separately reconciled contract cleanup only after the new application is live.

## Released milestone: TLINK-RENTAL-INSPECTION-65

Release status: application commit `dd4484efa7dd7edfc3db2eaa49df4d6a7668888a` is validated, pushed to GitHub `main` and the Sites managed source branch, and deployed as public Sites version 393 at `https://compare.ausenergyassessments.com`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_0cbb95a708b08191866d924a18d8a59b` and deployment `appgdep_6a8bffe9f218819184b74651b64ff385` report the exact application commit and environment revision 24. Exact package, validation and runtime evidence is recorded in [release truth](./docs/RELEASE_TRUTH.md).

### Outcome

Give TLink one governed Victorian rental minimum-standards assessment that an agent or rental provider can request without an account, a qualified assigned assessor can complete section by section on web or mobile, and the assessor can issue as a quote-ready report through a revocable 60-day link and full PDF.

### Acceptance result

- Rental inspection is available as a TLink job activity and attaches a frozen workflow when the job is created.
- The Jazz-style overview opens each section as a separate screen, saves before continuing and returns Back to the overview.
- Victorian rental minimum standards are the default scope. Electrical, gas and smoke-alarm checks are independent optional modules and are off by default.
- Evidence retains device-reported capture time, upload time and governed location metadata; unacceptable or mocked location data fails closed.
- The currently assigned qualified assessor is the only final issuer, including after schedule or team reassignment.
- The public capability link requires no account, expires after 60 days unless revoked sooner, and exposes the complete issued report and PDF except internal notes.
- Complete repository validation, all 159 migrations through `0160_trade_rental_inspections.sql`, native mobile validation, exact-source packaging, public deployment and public desktop QA passed.

The executable and public deployment gates are met for Sites version 393. Signed-in production dashboard visual QA, physical-device field QA, a supervised test-property rehearsal, the client service schedule and licensed-practitioner review of optional-module declarations remain explicit bounded follow-up work.

## Previous released milestone: AEA-SURGE-CONTEXT-CONTINUITY-79

Release status: application commit `365101733253f2ff39532343bcef81303e96e1e2` is validated, pushed to GitHub and the Sites managed source branch, and deployed as public Sites version 379 at `https://compare.ausenergyassessments.com`. Exact source, package, deployment, test and live-browser evidence is recorded in [release truth](./docs/RELEASE_TRUTH.md).

### Outcome

Make the complete 45-detail home context durable across same-browser navigation, give customers one obvious resume action, keep the conversation chronological at the bottom, and use desktop space for deterministic home tips and optional help without crowding phone chat.

### Acceptance result

- Every allowlisted profile change persists immediately, including reviewed unknown answers, and rehydrates after route, reload and cross-tab changes.
- `Continue setup` resumes the next incomplete section and saves continue through final completion.
- Conversation turns remain ordered at the bottom immediately above the composer.
- Desktop keeps context and guidance visible; phone starts context, suggestions and guidance collapsed and retains natural page scrolling.
- Full validation, exact-source packaging, public deployment and responsive live QA passed.

All acceptance gates above are met for Sites version 379.

## Previous released milestone: SURGE-AI-CONTEXTUAL-EXPERIENCE-70

Release status: application commit `4f5dde6cfa47ddbfb52925ecaf11a36310485a7f` is validated, pushed to GitHub and the Sites managed source branch, and deployed as public Sites version 368 at `https://compare.ausenergyassessments.com`. Exact source, package, deployment, test and live-browser evidence is recorded in [release truth](./docs/RELEASE_TRUTH.md).

### Outcome

Turn the dedicated assistant into a contextual Surge AI customer experience with a complete desktop header, a short home intake, visible mascot-led replies, no costly file analyser and a distinctive full-screen command-centre design.

### Acceptance result

- All eight desktop header destinations are visible and functional without hidden overflow. Mobile navigation remains contained and scrollable.
- Redundant header labels are removed and the customer-facing assistant is consistently named Surge AI.
- Fresh public and customer conversations collect five bounded home facts before chat, with safe common answers preselected and editable.
- The customer profile is locally retained, allowlisted, capped and excluded from trade mode, contact details, photos and uploaded files.
- Assistant responses show the Surge AI mascot and the dedicated page uses an original 3840 by 2160 command-centre background with responsive glass UI and reduced-motion handling.
- The quote, interval and vehicle upload analyser, PDF parsing dependency and obsolete tests are removed.
- Complete validation, exact-source packaging, public deployment and desktop and phone QA passed.

All acceptance gates above are met for Sites version 368.

## Previous released milestone: SURGE-DEDICATED-GUIDE-69

Release status: application commit `ac5fbc4e5ec6b9bb454a8d7f7bf1f4c66cb0e397` is validated, pushed to GitHub and the Sites managed source branch, and deployed as public Sites version 367 at `https://compare.ausenergyassessments.com`. Exact source, package, deployment, test and live-browser evidence is recorded in [release truth](./docs/RELEASE_TRUTH.md).

### Outcome

Give Surge a deliberate header destination that behaves as a normal page rather than reopening the floating mascot, while making the shared Australian Energy Assessments header cleaner, denser and recognisably futuristic without displacing TLink.

### Acceptance result

- The Surge header control navigates to `/surge` and exposes the active page state.
- `/surge` reuses the one root-mounted assistant and does not mount a second widget.
- The dedicated chat is always visible and has no popup launcher, hide control, close button, modal focus trap, body lock or automatic mobile keyboard focus.
- Other routes retain the floating mascot and its persistent tuck preference.
- The shared header retains the TLink logo and trade-workspace bridge, uses one serif wordmark exception and keeps all controls sans-serif.
- Motion is decorative, clipped to the rounded header and disabled for reduced-motion users.
- Complete validation, exact-source packaging, public deployment and desktop, phone and short-landscape QA passed.

All acceptance gates above are met for Sites version 367.

## Earlier released milestone: SURGE-BRAND-PLAN-CONTEXT-67

Release status: application commit `6a8f2db6a3b8e762b734016771b1629996e7abe5` is validated, pushed to GitHub and the Sites managed source branch, and deployed as public Sites version 366 at `https://compare.ausenergyassessments.com`. Exact source, package, deployment, test and live-browser evidence is recorded in [release truth](./docs/RELEASE_TRUTH.md).

### Outcome

Make Surge a consistent customer-facing AEA guide, restore the clear TLink trade bridge, unify typography, remember the customer's mascot preference and allow completed energy-plan answers to improve later Surge conversations without transferring photos, uploads or contact details.

### Acceptance result

- Public AEA and direct-trade TLink identity boundaries are explicit.
- Surge hide and unhide preference persists across same-origin routes, reloads and tabs.
- Planner context is exact-key and exact-option allowlisted, capped, disclosed and excluded from trade mode.
- New chat corrections beat saved plan facts in both model and deterministic response paths.
- Customer-facing pages and tools use readable sans-serif typography and respect reduced motion.
- Contextual buttons open the single global Surge dialog without sending or opening the mobile keyboard.
- Complete validation, packaging, deployment and live desktop/mobile QA passed.

All acceptance gates above are met for Sites version 366.

## Released milestone: CUSTOMER-ADVISOR-CONTEXT-02

Release status: baseline `0a82a992e162087eb5ac76b4227dee3a505eae5b` was live as Sites version 205. Application commit `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77` is validated, pushed to GitHub and the Sites managed source branch, and first deployed as Sites version 206 at `https://compare.ausenergyassessments.com`. Exact validation and runtime evidence is recorded in [release truth](./docs/RELEASE_TRUTH.md).

### Outcome

Keep the expanded administrator notification case open through its audited read-state refresh, and make household planning evidence-aware, broadly climate-sequenced, room-sensitive and permission-ready without creating a product pitch, legal opinion or formal NatHERS claim.

### In scope

- Pin the active expanded notification at its prior visible position while a background refresh reorders read and unread cases.
- Preserve deliberate close, resolve and manual queue or filter changes.
- Record each controlled home fact as not known, customer reported, photo available for review or document available for review without claiming that an attachment was professionally reviewed.
- Derive a broad planning climate only from a valid matching residential postcode and state.
- Collect up to twelve private room profiles with controlled room types, comfort concerns and use periods.
- Make same-room heat and use-period evidence affect safe plan wording and sequencing without copying room names or routines into installer summaries.
- Put renter-portable actions before permission-dependent fixed work.
- Build a tenure, strata, current-plan and evidence-aware permission checklist with five controlled sections and no more than thirty classified items.
- Keep authoritative licensed and site-check rules even when a customer selects a different permission class.
- Keep arbitrary customer titles, identifiers and note wording in the signed-in project rather than copying them into the shareable permission checklist.
- Persist the additive advisor profile through forward migration `0082_customer_advisor_profile.sql`.
- Expose only broad climate, controlled room-type and concern aggregates, and known or unknown evidence counts to installer opportunities.

### Out of scope

- Professional verification of customer evidence.
- Formal NatHERS climate zoning, rating, assessment or certification.
- Legal owner, rental, strata, heritage or owners-corporation determinations.
- Brand, product, installer or service-provider recommendations.
- Fixed price estimates or guaranteed savings.
- Generic Database Console withdrawal.
- Creation or use of real customer, assessor, trade or wholesaler accounts.
- Changes to the immutable dated audit.

### Acceptance gate

- Opening an unread administrator case cannot collapse it or move it off-screen after the audited refresh.
- Explicit close and resolve still close the case, and deliberate queue or filter changes reset the expansion boundary.
- Invalid, non-residential or postcode/state-mismatched inputs produce no climate profile.
- Uploaded evidence sources are never represented as reviewed or verified.
- Room and permission-item limits are enforced at the server boundary.
- Heat or cold timing is correlated within the same room rather than across unrelated rooms.
- Customer permission classifications cannot remove authoritative safety and site checks.
- The shareable permission export excludes exact location, arbitrary private wording and project-private notes.
- Installer opportunities contain only controlled aggregates and retain the existing exact-postcode privacy boundary.
- Focused tests, all migrations, the complete validation gate, production build, source provenance and live responsive checks pass.

All acceptance gates above are met for the released application source.

## Released milestone: CUSTOMER-PLAN-DECISION-03

Release status: application commit `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e` is validated, pushed to GitHub and the Sites managed source branch, and first deployed as public Sites version 208 at `https://compare.ausenergyassessments.com`. The field pilot remains deferred until the feature-optimisation sequence below is complete.

### Outcome

Make the plan explainable, question-led, privately reviewable and shareable as one independent report, while reconciling the public quick planner with the signed-in advisor.

### In scope

- Controlled `Based on`, `Still uncertain` and `Could change if` guidance on every canonical plan item.
- At most three safe next questions linked back to existing controlled inputs, with `Not sure` always valid.
- A bounded customer-owned private review worksheet that never represents authenticated assessor authorship.
- Explicit customer confirmation before an accepted private proposal becomes a private plan step.
- One shared privacy-filtered document projection for server-generated inline HTML and plain-text email plus A4 print or browser PDF.
- Verified owner-scoped email delivery with one confirmed recipient, idempotency and a fail-closed five-attempt hourly limit.
- Current canonical goals, tenure, approval, budget, features, rationale and next questions in public `/plan` and its print view.
- Reinforced dark-canvas guide contrast and a readable live draft status.

### Acceptance gate

- Private review text cannot reach installer opportunities, permission exports or the shared plan.
- Shared output excludes exact location, account identity, project labels, private notes, room names and routines, evidence filenames, meter data and custom plan wording.
- The delivery endpoint rejects unverified, inactive, wrong-owner, malformed, unconfirmed, over-limit and unavailable-provider requests.
- No release test sends a real email.
- Public and signed-in inputs use the same canonical plan engine.
- A4 print, desktop, keyboard and 390 px checks pass.
- The full validation gate, source provenance, GitHub push and Sites deployment reconcile.

All acceptance gates above are met for the released application source. No real account was created and no release check sent an email.

## Released milestone: CUSTOMER-PLAN-EVIDENCE-04

Release status: application commit `6540ee671e64dbfdf80592283a1954b2ff482355` is validated, pushed to GitHub and the Sites managed source branch, and first deployed as public Sites version 210 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a695ca742d081918d73196751713f98` succeeded with environment revision 19.

### Outcome

Make the public planner, signed-in project builder and customer report use one clear home-detail taxonomy, replace internal evidence-source language with household answers and linked evidence, and give customers a direct path to complete missing details before emailing or printing a plan.

### In scope

- Use the same categorized fourteen-question home-detail intake in public `/plan` and the signed-in project builder.
- Support multiple household goals, owner or renter tenure, a planning budget boundary and explicit `Not sure` answers.
- Distinguish no, limited or older, and well-performing roof, wall and underfloor insulation without asking for unsafe inspection.
- Distinguish single, mixed and stronger glazing plus basic blinds, mixed coverings and close-fitting honeycomb, thermal-blind or heavy-curtain-with-pelmet options.
- Show answered, `Not sure` and unanswered counts in plain language, with one action to mark remaining questions `Not sure` and one report-dialog action to review the missing details.
- Generate one concise privacy-filtered report for email, browser print and Save as PDF.
- Keep plan steps removable, keyboard or touch reorderable and open to bounded home-specific additions.
- Store new evidence as private-plan material by default, require explicit installer-sharing scope and consent, strip image metadata, and exclude private files from installer opportunity output.
- Persist bounded private plan revisions and outcome check-ins through forward migration `0083_customer_plan_evidence_history.sql`.

### Acceptance gate

- Equivalent public and signed-in choices normalize to the same canonical home facts and recommendation sequence.
- The report never asks a customer to select an internal evidence source and never represents a household answer or linked file as professionally checked.
- Private-plan files remain owner-only and the installer preview counts only files explicitly marked for installer sharing.
- Concurrent revisions use an atomic number, history reads and retention are bounded, and legacy plan-version metadata is preserved.
- Email and print use the same privacy-filtered projection and expose no private project labels, exact address, filenames, notes, room routines or custom plan text.
- The complete validation gate, all 84 migrations, production build, source provenance, desktop, signed-in and 390 px live checks pass.

All acceptance gates above are met for the released application source. No real account or project was created, no working-demo record was saved, and no release check sent an email.

## Released milestone: CUSTOMER-PLAN-PRO-PRINT-05

Release status: application commit `ee75aadfd6800c01b92532b2d376a4a1e33c9d74` is validated, pushed to GitHub and the Sites managed source branch, and first deployed as public Sites version 212 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a69c4f838bc8191a0e050da219ab4a6` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Add a bounded self-declared professional-review path, useful everyday comfort guidance and a reliable privacy-filtered print lifecycle without implying AEA credential verification, a formal assessment, product endorsement or measured savings.

### In scope

- Let a person preparing the plan self-declare one of the two controlled adviser roles and record a name, accreditation scheme or body, reference and bounded professional notes.
- Require a current explicit declaration and invalidate it whenever relevant household, room, plan or adviser details change.
- Keep AEA credential, accreditation, evidence and observation verification explicitly out of the report claim.
- Preserve household-supplied report wording when no current professional declaration exists.
- Derive a bounded, deterministic and product-neutral set of helpful actions covering controls and timers, moisture and ventilation, personal warmth, seasonal airflow, windows and landscaping, and renter-friendly or bounded do-it-yourself options.
- Keep helpful actions separate from the ordered roadmap, quotes, permissions and installer matching.
- Use the same privacy-filtered projection for email HTML, plain text, standalone print and signed-in print.
- Replace account-page printing with one temporary isolated print frame, one-active-print guarding and complete cancellation, timeout, `afterprint`, exit and unmount cleanup.
- Preserve earlier plan versions, edited ordering, removals and custom steps through the existing conflict boundary.

### Acceptance gate

- A household-only plan never claims professional review.
- A stale, missing or incomplete professional declaration is rejected, and relevant edits require a fresh confirmation.
- A professional report names the self-declared adviser while clearly disclaiming AEA verification or endorsement.
- Helpful actions do not contradict recorded tenure, hot or cold concerns, or known equipment.
- Long professional details wrap in accessible semantic A4 report sections.
- The account print path does not call top-level `window.print()`, print application chrome, allow concurrent jobs or leave temporary report frames behind.
- Focused regressions, the full validation gate, all 84 migrations, production build, source provenance and responsive live checks pass.

The source-level gates above passed for Sites version 212 and a representative six-page A4 report was inspected locally. Later product-owner use reproduced a Chrome freeze. The temporary-frame browser-print mechanism therefore did not meet the operational reliability outcome and is superseded by `CUSTOMER-PLAN-DIRECT-PDF-06`. No working-demo record was saved, no release email was sent and the live print dialog was not opened during the version 212 verification.

## Released milestone: CUSTOMER-PLAN-DIRECT-PDF-06

Release status: application commit `d5c675a5ceffa6e924df033e8cb8b505bb4d6336` is validated, pushed to GitHub and the Sites managed source branch, and first deployed as public Sites version 214 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a69e79a91548191987f12631559cb1f` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Replace every customer-plan browser-print path with a direct, privacy-filtered PDF download that does not invoke Chrome's native print system.

### In scope

- Use one normalized report contract for the public planner and signed-in customer project.
- Generate the PDF in a dedicated lazy worker so layout and font work do not block the page.
- Use `pdf-lib`, fontkit and locally bundled DejaVu Sans TrueType fonts for deterministic A4 output.
- Preserve supported Unicode and fail explicitly for an unsupported glyph instead of silently changing customer or adviser text.
- Download an `application/pdf` Blob with a privacy-safe filename and bounded object-URL cleanup.
- Keep account generation behind the existing exact-plan save boundary while public generation remains non-mutating.
- Remove the customer-plan iframe, `srcdoc`, `contentWindow`, `afterprint` and `window.print()` mechanisms.
- Make no schema or migration change.

### Acceptance gate

- Public and account plan surfaces use the same PDF renderer and privacy-filtered report model.
- Normal, long-professional-note and maximum-content reports produce valid A4 PDFs without clipped sections or unreadable contrast.
- Unicode adviser text, safe filenames, report metadata, page numbering, link boundaries and object-URL cleanup are covered by regression tests.
- No customer-plan action can open native print, print application chrome, mount a report iframe or leave a concurrent generation job.
- The complete validation gate, all 84 migrations, production build, GitHub provenance and Sites saved-version provenance pass.
- A production `/plan/print` download creates a valid unencrypted three-page A4 PDF with the expected title and no embedded JavaScript.

The public gates passed, but the signed-in path was not exercised during release verification. Product-owner use later proved that the account action could freeze or fail while saving the project and processing pending photos before PDF generation, and its delayed hidden-link click could be suppressed by Chrome. The signed-in operational gate was not met, so this milestone is historical and superseded by `CUSTOMER-PLAN-NATIVE-PDF-07`.

## Released milestone: CUSTOMER-PLAN-NATIVE-PDF-07

Release status: application commit `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 216 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a69f763e0b08191b6ac8539e0828d84` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Make public and signed-in customer-plan PDF download one fast, browser-native, non-mutating action that cannot invoke print preview or block on customer-project saving, photo processing or evidence upload.

### In scope

- Build the PDF only from the current normalized privacy-filtered report in memory.
- Keep project saving and evidence preparation entirely outside the PDF action.
- Submit one synchronous same-origin form request and return one `application/pdf` attachment with a privacy-safe filename.
- Generate the bounded A4 document at the edge without a browser, client PDF worker, font fetch, Blob URL or synthetic link click.
- Reject cross-origin, malformed, oversized and unbounded requests.
- Remove obsolete worker, fontkit and DejaVu dependencies.
- Exclude `/account` HTML from shared stale caching and return `private, no-store, max-age=0`.
- Make no schema, migration or working-demo data change.

### Acceptance gate

- One public or signed-in click cannot call project save, photo preparation, evidence upload or any customer-project mutation endpoint.
- The browser makes exactly one `POST /api/customer-plan-pdf` document request and receives a `200` attachment with `application/pdf` and `no-store`.
- The downloaded file has a valid `%PDF-` signature, is unencrypted and uses A4 page boxes.
- The button recovers, with no alert, page error, native print dialog, client worker or font request.
- Account and project HTML responses are private and non-cacheable.
- The complete validation gate, all 84 migrations, production build, GitHub provenance, Sites provenance, live custom-domain download and post-deployment error check pass.

All acceptance gates above are met for the released application source, except that the isolated release browser did not sign in or mutate a working-demo account. The signed-in zero-mutation contract is enforced by regression and the shared PDF request path is verified live.

## Released milestone: CUSTOMER-PLAN-PREMIUM-REPORT-08

Release status: application commit `fb6cacf8b0309a3fc26b40a43da5b025050d22d2` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 218 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a6a11c02e088191bb27cc302c8b35af` succeeded with environment revision 19. Documentation-only child `a92e18b9ea79b53eaf6eda8665f37ec02c861972` was subsequently recorded as Sites version 219 without changing the executable version 218 application. Both are historical checkpoints superseded by the milestone below. The field pilot remains deferred.

### Outcome

Turn the working customer-plan PDF and email into one elegant, brand-consistent home energy report that is easy to scan, readable at normal print size and explicit about the first three actions.

### In scope

- Use one shared report design and copy contract for PDF, responsive email HTML and plain text.
- Lead with a branded cover, home snapshot and three clear first steps before the longer roadmap.
- Separate later upgrades, everyday comfort actions, plan confidence, professional attribution, trade checks and privacy.
- Keep body copy at a readable report size and use the site's navy, teal, green, mint and warm warning palette.
- Make every allowlisted guide label a real same-origin PDF link without printing raw URLs.
- Preserve the browser-native attachment response, no-store boundary, privacy filtering and zero-mutation download contract.
- Handle completed plans without an empty or misleading priority section.
- Make no schema, migration, account or working-demo data change.

### Acceptance gate

- PDF and email use the same projected titles, ordering, plan status and adviser boundary.
- A representative maximum-content A4 report has no blank page, clipped text, split action card, orphan heading, raw visible URL, embedded JavaScript or encryption.
- Desktop and 375 px email renders have no horizontal overflow, duplicated content or unsupported external asset.
- Every PDF guide destination is an allowlisted same-origin annotation with a customer-friendly visible label.
- The public live download produces a browser download event, recovers its button and opens no dialog or page error.
- Focused tests, the full validation gate, all 84 migrations, production build, GitHub provenance, Sites provenance and post-deployment error check pass.

All acceptance gates above are met. The release check did not create or save a project, upload evidence, send an email or use a real customer, trade, wholesaler or assessor account.

## Released milestone: CUSTOMER-PLAN-TECH-PRESENTATION-09

Release status: application commit `f401575a5bf463b85c7688424db0b99dddd220c5` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 220 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Make the customer PDF and email feel like one distinctive, high-end technical presentation while preserving the fast browser-native download, simple language, privacy boundaries and independent advice.

### In scope

- Use the exact shared AEA navigation mark in the PDF and serve it to email from `https://compare.ausenergyassessments.com/api/aea-brandmark`.
- Apply one deep navy, electric blue, teal, aqua, green, mint and warm warning system across PDF and responsive email.
- Improve cover, signal, snapshot, section and action-card hierarchy without changing the normalized report facts.
- Keep the exact household-supplied or self-declared professional evidence boundary once in the PDF.
- Report completed plans as all steps complete with zero left to plan instead of inventing a next action.
- Preserve allowlisted same-origin annotations, route bounds, no-store response, native attachment delivery and zero project or evidence mutation.
- Keep the report version at `2026-07-29-premium-report-v3` while advancing PDF to `2026-07-30-tech-presentation-pdf-v1` and design to `2026-07-30-tech-presentation-design-v1`.
- Make no schema, migration, account or working-demo data change.

### Acceptance gate

- The exact 96 by 96 AEA PNG is shared by navigation and reports, and the live immutable HTTPS endpoint returns a valid PNG.
- A representative household PDF renders every page without clipping, JavaScript or encryption and contains the exact household evidence boundary once.
- A completed-plan PDF reports all steps complete and zero left to plan without a false next-step section.
- PDF, HTML email and plain text retain the same normalized customer facts and evidence boundary.
- Focused tests, the complete validation gate, all 84 migrations, the production build, GitHub provenance, Sites provenance and relevant live logs pass.
- Release verification sends no email, mutates no customer or project data and invokes no native print.

All listed acceptance gates are met. Delivered rendering in Gmail and Outlook remained explicitly unverified at this historical checkpoint. The release check did not create or save a project, upload evidence, send an email, mutate customer data or use native print.

## Released milestone: CUSTOMER-PLAN-SPACING-10

Release status: application commit `e74c2d95889a381cb3bb434607bc6584e54cf722` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 222 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Give every customer PDF and email section deliberate breathing room and soft, brand-consistent corners without changing the advice, evidence, privacy or download contracts.

### In scope

- Centralise the PDF and email spacing and radius scale in the shared report design module.
- Use clipped cubic-Bezier rounded paths for PDF gradients, panels, snapshot cells, number badges and comfort tiles so backgrounds cannot retain square corners.
- Apply consistent label-to-title, title-to-body and body-to-link gaps plus measured panel padding to every repeated PDF card.
- Give responsive email a 40 px desktop and 32 px mobile section rhythm, 16 px tile spacing, 20 px content padding and 16 to 22 px radii.
- Separate each everyday-action item into its own rounded email tile instead of one cramped uninterrupted block.
- Add mobile snapshot separation and keep the maximum-content email below the existing 60,000-byte guard by removing transport-only whitespace.
- Preserve the exact AEA mark, normalized customer facts, evidence boundary, same-origin links, native PDF attachment, provider controls and zero project or evidence mutation.
- Make no schema, migration, account, customer, trade, wholesaler, project or evidence-data change.

### Acceptance gate

- A representative seven-page A4 report renders every page with readable internal spacing, rounded clipping, no overlap, no clipped content and clear footer separation.
- Repeated PDF action, snapshot, information and comfort cards share one measured spacing and rounding system.
- Desktop email inspection shows separated rounded action and comfort tiles; narrow-width regression checks retain stacked snapshot gaps and reduced mobile section spacing.
- Maximum-content email remains below 60,000 bytes and preserves exactly one occurrence of each action and evidence boundary.
- Focused tests, the complete validation gate, all 84 migrations, the production build, GitHub provenance, Sites provenance, live public route checks and the post-deployment error query pass.

All listed acceptance gates are met. The release check used a synthetic in-memory report, did not send email, create or save an account project, upload evidence, mutate working-demo data or invoke native print. Delivered Gmail and Outlook acceptance remained explicitly unverified at this historical checkpoint.

## Released milestone: CUSTOMER-PLAN-TRUST-11

Release status: application commit `bc427d295b3106907904a3c0b7bf9f2945561cd1` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 224 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Make the customer plan easier to review, safer to support with photos, recoverable after edits and more dependable across browser preview, PDF and email, while keeping every customer-facing delivery action available at both the top and bottom of the ordered plan.

### In scope

- Replace the legacy print-preview presentation with the same privacy-filtered premium report hierarchy used by PDF and email, and open that report in an accessible signed-in preview dialog.
- Repeat the complete `Preview full report`, `Email this plan`, `Download PDF` and conditional `Reset advisor suggestions` action set below the last plan step so customers do not need to scroll back to the top.
- Add optional guided photo capture with deterministic categories, three explicit safety and privacy confirmations, a 12-photo limit, local preview and the existing private D1/R2 evidence path.
- Add immutable, owner-scoped plan revisions with bounded retention, meaningful field-by-field comparison, explicit restore confirmation, draft-only restore and optimistic revision conflict protection.
- Preserve customer identity, address, work categories, private notes, adviser details, evidence, sharing permissions, quotes and installer activity when an earlier roadmap revision is restored.
- Add a tagged-PDF foundation with document language, reading order, structural landmarks, link objects and decorative artifacts without claiming PDF/UA conformance.
- Keep the full saved plan and PDF model unchanged while adaptively limiting only extreme email rendering below an 88,000-byte cap, with explicit HTML and plain-text notices for any shortened or omitted email-only content.
- Use honest provider wording: provider acceptance is recorded, but inbox delivery is not claimed.
- Add migration `0084_customer_plan_revision_restore.sql` and keep all new write paths owner scoped.

### Acceptance gate

- The premium public preview renders at desktop and narrow widths without horizontal overflow, and signed-in preview controls retain focus trapping, Escape close, body scroll lock and focus restoration.
- Top and bottom signed-in plan action bars expose the same relevant actions, handlers and busy-state protection.
- Guided photos never ask a customer to climb, enter a roof space, remove a cover or expose a meter box; real customer evidence is not used for release verification.
- Revision comparison detects goals, home facts, pace, budget, plan version, added, removed, moved and changed steps; stale-tab conflicts preserve unsaved local edits until the customer explicitly reloads.
- The tagged PDF remains a valid, readable, non-encrypted A4 document with no JavaScript and no unsupported list-semantics claim.
- Worst-case email HTML remains below the compatibility cap with truthful truncation notices and no change to the saved plan or PDF.
- Type checking, lint, 31 integration tests, the complete 850-test suite, all 85 migrations, the production build, GitHub provenance, Sites provenance and live public route checks pass.

All listed acceptance gates are met. Release verification used only synthetic report data and read-only public routes. It did not send an email, create or save an account project, upload evidence, mutate working-demo data or invoke native print. Delivered Gmail and Outlook rendering and independent PDF accessibility conformance remain explicitly unverified.

## Released milestone: CUSTOMER-PROJECT-CLEANUP-12

Release status: application commit `da35ce60295d6c7150cddd9b35e33fcf64c8521b` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 227 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a6b22db21c48191a2dedbdbf05274ef` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Make saved-project actions clean, compact and easy to understand, and let a customer permanently remove an unused private draft without exposing active projects or linked trade workflows to deletion.

### In scope

- Keep dashboard project actions aligned in one compact row with a quiet `Delete draft` control beside the primary `Continue project` action.
- Show permanent deletion only for private drafts. Active, withdrawn and completed project cards retain their existing lifecycle controls.
- Require a clear, accessible confirmation dialog with `Keep draft` focused first, keyboard focus containment, Escape cancellation and an explicit irreversible-action warning.
- Require same-origin authentication, an active owning customer account, an exact current revision and timestamp, and a server-forced delete action.
- Refuse permanent deletion when a project has submission, opportunity, quote, contact-release, appointment, arrival or handover activity.
- Remove owner-scoped private evidence objects and dependent draft records before deleting the project record, while retaining a retryable draft if cleanup cannot complete safely.
- Keep project-detail controls content-sized and top-aligned instead of stretching each button through the height of a long roadmap.
- Preserve readable primary-action labels across the older project-footer selector and the new compact button treatment.

### Acceptance gates

- Draft cards show one compact destructive action beside the primary continue action on desktop and equal-width controls on narrow screens.
- Non-draft cards never expose permanent deletion.
- The confirmation dialog has a labelled modal boundary, safe initial focus, keyboard containment and no accidental dismissal while deletion is running.
- The delete request is owner scoped, confirmation gated, stale-write protected and refuses every linked customer or trade lifecycle.
- Private evidence object keys remain server selected and are never accepted from or returned to the browser.
- Type checking, lint, 31 integration tests, the complete 863-test suite, all 85 migrations, the production build, diff hygiene, GitHub provenance and Sites provenance pass.
- Live signed-in inspection confirms readable aligned dashboard actions, the safe confirmation dialog and compact project-detail controls.
- Live `/api/health` returns `200` without changing customer or project data.

All listed acceptance gates are met. Live verification used the existing working-demo account only to inspect the dashboard, open and cancel the confirmation dialog, and view a saved project. No draft was confirmed for deletion, no project was edited and no working-demo data was changed.

## Released milestone: CUSTOMER-ROADMAP-CONTEXT-13

Release status: application commit `0db488f325a79e22d126aace75647715b59c96f9` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 229 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Collect the small set of home and work details that can change a recommendation before the roadmap is generated, explain what shaped the roadmap, and reserve the later work stage for optional quote preparation.

### In scope

- Rename the customer stages to Home, Plan details, Your roadmap, Quote prep and Privacy.
- Place goals, home height, approximate age, floor area, roof type, switchboard state, detailed home facts, optional considered work, room profiles, budget and pace before roadmap generation.
- Give each added home basic a safe explanation and explicit `Not sure` answer.
- Derive compatibility priorities from the selected goals on the server instead of trusting a separate client priority payload.
- Use the bounded home and work context in canonical plan steps, the on-page `What shaped this roadmap` summary, saved snapshots, revisions, PDF and email.
- Preserve current values when restoring a legacy revision that predates the new context fields.
- Keep quote preparation focused on project stage, timing, access constraints, optional photos or documents, and private notes.
- Remove the duplicate priority selector from quote preparation and privacy review.

### Acceptance gates

- Step 2 collects every recommendation-shaping input before Step 3 shows a roadmap.
- Step 3 clearly identifies the goals, tenure, home basics, current home answers, work choices and budget or pace that shaped the result.
- Step 4 shows selected work read-only and contains no second priority questionnaire.
- New and restored plan revisions preserve the correct bounded context without replacing current approval or access state.
- PDF and email contain the same compact home-detail and considered-work context.
- Type checking, lint, 31 integration tests, the complete 868-test suite, all 85 migrations, the production build, diff hygiene, GitHub provenance and Sites provenance pass.
- Live signed-in inspection confirms Steps 2, 3 and 4 without saving or changing the working-demo project.
- Live `/api/health` returns `200` and the recent Sites worker error-only query returns zero events.

All listed acceptance gates are met. The production inspection used an existing working-demo draft only to navigate the five stages and inspect rendered content. No answer, project, evidence item, email, account or other demo data was created or changed.

## Released milestone: CUSTOMER-INSTALLER-REQUEST-14

Release status: application commit `2607cc53f2e4c79546701e29d3d182fde4670952` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 230 at `https://compare.ausenergyassessments.com`. Deployment `appgdep_6a6b5469c8bc81919f0e2c9ef22da602` succeeded with environment revision 19. The field pilot remains deferred.

### Outcome

Make the final installer-response request obvious and recoverable: show completed project stages as completed, collect any missing private contact details in the action itself, save them safely and make retrying a request resistant to duplicate or uncertain submissions.

### In scope

- Show every valid saved builder stage with a green completion state and accessible `complete` label while keeping the current step distinct.
- Replace the distant page-top missing-contact message with a focused `Where should the installer work?` dialog beside the request action.
- Collect phone number, service street address, optional unit detail and suburb while deriving postcode and state from the owned project.
- Save only the private contact and derived location fields to the active owning customer profile under an exact revision check.
- Keep name, email, phone and precise address withheld from installers until the existing named contact-release boundary is approved.
- Submit the request from the same dialog, show a clear success state and offer a direct return to the customer overview.
- Use a client request identifier, exact project revision and recovery fingerprint so a lost response can be reconciled without duplicating a request or silently applying stale edits.
- Preserve an unresolved recovery marker when the server state cannot be reconciled safely.

### Acceptance gates

- A completed saved `Plan details` stage renders with a green check and an accessible completion label instead of looking disabled.
- The installer-response action opens one labelled, keyboard-contained modal with the missing fields and privacy explanation in context.
- Private contact updates are same-origin authenticated, owner scoped, active-account scoped, project derived and compare-and-swap protected.
- Request creation is idempotent and an uncertain retry checks authoritative server state before any additional save or submission.
- Existing matching or quote-review projects accept only an explicit recovery update against the observed private-profile revision.
- Focused installer-request, profile, recovery, project and UI regressions pass 44 of 44; the complete release gate, all 85 migrations and the production build pass.
- GitHub, Sites managed source, saved-version provenance and the deployed application all resolve to the exact application commit.
- Signed-in production inspection confirms the green completed step and the focused missing-information dialog without saving profile data or creating a request.

All listed acceptance gates are met. Live verification used the existing working-demo draft only to inspect the completed step, open the request dialog, trigger browser-side required-field guidance and close the dialog. No phone number, address, profile revision, project, evidence item or installer request was created or changed.

## Released milestone: CUSTOMER-PLAN-DURABILITY-15

Release status: corrective application commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 232 at `https://compare.ausenergyassessments.com`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8` and deployment `appgdep_6a6bd28a71888191be19f89db9b82ca5` report the exact commit and environment revision 19. Sites version 231 from implementation commit `e74278c8b62c569541ea84b5a431917d03a1c13a` failed before public activation with `__dirname is not defined`; it never became public and version 230 remained live until the corrected version 232 deployment succeeded.

### Outcome

Make plan completion durable and understandable: keep guided photos visible where customers added them, preserve safe resumable evidence handling, make deletion recoverable, turn plan history into a useful comparison and check-in tool, submit installer requests from one confirmation, and deliver worker-safe accessible PDF and email reports.

### In scope

- Show an immediate preview, filename and save state inside the exact guided-photo card, then retain the saved preview after reload with replace and remove controls.
- Preserve guided evidence if later work selections change, without duplicating generic evidence or supporting PDFs.
- Use stable capture slots, metadata stripping, resumable multipart private uploads and compare-and-swap retake or removal.
- Keep draft deletion in a durable `deleting` state, freeze new uploads, retry incomplete D1 or R2 cleanup and suppress normal continue or edit actions until cleanup finishes.
- Replace opaque revision numbers with plain-language labels, two-version comparison, a privacy-filtered summary export, private outcome check-ins and guarded draft-only restore.
- Save the latest private profile and submit an installer request from one confirmation, with one bounded authoritative conflict recovery and no replay of project, evidence or request writes.
- Embed Liberation Sans, preserve the tagged-document foundation, semantic lists and links, and fail before save with a clear response when a script is not yet supported.
- Use the public worker-safe `@pdf-lib/fontkit` boundary and fail the production build if a private Next Fontkit marker or `__dirname` enters the Sites server bundle.

### Acceptance gates

- Guided selected and saved photos remain visible in the matching card, including replacement, removal and changed-work-selection states.
- Upload sessions are owner scoped, bounded to 12 files of 8 MB each, expire safely and cannot revive evidence after deletion starts.
- Draft deletion is recoverable without exposing a deleting project as an active or recommended project.
- Version comparison, privacy-filtered export, private check-in and draft-only restore preserve project identity, notes, evidence, quotes and installer state.
- Installer request submission uses one confirmation and one bounded conflict recovery without duplicate or stale writes.
- The focused PDF and email correction set passes 18 of 18; the complete release gate passes 31 of 31 integration tests, 914 total tests with 912 passed and 2 intentionally skipped, and all 86 migrations through `0085_customer_evidence_resumable_retake.sql`.
- The nine-page tagged-PDF audit is visually clean, unsupported scripts fail before save, the Vinext build passes and the final Sites server bundle contains neither `__dirname` nor the private Next Fontkit marker.
- GitHub, Sites managed source, saved-version provenance and the public deployment all resolve to corrective commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`.
- Live signed-in inspection loads the saved roadmap, two-version comparison and private check-in UI. A selected working-demo photo remains visibly named with `Added privately to this draft` inside its matching guided card. No photo, project, profile or installer request was saved, replaced, removed or submitted during verification.
- The post-deployment Sites Worker error-only query returns zero events.

All listed acceptance gates are met. The failed version 231 remains historical non-live evidence only. Version 232 is the sole current executable source for this milestone.

## Released milestone: CUSTOMER-INSTALLER-PHOTOS-16

Release status: application commit `5acc4ccf37acd608dc437d3a074410b1d840f706` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 233 at `https://compare.ausenergyassessments.com`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_218ad21977748191a3283723f395cadd` and deployment `appgdep_6a6be56ca9ac8191918423bd57f0a05d` report the exact commit and environment revision 19.

### Outcome

Remove the false installer-request conflict and let customers add the several photos a real quote-preparation section may need without weakening the private evidence boundary.

### In scope

- Treat any positive D1 change count as a successful conditional profile or request-submission write while preserving zero changes as a real revision conflict.
- Cover the customer-search trigger that turns one successful profile update into three total D1 changes and the trade-opportunity search trigger that amplifies the request insert.
- Display every saved and pending photo inside its guided prompt with a count and individual retake, replace, remove or cancel controls.
- Add another independent photo to the same prompt until the existing 12-file project cap is reached.
- Keep owner checks, private-by-default storage, metadata stripping, 8 MB limits, client-upload idempotency and exact-photo replacement locking.
- Apply `0086_customer_evidence_multi_photo_prompts.sql`, removing only the two obsolete prompt-level uniqueness indexes.

### Acceptance gates

- The final `Save details and request responses` confirmation no longer returns a false `PROFILE_REVISION_CONFLICT` after a successful trigger-amplified update.
- A zero-change stale revision still fails closed and an uncertain request still reconciles against authoritative server state.
- Same-prompt additions can coexist; a replacement remains bound to one exact evidence row and cannot consume an extra project slot.
- Focused regressions pass 55 of 55. The complete release gate passes 31 of 31 integration tests, 916 total tests with 914 passed and 2 intentionally skipped, all 87 migrations through `0086_customer_evidence_multi_photo_prompts.sql`, the tagged-PDF audit, Vinext build and Sites server-bundle audit.
- GitHub `main`, the working branch, Sites managed source, saved-version provenance and public deployment all resolve to application commit `5acc4ccf37acd608dc437d3a074410b1d840f706`.
- The local archive is 7,086,372 bytes with SHA-256 `B110B28AE3F5D1A5256E478C20D44A5727084C51C6D0159FA20E91D31F6D69B0`; Sites reports 312 stored files, 27,770,880 bytes and content hash `sha256:47e85a2c9289437ee38c3c478a6191687e46ffec393215a59092ac1185bc8c6f`.
- Signed-in production inspection loads the quote-preparation photo cards, privacy review and active one-step request modal. Customer-account and customer-project reads return `200` and the recent Worker error-only query returns zero events.
- No working-demo profile, project, photo or installer request is changed during release verification.

All listed acceptance gates are met. Version 233 is the exact executable source for this milestone and now remains historical release evidence after version 234 superseded it.

## Released milestone: CUSTOMER-INSTALLER-SUBMIT-17

Release status: application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 234 at `https://compare.ausenergyassessments.com`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_06f96686a8dc8191a0e01c2555c2de1b` and deployment `appgdep_6a6bf3695b6081918ce2a9dd77bc3869` report the exact commit and environment revision 19.

### Outcome

Make the installer-response modal the single source of truth. The contact details confirmed in that modal now save in the same guarded server transaction that submits the project, creates the installer opportunity and records consent. A customer no longer encounters a false missing-address error after the contact data has already saved.

### In scope

- Send phone, street, unit and suburb with the project submission instead of performing a separate profile PATCH.
- Validate modal contact at the server boundary and derive postcode and state from the owner-scoped project.
- Persist contact, transition the draft, create the opportunity and record consent in one guarded D1 batch.
- Preserve project revision protection while removing the obsolete client-side profile revision conflict and retry loop.
- Treat matching and quote-review replays as idempotent contact updates without duplicate opportunity or consent rows.
- Normalise both raw D1 snake-case and API camel-case address projections at the shared readiness boundary.
- Reject genuinely terminal project states instead of returning a false success.

### Acceptance gates

- Screenshot-equivalent valid contact details submit from the modal without a profile-precondition message or another customer step.
- A stale project revision fails before contact or project state can be partially changed.
- Matching and quote-review replays do not duplicate installer opportunities or customer consent.
- Focused authoritative-submit regressions pass 50 of 50. The complete release gate passes type checking, warning-free lint, 31 of 31 integration tests, 915 total tests with 913 passed and 2 intentionally skipped, all 87 migrations through `0086_customer_evidence_multi_photo_prompts.sql`, the tagged-PDF audit, Vinext build and Sites server-bundle audit.
- GitHub `main`, the working branch, Sites managed source, saved-version provenance and public deployment all resolve to application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b`.
- The local archive is 7,086,533 bytes with SHA-256 `22DE94F3E9B22493FF79ED9DC70FF62F6D8B7259DC02AEB93E33B28445EEF2C3`; Sites reports 312 stored files, 27,770,880 bytes and content hash `sha256:3ffeb4fb493c6426cb78aceb8792de7e2e65830181d410c23d53ea9a8a87cc9f`.
- Signed-in production verification submits working-demo project `154aee4d-3648-4c7c-b393-c6715c518b24`: request `a238af3e5f81164e` returns HTTP `200`, the dialog reports `Request sent`, the overview reports `Installer matching`, and the recent Worker error-only query returns zero events.

All listed acceptance gates are met for that milestone. Version 234 is now historical executable evidence after version 235 superseded it; version 233 remains earlier historical evidence.

## Released milestone: INSTALLER-ENQUIRY-PACK-18

Release status: application commit `eeba3679c30789cfe2e633a913a18492270fcc3e` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 235 at `https://compare.ausenergyassessments.com`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_0fac9e3297808191afc57d58d9377584` and deployment `appgdep_6a6c0908063081919b2e985a27141e34` report the exact commit and environment revision 19.

### Outcome

Give an allocated, approved installer enough privacy-safe information to understand a new enquiry before expressing interest, make customer-approved evidence visible in the matching lead, notify the business automatically, and remove avoidable notification work from the customer's submit wait.

### In scope

- Derive one bounded installer enquiry pack from the authoritative customer-plan document instead of maintaining a second recommendation source.
- Show goals, plan boundary, controlled home context, quote readiness and the first three ordered roadmap steps high in each matching lead.
- Keep identity, exact location, contact, project-private text, room names and routines, permission notes, adviser identity, customer-written plan items, evidence filenames and meter data out of the matching projection.
- Show an approved-evidence count, load image thumbnails only after the allocated installer selects `Show approved photos`, and keep PDFs behind an explicit protected download.
- Require the exact allocated business, active reviewed-installer access, current allocation and active evidence-sharing consent for every evidence read.
- Open notification links directly in the Leads workspace.
- Enqueue one durable business-email notification when a new match is created, dispatch it outside the customer request, recheck access and consent before sending, and suppress bounced or complained-about addresses by hash.
- Keep the notification email itself minimal: business name, state, service labels, timing or expiry, approved-evidence count and the signed-in Leads link.
- Stop awaiting the independent administrator webhook in the customer submit request and run independent owner/project hydration reads concurrently.
- Apply `0087_trade_opportunity_notifications.sql` without backfilling or emailing historical matches.

### Acceptance gates

- Privacy-canary tests prove the lead pack and business email exclude customer identity, exact location, contact, private notes, room and permission details, adviser text, arbitrary customer items, filenames and meter data.
- Approved images are requested only for the selected lead through the existing authenticated and audited evidence endpoint; PDFs remain deliberate downloads.
- Notification creation is exactly-once per new match, delivery is idempotent, synchronous delivery failures retry at most three times with frozen content, terminal provider callbacks are monotonic, and stale matches cannot send.
- Customer submission does not await either the administrator webhook or the business-email provider.
- Focused notification, enquiry-pack and submit-performance regressions pass. The complete release gate passes type checking, warning-free lint, 31 of 31 integration tests, 931 total tests with 929 passed and 2 intentionally skipped, all 88 migrations through `0087_trade_opportunity_notifications.sql`, the tagged-PDF audit, Vinext build and Sites server-bundle audit.
- GitHub `main`, the working branch, Sites managed source, saved-version provenance and public deployment all resolve to application commit `eeba3679c30789cfe2e633a913a18492270fcc3e`.
- The local archive is 7,098,588 bytes with SHA-256 `326DD4224505C9364A8D2852877D4037C397422788F97394B00A0EA9D80D48F1`; Sites reports 313 stored files, 27,822,080 bytes and content hash `sha256:7eea5f36d7a31df1213c163a8d0f836b6f02dd18e3bdc6a60cc5cc5831b24121`.
- Sites deployment succeeds with environment revision 19, the required Resend configuration names are present, and the post-deployment Worker error-only query returns zero events.

The executable and deployment gates are met. No new working-demo match was created after version 235, so live provider delivery, the reduced submit duration and the signed-in Leads photo presentation remain explicitly unverified in production. The pre-release working-demo lead is not backfilled; the notification trigger applies to new matches only.

## Released milestone: CUSTOMER-INSTALLER-HANDOFF-19

Release status: application commit `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly as Sites version 236 at `https://compare.ausenergyassessments.com`. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_82454487760c8191b1f5338538b8fcb8` and deployment `appgdep_6a6c3b56a1b881919e82e97eaa286bc4` report the exact commit and environment revision 19.

### Outcome

Make one customer confirmation complete the installer handoff without a 50-second provider wait: record durable follow-up work, share the complete privacy-safe plan plus every active customer-uploaded photo with exact allocated installers, send operations and business alerts automatically, and show staged progress throughout the request.

### In scope

- Add `0088_customer_opportunity_dispatch_jobs.sql` as the durable outbox for allocation, operations-alert and business-alert work.
- Return compact HTTP `202` after the authoritative request transaction records its durable job.
- Drain immediately outside the response and retain scheduled bounded retries as recovery.
- Keep provider delivery idempotent, revalidate recipients and exact allocations, and preserve completed or actively processing work on resubmit.
- Treat final installer-request consent as explicit sharing of every active project image present at that request boundary.
- Keep arbitrary PDFs and documents private unless the customer separately approved them for installer sharing.
- Replace the first-three-step extract with the complete ordered privacy-safe plan, protected preview and protected PDF.
- Render every authorised evidence card with concurrent image loading, partial-success preservation and a protected download fallback.
- Clear protected plan and photo state across installer identity changes and revoke object URLs.
- Show accessible checking, save, upload percentage and dispatch phases, with eight-second and 25-second reassurance.

### Acceptance gates

- Customer submission does not await Resend, the administrator webhook or installer allocation.
- Every active request-bound project image is available to each exact eligible allocation and every prohibited installer receives a denial.
- The complete plan and PDF exclude identity, exact location, contact details, private notes, routines, permission notes, adviser identity, customer-written arbitrary items, evidence filenames and meter data.
- One durable operations alert and one business alert per exact eligible allocation are queued automatically and cannot be duplicated by repeated requests.
- Protected trade state cannot survive sign-out or installer UID change.
- Backend-focused dispatch, timing, notification and property-arrival tests pass 32 of 32.
- The complete non-release-integrity suite passes 941 tests with 939 passed, 2 intentionally skipped and 0 failed.
- Type checking, warning-free lint, all 89 migrations through `0088_customer_opportunity_dispatch_jobs.sql`, tagged-PDF audit, Vinext build, Sites bundle audit and `git diff --check` pass.
- GitHub, Sites managed source, saved-version provenance and public deployment all resolve to application commit `059f2ff8d3885b3453dd38d7dee8e660fd05c4fb`.
- The local archive is 7,107,950 bytes with SHA-256 `D32307C4B0FABF955FB4CF878CBD31290F053E06BA3CA67A92DBFBED6FD262E4`; Sites reports 318 stored files, 27,873,280 bytes and content hash `sha256:6c489fbaa560f2df5dc6cb9d807d1ae7c1d7b7a752632909bc45bc1f71a9c090`.
- Sites deployment succeeds with environment revision 19.

The executable and deployment gates are met. Live signed-in complete-plan and complete-photo presentation, measured production submit duration, and operations and business inbox receipt remain bounded acceptance checks until verified with the existing working-demo sessions. They are not inferred from provider configuration.

## Released milestone: CUSTOMER-QUOTE-COMMS-20

Release status: application commit `35552796048df63c03409d03401d33a47f326434` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly at `https://compare.ausenergyassessments.com` as Sites version 238. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_c9b4dbcee8408191a3fdce1aaef5548d`, deployment `appgdep_6a6c5f96df388191a5e68ffd53fb68b0` and environment revision 19 report the exact application commit.

### Outcome

Make each quote transition obvious without requiring either party to remember to revisit the platform: notify the customer when an installer submits a quote, keep every current and historical project quote in one top-level quote centre, and notify the verified trade by both email and the signed-in Work updates queue when the customer accepts and releases contact details.

### In scope

- Add a top-level customer Quotes destination, an action-only waiting count, an overview alert, quote-aware project actions and deep links that focus the project quote section.
- Keep reviewing, shortlisted, accepted and declined project quotes findable in the quote centre, with the retained direct-service quote tool clearly separated below them.
- Send the customer a privacy-safe account email after a structured installer quote is committed, linking directly to the signed-in quote centre.
- Send the accepted installer a privacy-safe email and one Work updates item after customer acceptance, stating that contact details are available only inside the signed-in exact lead and prompting the trade to call, email and schedule the next step.
- Validate one exact opportunity match, fetch it through the installer-owned route, clear stale lead filters, focus the matching lead card and keep customer identity out of the notification payload.
- Add durable activity events, delivery attempts and provider callback history with frozen retry payloads, bounded retry, current consent and recipient rechecks, suppression handling and monotonic Resend callback state.
- Give each intentional quote submission a stable request identity and monotonic revision, preserve one authoritative submitted version across retries and reject stale concurrent writes without duplicating the customer email.
- Make customer acceptance immutable and idempotent so repeated confirmation cannot duplicate the installer email or Work update.
- Move keyboard focus into the Work updates dialog when it opens, restore focus to the bell for ordinary close actions and remove the full-screen dismiss surface from keyboard order.

### Acceptance gates

- Quote state and its corresponding durable activity event commit together before either provider email is attempted; provider work runs outside the customer or trade request and retains the minute drain as recovery.
- Customer and installer recipient readiness, consent, active access, exact contact release and suppression state are rechecked immediately before sending.
- Retry and callback tests prove one request identity survives retries, stale writes cannot replace a newer quote, delivery payloads remain immutable, terminal provider states are monotonic and replayed callbacks do not duplicate effects.
- The focused customer quote, notification and delivery suites pass 26 of 26 tests, and the ordered Resend callback suite passes 7 of 7.
- The complete release gate passes type checking, warning-free lint, 31 of 31 integration tests, 973 total tests with 971 passed, 2 intentionally skipped and 0 failed, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the tagged-PDF audit, Vinext build and Sites server-bundle audit.
- Signed-in Chrome verification on the public custom domain confirms the top-level customer Quotes centre, its accepted quote card, and the trade Work updates bell, dialog and accepted event. Focused automated tests cover project-section focus and exact accepted-lead targeting.
- GitHub, Sites managed source, saved-version provenance and public deployment all resolve to application commit `35552796048df63c03409d03401d33a47f326434`.
- The local archive `aea-sites-3555279.tar.gz` is 7,110,732 bytes with SHA-256 `387A5D0FC4A5BF74DB78964348EC3577457818FBC9BC35F86BCFF1C04F83B616`; Sites reports 321 stored files, 27,965,440 bytes and content hash `sha256:291666539b26173a276dc09c76bbba6e94955b434d6ab5f524b850e5cda6ad52`.
- Sites version 238 deploys successfully with environment revision 19 at `https://compare.ausenergyassessments.com`.

The executable, deployment and signed-in workflow gates are met. Production customer and trade inbox delivery remains unverified; durable queue state, provider acceptance and callback handling do not prove final inbox receipt.

## Released milestone: CUSTOMER-TRADE-CONTACT-21

Release status: application commit `97e6c7356483706e8e978ab53b842a9e41152f7e` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly at `https://compare.ausenergyassessments.com` as Sites version 239. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_ae43b05060ac8191918c70e9960e213c`, deployment `appgdep_6a6c7cb6d6e0819187e9566a452e6850` and environment revision 19 report the exact application commit.

### Outcome

Replace the drawn-out shortlist-and-accept journey with one plain-language customer choice to get in touch with a verified business, make newly allocated leads visible in the trade Work updates bell, keep the lead workspace compact, align the structured quote form, and return every project-builder Continue action to the start of the next step.

### In scope

- Use one `Get in touch with this business` action for the customer. The confirmation shares contact details only with that exact business and asks it to make contact.
- State at the decision and connected states that getting in touch does not accept a quote, create a contract or invoice, make a payment, or authorise work.
- Commit the one-business contact claim, exact contact release, match connection, competing-option closure, consent receipt, activity event and durable trade notification together.
- Preserve the legacy internal `accepted` decision identifier only as a compatibility representation of the one-business contact claim. It is not customer-visible acceptance and cannot be treated as commercial approval.
- Reject a first-time contact release attempted through the legacy acceptance flag; that flag is honoured only when the exact contact release and match connection already exist.
- Derive a deterministic unread `New lead ready to review` Work update from each exact owner-scoped opportunity allocation without exposing customer identity, contact details or private household content.
- Collapse lead tiles by default, retain a compact work, timing, file-count and next-action summary, and provide accessible expand and collapse controls. Exact deep links expand and focus their authorised lead.
- Group and align the structured quote fields into responsive sections without changing integer-cent calculations or immutable submission contracts.
- Move the project builder to the active step heading after Continue using a reduced-motion-aware two-frame scroll and focus transition.

### Acceptance gates

- The customer contact action performs one owner-scoped API write and cannot leave contact release, match connection and one-business selection out of sync.
- A stale client cannot use the legacy acceptance flag to create first-time contact disclosure.
- Customer and trade surfaces contain no wording that implies payment, contract formation, invoice creation, quote acceptance or work authorisation.
- Every allocated lead produces one deterministic owner-only bell item; technicians and other businesses cannot receive it.
- Lead cards are collapsed by default, deep-link expansion remains exact and keyboard operation is preserved.
- Focused customer-contact, notification, trade-lead, quote-layout, privacy and wizard-navigation regressions pass.
- The complete release gate passes type checking, warning-free lint, 31 of 31 integration tests, the full test suite with no failures and 2 intentional skips, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the customer-plan PDF audit, Vinext build and Sites server-bundle audit.
- GitHub, Sites managed source, saved-version provenance and public deployment all resolve to application commit `97e6c7356483706e8e978ab53b842a9e41152f7e`.
- Local archive `aea-sites-97e6c73.tar.gz` is 7,127,725 bytes with SHA-256 `BF9EAAE34B1FBB197C30AF94F0ADB9DBE92BBC347F8B60424C6D0444D9FCD7DF`; Sites reports 321 stored files, 27,985,920 bytes and content hash `sha256:8554bdbdbcc6c54afc9b04cb4d37b96d7ab423ed2ed64d591247bfa3ee6c6136`.
- Sites version 239 deploys successfully with environment revision 19 at `https://compare.ausenergyassessments.com`.
- Signed-in Chrome verification confirms three unread new-lead bell items, compact collapsed lead cards, exact expansion, the customer Quotes centre and the connected-state contact-only disclosure.

The executable, deployment, privacy and signed-in presentation gates are met. Release QA did not submit another quote, release another customer contact, send a new provider email or mutate demo records. Production provider inbox delivery and hosted row counts remain unverified. The direct `/api/health` browser navigation was blocked by the local client extension, while the custom-domain signed-in application and its authenticated APIs rendered successfully.

## Released milestone: CUSTOMER-PLAN-TRADE-ENQUIRY-22

Release status: application commit `b40c101939eec44b178b34ccb6397a989d2467d0` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly at `https://compare.ausenergyassessments.com` as Sites version 240. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_f26581d5ff348191855551ce325e8c40`, deployment `appgdep_6a6c971b63988191a92e4031fc74692b` and environment revision 19 report the exact application commit.

### Outcome

Turn the completed public home-energy roadmap into one privacy-first trade-enquiry path without repeated entry, extend the home-system questions so each answer changes safe and brand-neutral advice, and put released customer identity and contact details first for connected trade leads.

### In scope

- Replace `Continue in my free account` with `Enquire with verified trades` in the roadmap action area and at the true bottom of the public plan page.
- Explain why account creation or sign-in is the next step: the plan and household data stay private, installers first receive a non-identifying scope, and the customer controls any later contact release.
- Preserve the exact selected planner query through account creation or sign-in so the customer does not repeat earlier answers.
- Distinguish gas storage hot water, gas continuous-flow hot water and unknown. Treat the legacy generic gas value as unknown instead of guessing.
- Add household-reported single-phase, three-phase and unknown electricity-supply choices as planning clues only; a licensed electrician must confirm supply and capacity.
- Separate fixed openings, exhaust discharge and backdraft or damper questions. Require all three before the evidence set is complete, target the first unresolved follow-up and never direct a customer to perform an unsafe inspection.
- Put customer identity and contact details first when a connected trade lead is expanded, with the protected plan, customer-shared files and quote controls following below.

### Acceptance gates

- The focused customer-plan, home-system, handoff and connected-lead suites pass 99 of 99 tests.
- The independent public-plan review passes 52 of 52 tests and type checking.
- The independent trade review passes 13 of 13 tests.
- The complete release gate passes type checking, warning-free lint, 31 of 31 integration tests, 994 total tests with 992 passed, 2 intentionally skipped and 0 failed, all 92 migrations through `0091_customer_project_quote_acceptance_claims.sql`, the 9-page customer-plan PDF audit, Vinext build and Sites server-bundle audit.
- `git diff --check` is clean.
- GitHub, Sites managed source, saved-version provenance and public deployment all resolve to application commit `b40c101939eec44b178b34ccb6397a989d2467d0`.
- Sites version 240 deploys successfully with environment revision 19 at `https://compare.ausenergyassessments.com`.
- Production browser verification confirms both `Enquire with verified trades` actions, the exact selected-query handoff and the account privacy explanation. Signed-in Chrome verification confirms customer identity and contact details first in an expanded connected lead.
- The live verification records zero Worker error events and does not mutate production, customer, trade or demo data.

The executable, deployment, privacy and signed-in presentation gates are met. No release archive was uploaded for Sites version 240, so archive hashes and Sites stored-file counts or bytes are not recorded for this release.

## Released milestone: CUSTOMER-ACCOUNT-TRUST-23

Release status: application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly at `https://compare.ausenergyassessments.com` as Sites version 241. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_2149679b0df08191a77cd91ac13d9cc7`, deployment `appgdep_6a6caabc547c81919c4642b1f7cfcde1` and environment revision 19 report the exact application commit.

### Outcome

Make the remaining household ventilation intake answerable without technical building knowledge, make email account creation visibly usable, and return a newly verified customer to an account state that refreshes the trusted Firebase identity instead of relying on a stale token.

### In scope

- Replace separate exhaust-discharge and backdraft-damper questions with one shared kitchen and bathroom exhaust-fan question used by public `/plan` and the signed-in project builder.
- Ask only whether a kitchen exhaust fan or rangehood and a bathroom exhaust fan are fitted, with explicit `No fans` and `Not sure` choices.
- Explain that the household does not need to know where a fan vents or whether it has a shutter or damper.
- Migrate legacy technical ventilation selections conservatively to `Not sure` unless the household has already provided a newer explicit fan answer.
- Keep technical discharge-path confirmation as later qualified-trade work when moisture does not clear, not as a customer intake requirement.
- Style every account email input, including the password control, as a visible full-width control with a persistent password requirement.
- Present equal create-account and sign-in tabs with a high-contrast selected state, keyboard focus and responsive sizing.
- Pass an authorised current-origin return URL to Firebase's hosted customer verification action handler.
- Reload the customer identity and force a fresh ID token before the application trusts a newly verified email state.
- Report verification-send failure accurately instead of claiming that a link was sent.

### Acceptance gates

- Public and signed-in planners expose the same simple exhaust-fan choices and no customer-facing discharge-path or damper question.
- The password field is visible, at least 48 pixels high, full width and programmatically associated with its persistent requirement.
- Create-account and sign-in choices have equal responsive geometry, explicit selected state and accessible focus behavior.
- Customer account creation and resend use the same bounded verification return settings.
- A verification refresh calls Firebase user reload before checking `emailVerified` and forces a fresh ID token before loading trusted account state.
- Verification-send failures cannot be silently represented as successful delivery.
- Focused customer and trade-isolation tests, type checking, warning-free lint, the complete validation gate, production build and Sites server-bundle audit pass.
- GitHub, Sites managed source, saved-version provenance and public deployment all resolve to application commit `da4fa911c0b6c7f520e266259af8882b95aaf14a`.
- Live desktop verification confirms the simplified planner wording, visible password, equal tabs and a working `/account?verification=complete` return route with no browser or Worker errors.

The executable, source-provenance, production presentation and error-log gates are met. Release QA did not create a new account or send a verification email, so receipt and successful use of a newly generated provider email link remain unverified.

## Released milestone: CUSTOMER-TRADE-LOCALITY-24

Release status: application commit `399b04f4a5d680080610f9e88b994506bb60c16f` is validated, pushed to GitHub and the Sites managed source branch, and deployed publicly at `https://compare.ausenergyassessments.com` as Sites version 242. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_bc9f3157a9e88191881c5989f7de7ba0`, deployment `appgdep_6a6cc08dc6f881919a349de607f5a8a9` and environment revision 19 report the exact application commit.

### Outcome

Keep the installer-request consent and any missing-consent explanation beside submit, make the customer and TLink navigation aligned and reciprocal, and give eligible installers the customer-confirmed suburb, postcode and state without exposing identity, street address, unit or private project content.

### In scope

- Move the installer-request consent into the sticky action area immediately above submit and keep its error, focus and accessibility association at that decision point.
- Fit the request dialog to the current viewport and retain a usable internal scroll and sticky action area on a 360 by 800 mobile viewport.
- Reuse one aligned customer navigation on the account dashboard and profile, with current-page semantics and a branded TLink destination.
- Add the real white Australian Energy Assessments mark and full-name return destination to public and signed-in TLink headers.
- Add immutable opportunity suburb through `0092_trade_opportunity_matching_locality.sql`, alongside the existing postcode and state snapshot.
- Gate suburb and postcode presentation on an active exact-project receipt for current notice version `2026-08-01-anonymized-matching-locality-v1` and purpose `anonymized_installer_matching`.
- Use the same immutable snapshot and consent gate for trade leads and business-notification emails.
- Keep legacy, missing, mismatched and withdrawn consent state-only and do not backfill locality from a mutable customer profile.
- Retain name, phone, email, street, unit, precise distance, project names, private notes, meter data and unapproved files outside installer matching.

### Acceptance gates

- Focused consent, navigation, privacy, locality, trade-enquiry and notification tests pass 96 of 96.
- The complete release gate passes type checking, warning-free lint, 31 of 31 integration tests, 1,014 main tests with 1,012 passed, 2 intentionally skipped and 0 failed, all 93 migrations through `0092_trade_opportunity_matching_locality.sql`, the nine-page customer-plan PDF audit, Vinext build and Sites server-bundle audit.
- Targeted ESLint and `git diff --check` pass.
- GitHub, Sites managed source, saved-version provenance and public deployment all resolve to application commit `399b04f4a5d680080610f9e88b994506bb60c16f`.
- Customer navigation remains aligned at desktop, 900 and 768 pixel widths and produces no document overflow at 520 pixels; the profile route uses the same navigation and exposes its current page.
- TLink retains the full Australian Energy Assessments return at 520 pixels and wraps cleanly at 900 pixels without document overflow.
- At 360 by 800 pixels the installer-request checkbox, missing-consent alert and submit action remain together and visible at the decision point.
- The production preview explains protected suburb, postcode and state while retaining street, unit, contact and private-data exclusions.
- The Sites Worker error-only query returns no events and release verification does not create a production opportunity.

The executable, migration, source-provenance, consent-presentation, responsive-navigation and error-log gates are met. Release QA deliberately did not submit a new production enquiry, so a newly written version-242 locality row and locality-bearing business email were not observed live. Existing opportunities remain state-only by design and are not backfilled.

## Released milestone: CREDITEX-COMPLIANCE-OPERATIONS-25

Status: released activity-agnostic Creditex operations portal with an empty governed catalogue

### Outcome

Establish the first case-centred Creditex operations slice in TLink across every program and activity, not one example activity. An installer can link an exact governed activity and evidence-policy version to a guided job, the field app can preserve and upload the original evidence chain, and Creditex can administer, triage, inspect, correct and dual-control the case without treating an estimate, export or local ledger entry as a regulator action.

### In scope

- Separate compliance organisations, verified invitation-only memberships and server-enforced administrator, case-manager, reviewer and auditor roles.
- Effective-dated programs, activities and evidence policies with distinct official code, specification part, product category and scenario fields, source SHA-256, exact case pinning and irreversible publication or withdrawal.
- Atomic job and case creation with category, jurisdiction and planned-date checks; participant abilities, equipment, assignments, tasks, findings and immutable case events.
- Requirement-led AEA Field capture of exact original bytes, SHA-256, capture and location envelope, registered-device provenance, encrypted offline queue, resumable upload and rejected-evidence supersession.
- A no-index Creditex portal with exception-led queues, bounded searches and filters, case workspace, evidence review, audited same-user evidence-view receipts, corrections, dual-control decisions, access administration and provider-neutral batch staging.
- A persistent bottom Dashboard and governed-program workspace bar, with activity, category and scenario remaining separate program-scoped dimensions.
- Dataforce-equivalent advanced filter families and deliberate audited access to private customer, installer, site, appointment and commercial case detail.
- Server-derived decision bases that pin the exact revision, government-rule and source hashes, canonical evidence digests, findings and any verified calculation run. A withdrawn policy remains available for correction and audit but blocks approval and staging.
- Data models and read-only portal projections for participants, abilities, equipment, calculators, batches, artifacts, responses, certificate lots, trades and settlements. External execution remains disabled.
- A controlled [Australian program source register](./docs/compliance/AUSTRALIAN_PROGRAM_SOURCE_REGISTER.md), [Creditex operating model](./docs/compliance/CREDITEX_OPERATING_MODEL.md) and [Dataforce and Runabout parity record](./docs/compliance/CREDITEX_DATAFORCE_PARITY.md).

### Excluded until later governed milestones

- Publication of any real activity or evidence policy before the exact effective government instruments are independently verified and Creditex approves the transcription for use within its current accreditation, contractual operating authority and connector scope.
- Unverified certificate or rebate calculations, customer price promises, registry submission, certificate creation, trading, settlement or manually asserted external responses.
- A live Dataforce or Runabout import, connector, cutover or retirement. Complete parity remains blocked on authorised exports, field dictionaries, reports, formulas and a Runabout walkthrough.
- Production regulated cases. The production catalogue starts with no published activities or evidence policies and therefore cannot open a live claim.
- Approved retention, legal hold, backup, restore, real-device acceptance, regulator connector credentials or a broad Creditex team rollout.

### Acceptance gates

- Every active case pins an immutable published activity and complete evidence policy; withdrawn policies retain correction and audit access while approval and staging fail closed.
- The job, case and first event commit together or not at all, and child-record, assignment, evidence, batch and ledger tenant boundaries fail closed.
- Creditex access requires an email-verified exact Firebase identity, active organisation, active membership, allowed role and, for reviewer or auditor evidence, an active case assignment.
- Creditex administrators retain the explicit organisation-wide exception. Every non-admin case detail and case-specific write requires a current active assignment.
- Queue load and filter changes never auto-select a case or fetch private details, and stale responses cannot overwrite a newer program, filter or case state.
- An accept or reject action requires a recent same-user evidence-view receipt; the primary decision basis is generated on the server and cannot be replaced by a secondary reviewer or caller-authored JSON.
- Evidence completion, abort, expiry and device revocation races cannot delete the completion winner; original bytes and their server-verified hash are retained, and database guards block deletion of evidence-linked media.
- Auditors remain read-only, a final administrator cannot demote or suspend themself, and all governed writes and access events are immutable and organisation-scoped.
- The complete repository and mobile validation gates, independent final review, exact release provenance and public portal checks pass before this milestone is described as released.

Exact application commit `7b08cb600bde30273774a544e07039acc6de1c03` passes the post-review 54-test Creditex portal, API and operations-control set, the final 38-test D1 aggregate subset and the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 1,089 main tests with 1,087 passed, 2 intentionally skipped and 0 failed, all 98 migrations through `0097_creditex_operations_lifecycle.sql`, the customer-plan PDF audit, production build and Sites server-bundle audit. Runtime trigger verification now ignores formatting-only whitespace outside quoted SQL while remaining fail-closed on substantive changes. Independent release review found and closed two P1 access/privacy defects and one P2 stale-response defect before the current deployment.

Sites saved version 248 from the exact application commit and deployed it through `appgdep_6a6d733ea23c81918f4ccd8e4f30f98b` with environment revision 19 at `https://compare.ausenergyassessments.com`. Signed-in live QA confirmed the administrator dashboard, Dataforce-parity advanced filter groups, persistent program bar, access controls and separate program and activity governance. Intermediate version 247 restored sign-in but exposed one local-SQLite-only compound aggregate; version 248 replaced it with a bounded D1-compatible aggregate and loaded the live operations endpoint successfully. No case was auto-selected and no production data changed. The post-release Sites Worker error-only query returned zero events. Physical-device capture, hosted production evidence viewing, non-admin production acceptance, backup and restore, government-source transcription accuracy, approved calculator provenance and registry behavior remain unverified or blocked until separately accepted.

## Released milestone: CREDITEX-EVIDENCE-POLICY-GOVERNANCE-26

Status: released activity-agnostic evidence-policy governance and exact-byte verification

Release status: application commit `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` is validated, pushed to GitHub and the Sites managed source branch, and deployed at `https://compare.ausenergyassessments.com/creditex/compliance` as Sites version 249. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_bf90b67a89508191bbea3f1a2d926719` and deployment `appgdep_6a6da8704be08191a4d310adb523e0f3` report the exact application commit.

### Outcome

Make the Creditex government-source workspace genuinely activity agnostic and safe to extend. Administrators can transcribe verified, program-scoped, effective-dated activity and evidence requirements into drafts, keep each program in a persistent bottom workspace, narrow work to one activity version and move an exact sealed transcription through independent publication review. Creditex verifies and operates that transcription within its accreditation and contractual scope; it does not author private program rules. AEA Field receives only published requirements it can currently execute. The server verifies assembled evidence bytes rather than trusting client-supplied EXIF claims.

### In scope

- Program workspaces remain separate bottom tabs. Activity code, specification part, product category and scenario remain separate fields and activity-scoped filters inside each program.
- Draft evidence-policy transcription includes ordered requirement code, evidence type, capture timing, minimum and maximum count, original, metadata, GPS and date requirements, signature flags, allowed file types, conditional JSON, dynamic-field JSON and exact official source citation.
- Policy and publication-history queues are independently paginated and scoped by program and activity. Terminal decisions remain visible as immutable history.
- Publication requires a named administrator request and a different named administrator decision over the same canonical snapshot and SHA-256. The shared bootstrap mailbox can maintain drafts but cannot request or approve publication.
- Database guards enforce pending-only request creation, immutable terminal decisions, sealed content during review, publication provenance, immutable published content and atomic required write steps.
- Governed field capture accepts only policy types and file formats supported by the current app. Unsupported signatures, conditions, dynamic fields, evidence types and trusted-original requirements block publication.
- JPEG evidence is parsed again from the assembled server bytes. Required embedded EXIF, GPS and capture time must exist; embedded GPS must agree with the registered-device reading; embedded local time must agree with the retained timezone, UTC offset and device capture time. The server-stamped verification result and exact byte hash are retained with the evidence envelope.
- Finite evidence maxima are enforced both during initiation and atomically at evidence insertion.

### Deliberate safety boundaries

- No public research row is activated as a real government requirement. The production catalogue remains empty until exact effective official instruments are independently verified and Creditex approves their operational transcription within its accreditation, contractual operating authority and connector scope.
- Embedded EXIF proves only what is present in the uploaded bytes. It does not prove that a camera created the bytes, that the file was never edited or that the device is regulator accepted. Any policy requiring trusted original-camera attestation remains blocked.
- PNG, WebP and PDF signatures are checked from assembled bytes, but governed metadata, GPS and capture-time requirements currently require a valid JPEG.
- Certificate quantities, rebate values, customer price reductions, product eligibility, registry actions, certificate creation, trading and settlement remain disabled without separately approved calculators and connectors.
- The complete Dataforce and Runabout inventory is still unknown. Observed filter families remain visible, but a subfilter with no authoritative TLink relationship stays explicitly unavailable rather than being inferred.

VEU `6(23)` remains a test example only. It has no privileged implementation path.

Exact application commit `d40c803bfa0b614ed806624a375a1fa47bd0e5a4` passes the complete `npm run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, 1,157 main tests with 1,155 passed, 2 intentionally skipped and 0 failed, all 99 migrations through `0098_creditex_rule_governance.sql`, the customer-plan PDF audit, production build and Sites server-bundle audit. AEA Field passes type checking, lint, 8 of 8 tests and Android and iOS export. Expo Doctor reports 19 of 20 because of dependency patch drift.

The 7,352,352-byte local package has SHA-256 `4E9087A40A00613E4BBDD111D8D5E1CA4A3A5AED01BCF3DA8DD9635396CF920F`. Sites stored 332 files and 29,276,160 bytes with content hash `sha256:3e66780f5d61ae46c650df39c711a9a26166f75f7d9eb58cf8461a39dc7bc123`. Saved version 249 reports the exact application source and deployment `appgdep_6a6da8704be08191a4d310adb523e0f3` succeeded. The provider URL is `https://aea-energy-comparison.info294029.chatgpt.site`.

Signed-in Chrome QA as the AEA Creditex administrator with the `Admin` role confirmed that reload progressed from the protected loading state to Operations without a stuck sign-in. The work queue, advanced filters, bottom Dashboard and program rail, activity-source governance, evidence-policy transcription, four-eyes notice and Access membership screen loaded. The real production catalogue and case inventory remains deliberately empty at 0 governed programs, 0 activity versions, 0 policies and 0 cases. Release QA performed no production mutation.

## Released milestone: CREDITEX-GOVERNMENT-ACTIVITY-WORKFLOW-27

Status: released national activity discovery and controlled compliance handoff

Release status: application commit `a33b7053301a64bea4bbcbe76713067a2c1782dd` is validated, pushed to GitHub and the Sites managed source branch, and deployed at `https://compare.ausenergyassessments.com/creditex/compliance` as Sites version 251. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_a8b4368a16a88191be90ea1a3ce33481` and deployment `appgdep_6a6dbc598f0c81918d1e6656addd0463` report the exact application commit.

### Outcome

Replace the single-activity mental model with a national, program- and activity-agnostic baseline. The signed-in Creditex portal now exposes a discovery-only catalogue of 32 Australian government program pathways and 207 controlled activity templates, grouped across federal, state and territory jurisdictions. Installers create the compliance handoff only after the separate customer quote and acceptance journey, using chained program, activity, product-category, scenario and exact effective-version dropdowns. Creditex administrators then operate the complete audited case workflow, including deliberate access to private customer, installer, site, appointment, evidence-original and metadata detail.

Government departments, regulators and scheme administrators remain the sole authors of program rules. Creditex verifies the exact operational transcription, audits evidence, manages corrections and performs authorised program actions within its accreditation and contractual connector scope. The reference catalogue does not activate a rule, calculate an outcome or create a certificate. It distinguishes tradable certificates and project credits from retailer obligations, rebates, grants, loans, tariffs and procurement outcomes.

### Delivered controls

- Persistent program and activity tab rows mirror the useful Dataforce separation while keeping all activities in one typed workflow.
- Controlled program, activity-template and outcome-class selectors replace free-text entry where authoritative options exist.
- Guided job setup chains program, activity, product category, scenario and effective governed version. VEU `6(23)` remains one ordinary test template and has no privileged path.
- The administrator dashboard states and enforces deliberate, audited organisation-wide access to private case data; default queues remain privacy minimised.
- The shared `info@ausenergyassessments.com` account can maintain drafts and invite named members but cannot request or approve publication. Publication still requires two different independently verified named administrators.
- The public reference catalogue is source-linked and reviewed as at 1 August 2026. Production governed records remain at 0 programs, 0 activity versions, 0 policies and 0 cases until exact instruments are independently verified and imported.

Exact application commit `a33b7053301a64bea4bbcbe76713067a2c1782dd` passes the complete `npm.cmd run validate` gate: type checking, warning-free lint, 31 of 31 integration tests, the complete main test suite, all 99 migrations through `0098_creditex_rule_governance.sql`, the customer-plan PDF audit, production build and Sites server-bundle audit. The catalogue-focused suite passed 30 of 30 tests, the final portal regression set passed 21 of 21, and `git diff --check` passed.

The 6,790,614-byte local package has SHA-256 `B14686D098A1FF76D8DBF1F2CA26DE2AABB6D600D991289891A9CF31C6E50FFB`. Sites stored 178 files and 18,227,200 bytes with content hash `sha256:917cf16e38b0a69e2081992a8f2944699bf9492b78f40c8ce4745b55612bf285`. Deployment `appgdep_6a6dbc598f0c81918d1e6656addd0463` succeeded with environment revision 19.

Signed-in production QA confirmed the dashboard no longer stalls at sign-in, the 32-program and 207-activity source catalogue, controlled template and outcome selectors, separate program and activity tabs, corrected audited-private-case wording and the shared-account governance boundary. No production records were changed. The post-release Sites Worker error-only query returned zero events.

## Forward phases

### Phase 0: apply operating restrictions

Priority: P0

Audit source: RM-000 and RM-060

- Keep payment initiation and checkout absent from Sites, exclude payment providers from the active integration model, and retain only inert webhook acknowledgements while any external registration remains unreconciled.
- Withdraw the generic Database Console and replace it only with named, least-privilege diagnostics or domain repair commands where justified.
- Complete FREE-ACCESS-ABN-01.

Exit gate: production-safe negative checks prove that blocked payment and generic database mutation paths are unavailable, and approved ABN review is enforced at every trade entry boundary.

### Phase 1: establish ownership and recoverability

Priority: P0

Audit source: RM-010 and RM-020

- Name legal, billing, data, security and release owners.
- Maintain at least two human administrators for every production component.
- Obtain complete owner-held exports of relational data and private objects.
- Restore into an isolated owner-controlled environment.
- Reconcile schema, row counts, identifiers, monetary aggregates, audit chains and object hashes.
- Approve recovery and data-loss objectives from measured restore evidence.

Exit gate: two successive protected exports and one isolated restore reconcile without changing production.

### Phase 2: resolve privacy, industry and product authority

Priority: P0

Audit source: RM-030

- Confirm the legal entity and data-controller boundaries.
- Approve privacy notices, consent, retention, deletion, breach and overseas-disclosure rules.
- Define the exact evidence required for ABN, licence, insurance, accreditation and supplier review.
- Remove or block any public service or claim that lacks current authority.

Exit gate: each released workflow and material claim has an accountable owner, jurisdiction, evidence source and review date.

### Phase 3: make source and release truth verifiable

Priority: P1

Audit source: RM-040 and RM-065

- Maintain the dated audit as immutable history.
- Keep one concise release truth, one forward roadmap and one executable handover.
- Reconcile all migration files, journal entries and applied-state evidence.
- Generate route, schema and release inventories where practical.
- Fail validation on broken internal links, contradictory current status or missing release provenance.

Exit gate: exactly one current authority exists for each status subject, all retained routes have owners or retirement contracts, and migration provenance is complete.

### Phase 4: provision the owner-controlled production target

Priority: P0

Audit source: RM-050 and RM-060

- Select a managed modular-monolith target from approved requirements.
- Provision separate development, staging and production accounts through infrastructure as code.
- Use managed PostgreSQL, versioned object storage, owner-controlled identity and secrets, durable jobs, observability and tested recovery.
- Select an Australian region where approved requirements demand it.
- Establish MFA, session revocation, break-glass access, CSP and explicit route authorization.

Exit gate: an empty staging environment can be recreated from reviewed configuration and two administrators can operate and recover it.

### Phase 5: migrate data and prove core workflows

Priority: P0

Audit source: RM-070 and RM-080

- Build restartable full and delta imports for all authorised relational and object data.
- Preserve stable IDs, timestamps, integer-cent values and immutable event chains.
- Prove the selected customer, trade, admin and field workflows end to end.
- Activate only providers with accountable ownership, sandbox evidence, reconciliation and recovery procedures.

Exit gate: repeated migration rehearsals produce no unexplained variance and every launch-critical workflow passes authorization, privacy, accessibility and provider acceptance.

### Phase 6: operate, cut over and retire safely

Priority: P0

Audit source: RM-085, RM-090, RM-100 and RM-110

- Establish service objectives, durable telemetry, alerting, capacity tests and recurring restore drills.
- Run shadow parity against production-safe representative workflows.
- Use a bounded cutover with an explicit abort threshold and rollback window.
- Retain the source only for the approved fallback and records period.
- Revoke obsolete credentials and decommission only after reconciliation and owner approval.

Exit gate: cutover evidence, rollback proof, archival custody and post-cutover monitoring are complete.

VEU `6(23)` was an informal example only, not an official activity identifier. The governed family is Part `6`; categories and scenarios remain separate source-controlled dimensions, and no activity has a privileged implementation path.

## Released milestone: CREDITEX-VEU-SYNTHETIC-PILOT-28

Status: released controlled VEU workflow pilot

Release status: the initial pilot application commit `3ac6c72057a8afea61e85817ba566ec543079886` was deployed as Sites version 252. Corrective application commit `ebae330dab6c42881c14bc57548095b111d9c850` retains the complete pilot, hardens authentication recovery and was deployed at `https://compare.ausenergyassessments.com/creditex/compliance` as historical Sites version 253. Saved version `appgprj_6a550c378000819185caf094173422bb~appgver_900ff3f8d0448191a798a5eb10ef648c` and deployment `appgdep_6a6dde1747308191bf5c78bd4f674030` report the exact historical application commit.

### Outcome

Provide Creditex with one production-hosted but rigorously isolated workflow pilot for the installer-to-compliance handoff. The live seed contains 10 visibly synthetic installer companies, three assignment-only field technicians per installer and ten VEU jobs per technician: 10 installers, 30 technicians and 300 jobs balanced across all 34 represented VEU activity families.

The portal separates Pilot control, Jobs, Sources, Lookups, Evidence, Calculators and Connectors into workflow-focused areas. It provides pre-populated filters and a fixed bottom Dashboard plus one tab per VEU family. Government and regulator instruments remain the sole rule authority; Creditex verifies and operates within those rules and does not own a private rule pack.

### Delivered controls

- Deterministic seed creation and archive require a recently authenticated administrator and an exact confirmation phrase.
- Every synthetic company, technician, customer, site, appointment and job is visibly labelled `TEST`, uses non-deliverable contact data and creates no Firebase technician identity.
- Database triggers prevent synthetic work orders from entering regulated compliance cases or submission items.
- The 300-item dry-run manifest hashes immutable population fields only and remains valid after controlled workflow-state changes.
- Test-only review, evidence-transport and lookup states use organisation-scoped compare-and-swap revisions with append-only audit events.
- All unverified evidence shot lists, operational lookups, formulas and registry connectors fail closed. The pilot calculates no VEEC quantity, creates no certificate and sends no external request.

### Validation and release evidence

Exact historical application commit `ebae330dab6c42881c14bc57548095b111d9c850` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,180 main tests with 1,178 passed, 2 intentionally skipped and 0 failed, all 100 migrations through `0099_creditex_synthetic_pilot.sql`, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit. The focused pilot suite passed 13 of 13 tests and the focused Creditex portal suite passed 25 of 25.

Authenticated production QA created seed `veu-v25-2026-08-01-synthetic-v2` and confirmed 10 of 10 installers, 30 of 30 technicians, 300 of 300 jobs and 34 of 34 activity families. Filtering installer `I01` plus Part `6` returned one job; a controlled job-state update persisted after refresh; the connector workspace retained a deterministic 300-item dry-run manifest; and structural counters remained 0 regulated cases, 0 Firebase test users and 0 certificates. Desktop and 390-pixel mobile inspection passed without page-level horizontal overflow. Version 253 bounds forced token recovery to one authentication-specific `401` retry, preserves signed-in identity on workspace failure and separates authentication from workspace errors. Signed-in production reload reopened the protected dashboard and the populated VEU job queue.

## Released milestone: CREDITEX-VEU-DENSE-REGISTER-29

Status: released dense synthetic VEU compliance register

Release status: exact application commit `e8d12a4b562de3f9ac5b6821c4e1b062547722e0` was validated, pushed to GitHub and the Sites managed source branch, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_d9dff81ff0c4819185def4ad16b9a889` and deployed as historical Sites version 254 through `appgdep_6a6dec1ba16c8191b572bf49dc958aa7`.

The milestone established one semantic row per synthetic job, 49 data columns plus one action column, 41 verified server-sortable fields, a menu on every heading and a row action control for every returned job. It retained every screenshot-derived Dataforce heading, explicit TLink installer and technician identity, 12 advanced-filter groups, 27 pre-populated selectors and all 34 VEU activity-family tabs. Unsupported legacy meanings remained visible as mapping gaps, and no issued VEEC quantity was fabricated.

## Released milestone: CREDITEX-VEU-OPERATOR-WORKSPACE-30

Status: released full-viewport Creditex operator and job audit workspace

Release status: primary implementation commit `e0e48b6a74a0515fe936f4882bead071b7bee443` became intermediate Sites version 255. Focus correction `c6fdbc42729adf1b2f5e9bca6822c298885a55d4` became intermediate version 256. Final production-D1 correction `1a535a0fd2237e8aa3dcf1daf82da009885197b0` was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_416748b2d09881919f375b0cf255789c` and deployed as historical Sites version 257 through `appgdep_6a6e119ef9c48191aa7a6da69463dd80`.

### Outcome

Use the available desktop space as a compliance operations tool rather than a marketing page. The register now owns its vertical and horizontal scrolling, supports compact and comfortable density, keeps the 300-job queue inside a full-height workspace and moves advanced search into a right-edge drawer. The drawer traps focus, makes the register inert, closes with Escape and returns focus to its trigger.

Right click, the row action control and keyboard access expose Dataforce-style Customer Details, Job, Appointment, copy and print menus. Double-click opens a full-viewport record with collapsible navigation and compliance rails. The record covers owner-scoped customer and private notes, service site, installer account, technician, work order, appointments, tasks, forms, quotes, invoices, files, issues, history, sources, lookups, evidence, calculators, connectors and job-level regulated counts.

### Safety and release evidence

- Same-origin Firebase identity and active Creditex membership precede every dashboard and detail request.
- Record access requires an active organisation-owned synthetic run, synthetic trade account, assignment-only technician and active owner-scoped synthetic work order.
- Private CRM data is loaded only after the scoped job identity is established.
- Raw evidence envelopes, storage keys and file bytes are not returned.
- Regulated cases, certificates, submissions, trades and settlements remain 0 and all external actions remain disabled.
- Exact final source passes `npm.cmd run validate`: 31 of 31 integration tests, 1,182 main tests with 1,180 passed, 2 intentionally skipped and 0 failed, all 100 migrations, PDF audit, production build and Sites bundle audit.
- The focused Creditex pilot suite passed 15 of 15 tests. Independent final review reported no remaining P0, P1 or P2 defect.
- Signed-in production QA loaded the 300-job register in a 2048 by 983 viewport without page-level overflow, verified the drawer and menus, and opened the complete authoritative job record.
- The initial 105-column production job-detail query was split into owner-scoped 63-column and 42-column reads. Production request `a245e793ac2756fc` returned HTTP 200 and the post-release error-only Worker query returned zero events.

## Released milestone: CREDITEX-VEU-OPERATOR-USABILITY-31

Status: released readable, compact Creditex VEU operator workflow

Release status: primary implementation commit `96ecb9698943445c57ba7f4caec99ff3839d3499` was validated, pushed to GitHub and Sites managed `main`, then saved and deployed as intermediate Sites version 258. Final heading correction `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1` is the historical exact application source for this milestone. It was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_195313bad4888191a7b5472c6b215cc5` and deployed as historical Sites version 259 through `appgdep_6a6e5248b7048191acfe5904b1d4628b`.

### Outcome

The 300-job register now uses a readable 12-pixel compact table type size, clearer supporting text and denser controls without adding page-level scrolling. Advanced search is a 19-rem right-edge drawer with Job, installer, VEU activity, review state and evidence state available together as quick filters. Secondary groups remain available but start collapsed, and the former installer roster is removed from the bottom of the workspace. Dashboard plus all 34 VEU activity-family tabs remain in the fixed bottom bar.

Each column menu is now one controlled disclosure. It closes after a sort choice, an outside pointer action or Escape, restores focus to its heading and cannot leave multiple stale menus open.

The official source register now records Victorian Energy Upgrades Specifications version 25 as effective from 21 July 2026, keeps version 24 as superseded comparison material and records both Part 6 branches in version 25. It no longer treats 30 September 2026 as a separate instrument. Government and regulator sources remain the only rule authority.

The direct-trade installer integration is designed as a proposed post-quote-acceptance handoff. TLink will derive accepted job, site, jurisdiction, date and scope facts server-side, then expose controlled Program, Activity, Product category and Scenario choices tied to an effective source version. This contract is documented but is not active runtime behavior while the governed catalogue remains empty.

### Safety and release evidence

- Exact final application commit `19a1e0b98db0cb7be5eae9e9e1371251220e8fc1` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete main suite, all 100 migrations, the customer-plan PDF audit, Vinext production build and Sites server-bundle audit.
- The focused Creditex VEU pilot suite passed 15 of 15 tests. `git diff --check` passed. Independent final review reported no P0 or P1 defect.
- Signed-in production QA at 2048 by 927 pixels confirmed no page-level overflow, a 303.2-pixel drawer, all secondary groups initially collapsed, exactly one installer filter and one activity filter, 30 installer matches, one combined installer and Part 6 match, outside-click dismissal, Escape dismissal, close-after-sort and focus return.
- Historical version 259 shows the compact `All VEU jobs` drawer heading without the crowded count badge.
- The final local archive is 6,894,158 bytes with SHA-256 `605BEE1AC610C7D4F82BD9CEBD5C2706B55BFB7F73B2640D1D5FBB6F041B21FF`. Sites stored 178 files and 18,780,160 bytes with content hash `sha256:81e8a258e445954acf669266c31c6fd7141d591925ff30148b6f70c4118172e9`.
- The real governed inventory remains 0 published programs, 0 activity versions, 0 evidence policies and 0 regulated cases. Source activation, installer case handoff, calculators and external certificate actions remain fail-closed.

## Released milestone: CREDITEX-CONTROLLED-INTAKE-FOUNDATIONS-32

Status: released controlled Creditex intake, custody and Dataforce-interchange foundations

Release status: primary application commit `c423f3c3938b43bf92c8ec98d285b49e63024ee6` was validated, pushed to GitHub and Sites managed `main`, then saved and deployed as Sites version 260. Signed-in QA found that the Sites package omitted migrations `0100` through `0105`, so version 260 was operationally blocked even though its deployment completed. Corrective application commit `d441d41cad4d5299a882e73ea006a963fa360cf4` packages and audits the complete migration inventory, fails closed when required schema objects are absent and is the current exact production source. It is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_138b4cc8cf988191a4f3e4be4404a6d6` and deployed as Sites version 261 through `appgdep_6a6eb97d1978819180b729e922f33971`.

### Outcome

Creditex now has a dark, full-viewport VEU test workspace with table-owned scrolling, one semantic row per job, compact advanced search and no fixed activity-family rail. Installer and VEU activity filtering live in the right-edge drawer. Every column menu closes after a choice, outside action or Escape. Import and Download CSV controls sit in the register footer.

The Dataforce interchange uses the exact supplied 23-column order: App Id, Job Id, Status, SubStatus, Type, Work Type, Scheduled Datetime, Balance, Certificates (VEECs), Submission, Invoiced, Field Worker, Agent, Client, Customer, Company Name, Ext Cust Ref, Phone, Mobile, Email, Address, Suburb and Postcode. Export includes every matching filtered job, uses UTF-8 with BOM and CRLF and neutralises spreadsheet formulas. Import accepts only that exact schema, at most 5 MiB and 2,500 rows, and creates immutable `staged_unmapped` records only. It cannot create a customer, job, compliance case, certificate, submission, trade or settlement.

The installer compliance intake now starts after an accepted quote. TLink derives the accepted work, customer site, jurisdiction, date and accepted-scope hash, then exposes governed Program, Activity, Product category, Scenario and effective-version selectors. Initial job creation remains outside Creditex and has no activity choice.

Manual official-source byte custody, R2 evidence-integrity receipts, effective-dated operational lookup staging and a non-evidentiary parallel-reconciliation foundation are present. Government sources remain the only rule authority. Creditex can retain, verify, audit and operate an approved transcription, but cannot author a private rule pack or activate a local assertion.

### Safety and release evidence

- The supplied private Dataforce export was validated locally only: 849 rows, 23 exact headers, 0 rejected rows, 0 duplicate rows and an exact cell-preserving round trip. Its SHA-256 is `22470CED083B3BAA4571108E34B5F91BD89154AD8381B54B693B3F9BDEF9BF31`. It was never uploaded, staged or published.
- A signed-in live export produced 300 synthetic rows and the exact 23-column header with no formula-leading cells.
- Source-artifact intake is manual, retains original bytes and hash in R2, records the asserted government URL and remains pending independent review. It does not activate rules.
- Evidence receipts prove application-to-R2 byte custody only. Physical iOS, Android, offline, GPS, EXIF and restore acceptance remain unproved.
- Operational lookup records are immutable, effective-dated and permanently staged pending governance approval. Live eligibility verification and local assertions remain disabled.
- Parallel comparisons are explicitly caller-supplied and non-evidentiary. External submission and certificate creation remain disabled.
- One active compliance case per work order supports the VEU pilot but does not yet support a combined VEU and STC claim on one installation.
- The accepted-scope hash is derived by the application; the database does not yet bind it to an immutable commercial-handoff hash.
- Exact corrective commit `d441d41cad4d5299a882e73ea006a963fa360cf4` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,220 main tests with 1,218 passed, 2 intentionally skipped and 0 failed, all 106 migrations through `0105_creditex_parallel_reconciliation.sql`, the customer-plan PDF audit, Vinext production build and the Sites bundle audit. The focused compliance correction suite passed 62 of 62.
- The 7,511,787-byte local archive has SHA-256 `FFBDCAFEA54E7FF72AD1E8E19B0983193E8C554583E3248129CD5E9FEAAE8CB1` and contains 355 entries including all 106 migrations. Sites stored 341 files and 30,177,280 bytes with content hash `sha256:9b6fd4e639695ea43eb2623fb495b680c6130e7d1539abb3c645b0291898c2b1`.
- Signed-in production QA confirmed 202 application tables, 21 `compliance_cases` columns, the protected 300-job register, compact advanced search, installer and activity selectors, menu dismissal, internal scrolling and the exact CSV export. The post-release Worker error-only query returned zero events.
- Production governed inventory remains 0 published programs, 0 activity versions, 0 evidence policies and 0 regulated cases. No real certificate, submission, trade or settlement was created.

## Released milestone: CREDITEX-GOVERNED-OPERATIONS-FOUNDATIONS-33

Status: released governed approval, physical-custody, calculator and Dataforce parallel-operation foundations

Release status: exact application commit `11b06b88d68609a9fcf254877a4afe379a95f8b3` was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_f2d304f9c9b481919b8d9588f0ef034f` and deployed as Sites version 262 through `appgdep_6a6edfb2b8e08191b295825c3db65d4d` with environment revision 19.

### Outcome

The Creditex shell now uses one dark visual system across Operations, Government rules, the VEU pilot and the complete job audit workspace. The three primary tabs and all seven pilot tabs remain clear and in the same measured position on every panel. The Jobs toolbar is Density, global all-field search, Filters and Refresh; each control is 28 pixels high. Advanced search remains a compact right-edge drawer, the removed bottom installer/activity rail stays absent and column option menus close on outside action, Escape or selection.

The governed backend now provides append-only independent approval for exact official-source artifacts and bindings, hash-complete operational lookup review and materialisation, tester-authored physical-device custody acceptance with a distinct governance decision, a deterministic version-2 exact-decimal calculator with canonical receipts, and exact case-sensitive Dataforce Job ID/App ID binding with immutable server-generated non-evidentiary comparison receipts. Insert-time current-approval guards prevent a withdrawn source from being used after review.

### Safety and release evidence

- External certificate creation, regulator submission, trading and settlement remain disabled. The governed production inventory remains 0 published programs, 0 activity versions, 0 policies and 0 regulated cases.
- Exact application commit `11b06b88d68609a9fcf254877a4afe379a95f8b3` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,244 tests with 1,242 passed and 2 intentionally skipped, all 109 migrations, the customer-plan PDF audit, Vinext production build and Sites bundle audit.
- The integrated Creditex suite passed 110 of 110 tests and the UI suite passed 40 of 40. Independent security review approved the five new boundaries with no P1, P2 or P3 blocker; independent UI review passed the corrected contrast and compact-control gates.
- The 7,544,418-byte local archive has SHA-256 `E0F5B94C49CCA3776F3CEE2734C076F33F2E59324A301A211A7F55A6B94BACE4`, 358 entries and all 109 migrations. Sites stored 344 files and 30,412,800 bytes with content hash `sha256:60ede71e262e365ed8aa39fced47e8a550623266d6636ef8c326a821efdadb3c`.
- Signed-in production QA confirmed the primary tab bar at the same 52.7-pixel top position across all three sections and the pilot tab bar at the same 142.7-pixel top position across all seven workspaces. The all-field search returned the 10 expected technician-code matches, toolbar controls measured 28 pixels, outside-click closed the Status column menu, the compact filter drawer opened from the right edge and double-click opened the dark independently scrollable audit workspace.
- Recent Worker logs contained no Creditex failure. The only error in the review window was an unrelated existing `/api/trade-job-notifications` HTTP 500 from the Direct Trade dashboard.

## Released milestone: CREDITEX-DATAFORCE-REGISTER-GOVERNED-AUTHORING-34

Status: released exact Dataforce register and guarded mapping and calculator authoring

Release status: primary application commit `58b92e1f859c62de00e4d8bda11624ab3f1633b8` was validated and pushed to GitHub and Sites managed `main`. Its saved Sites version 263 failed before activation through deployment `appgdep_6a6f0208b8208191ba75d01cd0b659d8` with `incomplete input: SQLITE_ERROR`, so Sites version 262 remained live and production did not change. Corrective application commit `31b152933273db33bfa866bdbc491f6fdc35360a` was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_aa8d0183098881918f1fe626a7deb951` and deployed as Sites version 264 through `appgdep_6a6f09034b10819187e46054254b06b2` with environment revision 19.

### Outcome

The Jobs register now exposes the exact 23 Dataforce columns in the exact Dataforce order and one job per row. TLink governance fields remain inside the complete audit workspace rather than becoming extra columns. The row action is embedded within `App Id`. The toolbar stays on one desktop line in the order Density, all-field search, Search, Refresh and Advanced search, with every control 28 pixels high. Advanced search opens the compact right-edge drawer, sort menus close after outside action, and 320-pixel and 390-pixel layouts stay on one line without document overflow.

The release corrects official VEU version 25 to 21 July 2026 and version 24 to 30 June 2026, adds explicit as-of and effective-window lookup approval, adds append-only legacy mapping authoring and review, and adds draft-only calculator and golden-vector authoring. Test vectors remain `not_run`. No authoring endpoint can create a certificate, submission, trade or settlement.

### Safety and release evidence

- External certificate creation, regulator submission, trading and settlement remain disabled. The governed production inventory remains 0 published programs, 0 activity versions, 0 policies and 0 regulated cases.
- Exact corrective application commit `31b152933273db33bfa866bdbc491f6fdc35360a` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,267 main tests with 1,265 passed, 2 intentionally skipped and 0 failed, all 111 migrations, the customer-plan PDF audit, Vinext production build and Sites bundle audit. The targeted operations, calculator and schema suite passed 49 of 49. Independent migration and final review reported READY with no P1 or P2 defect.
- Corrected archive `.openai/site-release-31b1529.tar.gz` is 7,575,785 bytes with SHA-256 `0AE7AA64CE6D9B93D0A0D6DA65CEC1F11F1ADA8D4D1451E60EEDDD2AF38D87C5`, 360 entries, all 111 migrations, zero CSV entries and zero `CREATE TRIGGER` statements in migration `0110`.
- Sites version 264 stored 346 files and 30,535,680 bytes with content hash `sha256:7add92fd081d36220e266666533ce162585bcf23531889182f7abbbd982a8ea2`.
- Signed-in production QA confirmed 10 installers, 30 field technicians, 300 jobs, all 34 activity families, the exact 23 headers and 23 cells per row, 300 row actions, table-owned desktop scrolling with no document overflow, one-line compact toolbars, working global search and reset, one 25-select advanced-search dialog with focus restoration, outside-click sort dismissal, stable tab positions and the complete double-click audit workspace.
- Browser review found only Chrome extension asynchronous-channel warnings and no application exception.

## Released milestone: CREDITEX-NATIONAL-CALCULATION-FOUNDATIONS-35

Status: released national calculation-readiness catalogue and deterministic SRES estimates

Release status: exact application commit `5eab88950c1047746484ce2ab4880d8e32be824a` was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_123d03e2e4b08191b196236068cca9b0` and deployed as Sites version 265 through `appgdep_6a6f2bac3b588191bb64b2b29c6e1b1b` with environment revision 19.

### Outcome

Creditex now has one controlled national calculation-readiness catalogue spanning 32 Australian government program pathways and 212 activity templates, with exactly one explicit pathway per activity. Closed, future, registry, project, governed-formula and non-certificate activities remain visibly distinct. No unsupported activity returns a fabricated zero or executable estimate.

The first deterministic SRES estimator covers 2026-to-2030 solar photovoltaic, wind, hydro, registered solar water heater, air-source heat pump and eligible solar-battery expected entitlements. It uses exact decimal arithmetic, official final-step rounding, controlled inputs, effective-dated source identifiers, complete trace output and deterministic receipt hashes. The same-origin protected route is authenticated, role-controlled, no-store, streaming-body bounded and non-mutating.

The Calculators panel exposes readiness and source windows for all 212 activities, the connector panel records the known REC Registry, ESC VEU, NSW TESSA, ACT, SA and federal boundaries, and all external certificate actions remain disabled. The Jobs register remains exactly the supplied 23 Dataforce columns. Search, Refresh and Advanced search now use the same 28-pixel visual contract in both collapsed and expanded states.

### Safety and release evidence

- The real governed inventory remains 0 published programs, 0 activity versions, 0 policies and 0 regulated cases. An expected entitlement is not labelled as created, validated, registered or accepted.
- Exact application commit `5eab88950c1047746484ce2ab4880d8e32be824a` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,281 main tests with 1,279 passed, 2 intentionally skipped and 0 failed, all 111 migrations, the customer-plan PDF audit, Vinext production build and Sites bundle audit. The focused national suite passed 34 of 34, and independent final review found no remaining P1 or P2 defect.
- Archive `.openai/site-release-5eab889.tar.gz` is 7,598,597 bytes with SHA-256 `402682B1F6BB535EA63FDA1DA26B4D9A37D351445457C75A3612B86FDCB32C6F`, 360 entries, all 111 migrations and zero CSV entries. Sites stored 346 files and 30,638,080 bytes with content hash `sha256:7ee3e873e71c98c648f2fba25ae6d0b83c30eb47b7a6a17bea2c422c14abd0dc`.
- Signed-in production QA confirmed the 300-job register and exact 23 headers, identical 28-pixel Search, Refresh and Advanced search controls, outside-click sort dismissal, a 212-activity calculator catalogue, live 45-STC photovoltaic and 164-STC battery vectors, explicit NSW future and closed states, and no certificate action.
- Actual 320-pixel and 390-pixel CSS-width verification found no document overflow; the register retained table-owned horizontal scrolling and the calculator stacked into one readable column. Browser review found no application exception.

## Released milestone: CREDITEX-NATIONAL-MANUAL-EVIDENCE-LAB-36

Status: released national synthetic manual-evidence forms and job testing

Release status: exact application commit `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f` was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_e42b1932db8481918304dad9fcf28bd2` and deployed as Sites version 266 through `appgdep_6a6f4c3dc8b88191a33403ba9acbd5d9` with environment revision 19.

### Outcome

Creditex can select any of the 32 controlled Australian program pathways and 212 controlled activity templates, generate an editable evidence starter form, add or reorder operational prompts, lock an immutable test-ready version and exercise that exact form through an owner-scoped synthetic manual job.

The builder supports photo, document, text, number, controlled select, declaration, date and signature fields with capture timing, minimum and maximum captures, MIME restrictions, original-file retention, metadata and GPS controls. Manual jobs pin the exact activity and form snapshots and support field testing, audit, change request, pass and archive states with append-only event history.

Government requirements remain separate. Creditex can improve plain-language instructions and add operational checks, but a government-requirement candidate needs a complete official-source citation and cannot become authoritative through the manual lab. No manual-test action creates a regulated case, evidence object, certificate, submission, trade or settlement.

### Safety and release evidence

- Exact application commit `ecec39abbc65fb5d25aa5d21d6dcfead724bcc0f` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,289 main tests with 1,287 passed, 2 intentionally skipped and 0 failed, all 112 migrations, the customer-plan PDF audit, Vinext production build and Sites bundle audit.
- The final focused manual-evidence, schema-guard, VEU-pilot and operations-control set passed 62 of 62. Independent review found no P0 or P1 blocker, and its one database review-role hardening finding was corrected and regression-tested before release.
- Archive `.openai/site-release-ecec39a.tar.gz` is 7,629,648 bytes with SHA-256 `2BAFF556C8F963612F6FC4878326C2A1924B38F0AB8E5D1046B00C5ED2044F53`, 361 entries, all 112 migrations and zero CSV entries. Sites stored 347 files and 30,883,840 bytes with content hash `sha256:ac05eacd1792bacdb6b5ef4e0dae86149f8cb484678401061e86ca96ddce69cd`.
- Signed-in production QA confirmed catalogue metrics for 32 controlled program pathways and 212 controlled activity templates, the custody boundary, Form builder, Manual jobs, Installer preview, the unchanged 300-job register and the compact Advanced search drawer.
- Actual 320-pixel and 390-pixel responsive verification found no document-level overflow. Browser review found no application error.

## Released milestone: CREDITEX-GOVERNED-MANUAL-FIELD-PREFLIGHT-37

Status: released synthetic manual-field custody, policy composition, unified audit register, calculation coverage and blocked interchange preflight

Release status: primary application commit `8c29808a9f4a80acc8e7f2304c4b49268f4f2c49` and D1-compatible corrective commit `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb` were validated and pushed to GitHub and Sites managed `main`. Corrective commit `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb` was saved as `appgprj_6a550c378000819185caf094173422bb~appgver_95cd969101b08191b89b03aaea09e827` and deployed as Sites version 268 through `appgdep_6a6fa22d2bb48191b8bd5fd8317cbe9f` with environment revision 19.

### Outcome

AEA Field now has a dedicated synthetic compliance lane for exact original bytes, SHA-256, capture time, EXIF, GPS, device identity, offline and multipart recovery, R2 restore and device revocation. Manual forms compose immutable approved government minimums with separately editable Creditex operational additions. Synthetic pilot and manual jobs share one exact 23-column Dataforce register, stored-value filters and full audit workspace.

All 212 controlled activity templates now have one deterministic calculation-readiness result. Six SRES technologies expose protected expected-entitlement estimates; 206 remain blocked or non-executable. VEU, NSW TESSA and REC Registry surfaces expose explicit blocked descriptors only. No exact unapproved serializer, external request, certificate creation, submission, trade or settlement action is enabled.

### Safety and release evidence

- Exact corrective commit `5d4b540dcbcb49b3d1d57eda122a4dca86d723bb` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 1,355 main tests with 1,353 passed, 2 intentionally skipped and 0 failed, all 115 migrations, the customer-plan PDF audit, Vinext production build and Sites bundle audit.
- The AEA Field mobile suite passes 20 of 20 together with mobile type checking and lint. Android and iOS Expo exports complete, but native Firebase configuration, signing and named physical-device acceptance remain incomplete.
- Archive `.openai/site-release-5d4b540.tar.gz` is 7,703,920 bytes with SHA-256 `f1ce735aed060d55e8461814707f53da22fb8845820629b96b6124db541fa989`, 365 entries, all 115 migrations and zero CSV entries. Sites stores 351 files and 31,303,680 bytes with content hash `sha256:b0d80a9e5d0c61084a227f8661df5d0366845ee5ac298c4a671a3eae753126a9`.
- Signed-in production QA confirmed 300 of 300 jobs, the exact 23 Dataforce headers, all-field search, stored-value advanced facets, outside-click sort dismissal, complete audit drill-down, 32 program pathways, 212 activities, 6 executable estimates, 206 blocked or non-executable pathways, 5 blocked connector descriptors, 0 serializers, 0 external sends and no document-level compact-layout overflow.
- Sites version 267 exposed a production-only D1 incompatibility in the read-only compound facet query. No data mutation was involved. Version 268 replaces it with seven exact grouped statements in one transactional batch, loads the register successfully and has zero recent Worker error events.

## Released milestone: AEA-SHARED-NAV-DISCOVERY-38

Status: released shared compare-navigation overflow and mobile discovery correction

Release status: exact application commit `37776ed557d7c0a25d92698f52e87cf59cee05b6` was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_ea8944a8b6d08191bf7b8fd3237619c4` and deployed as Sites version 269 through `appgdep_6a6fb33354ac8191beb6ef116cbe9bca`.

### Outcome

`Start` is no longer clipped from the shared compare-platform heading. All seven existing destinations remain in their original order. At layouts up to 1320 pixels the navigation occupies a clear second row with a visible `Scroll for more options` cue, a continuation fade and scroll snapping, while desktop keeps the cue hidden.

### Safety and release evidence

- Exact application commit `37776ed557d7c0a25d92698f52e87cf59cee05b6` passed `npm.cmd run validate`, including 31 of 31 integration tests, the complete application suite, all 115 migrations, customer-plan PDF audit, Vinext production build and Sites bundle audit.
- The focused navigation suite passed 21 of 21. Responsive verification at approximately 390 pixels and 320 pixels kept `Start` visible before scrolling, `Assessments` reachable at the scroll end and the document free of horizontal overflow.
- Archive `.openai/site-release-37776ed.tar.gz` is 7,717,752 bytes with SHA-256 `ED56FF26BE5E160878D8A72E022B703CCEC952058687FD66A7962CB51D269030`. Sites stored 351 files and 31,303,680 bytes with content hash `sha256:bdd4fb3fe2ccad379fe6afc94f5ae92470213388ba2f9c236708b8cffbab0aed`.

## Released milestone: CREDITEX-GOVERNED-SOURCE-INTAKE-39

Status: released exact official-source custody, independently audited access and draft-only review

Release status: exact application commit `8baad519d763f0955e481a925ca9114b4d708653` was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_2deae2c2caa081919a369e1cd193bd5d` and deployed as Sites version 270 through `appgdep_6a6fc16429e88191af41bbf10fb18a6a` with environment revision 19.

### Outcome

Every authorised Creditex role can reach a permanent `Official sources` workspace. Administrators and case managers can bind an exact government file to a server-controlled owner-scoped draft target. Reviewers and auditors can inspect the custody register and download exact retained bytes; only an independently verified administrator can record review decisions. Artifact approval requires the same reviewer's audited access receipt for the exact retained hash and byte count, and binding approval remains artifact-first.

The workbench exposes the current government link beside retained bytes, server SHA-256, exact byte count, citation, immutable decisions and authoritative cursor pagination. Capture replay, download and approval re-read R2 and fail closed for missing or altered bytes. Completed decisions do not expose mutation controls.

### Safety and release evidence

- No migration, publication, activation, certificate, submission, trade or settlement path was added. The real governed inventory remains 0.
- Exact application commit `8baad519d763f0955e481a925ca9114b4d708653` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete application suite, all 115 migrations, customer-plan PDF audit, Vinext production build and Sites bundle audit.
- The integrated Creditex custody and readiness set passed 86 of 86. Independent final review found no remaining blocker against the five release boundaries.
- Archive `.openai/site-release-8baad51.tar.gz` is 7,736,223 bytes with SHA-256 `BDBED88DB3F6675DFB0AD4BF133651F9B4609DA0432F42390DD591D5715205A8`. Sites stored 351 files and 31,406,080 bytes with content hash `sha256:6cf77082dca1a638dc78e094791cd712f2417fdb17bd86c9a0ba772aa041d978`.
- Signed-in production QA opened the permanent source workspace at desktop and a 390 by 844 responsive override, confirmed `0 shown of 0 records`, no eligible draft target and disabled capture and pagination controls, and created no production data.

## Released milestone: TRADE-CREDITEX-JOB-HANDOFF-40

Status: released guided installer job creation, immutable compliance planning and Creditex pre-case audit handoff

Release status: exact application commit `a45f250ee805aac1545c8643726dfde3964de22b` was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_1e6ba2c1ae64819197a3b33a13cbb364` and deployed as Sites version 271 through `appgdep_6a701f23b43c8191ab61ef23e35166de` with environment revision 19.

### Outcome

The installer New Job flow now moves through Work, Customer, Program, Appointment and Review. Compatible certificate and support work uses controlled claim-output, program and activity selectors conditioned by service-site jurisdiction. One guarded transaction creates or attaches the customer and site, creates the job and appointment, and optionally retains an immutable `tlink-creditex-job-intent-v1` planning snapshot.

Creditex receives every assigned planning record in the `Certificate-work register` and can inspect the complete authorised customer, service-site, installer, commercial, appointment and workflow projection. Accepted-quote conversion links only an exact current intent to a published, effective governed activity and evidence policy. A mismatch is marked `Re-plan required` and cannot silently create a case.

### Safety and release evidence

- The planning catalogue cannot publish a government rule, create a certificate, submit to a regulator, trade or settle. No production customer, job, intent, case or evidence record was created during release QA.
- Exact application commit `a45f250ee805aac1545c8643726dfde3964de22b` passed `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, the complete application suite, all 117 migrations, customer-plan PDF audit, Vinext production build and Sites bundle audit.
- The final intent, migration, installer wizard, CRM, accepted-handoff, Creditex portal and field-contract set passed 105 of 105. Independent security, data-boundary and interface review findings were fixed before release.
- Archive `.openai/site-release-a45f250.tar.gz` is 7,758,795 bytes with SHA-256 `23C885EF9D4BD11FA837107740E9B44381D0E8B71CA4432364F3531CFF148CC9`. Sites stored 355 files and 31,518,720 bytes with content hash `sha256:28daf91f4202cf79d0c3c5ecbb7b4f42822bec6725644c3077423b3869e83e0e`.
- Signed-in installer QA opened all five New Job stages without submission. Signed-in Creditex QA loaded the permanent compliance navigation and `Certificate-work register`, which reported 0 assigned jobs. Desktop and compact checks found no document-level horizontal overflow; image capture timed out, so the retained evidence is rendered-DOM, width and interaction verification rather than a screenshot artifact.

## Released milestone: TRADE-CREDITEX-OPERATING-ALIGNMENT-41

Status: released installer workflow alignment, exact Dataforce job register and bounded Creditex full-audit recovery

Release status: primary application commit `836bc779f33a5f77fc4a18a41227dc76dfbf9914` implemented the milestone, corrective commit `c32be214558dd1a20ccb26d04bcf7b054b00f110` restored the installer Jobs index, and final application commit `c51934456c2248da4cfde9a0b759b70d69df56ee` restored the production-schema Creditex audit workspace. The final commit was validated, pushed to GitHub and Sites managed `main`, saved as `appgprj_6a550c378000819185caf094173422bb~appgver_02f3ce1e33ec8191919abea0bc24f6ac` and deployed as Sites version 274 through `appgdep_6a7082f95d2881919e97336aa038fc5a` with environment revision 19.

### Outcome

The installer New Job workflow now keeps all reached stages clickable, removes the unused visible site name, keeps appointment controls visible and presents one detail-rich final review. Australian state and postcode combinations are validated. A signed provider selection is retained when an approved provider is configured; otherwise manual entry is explicitly marked for Creditex review. A progressing installer job can create its immutable certificate-work planning intent without an accepted quote, while any optional quote linkage remains all-or-none and immutable.

Installer Jobs now mirrors the exact known Dataforce 23-column order with one company-scoped job per row, no visible row-selection controls and complete filtered CSV export. Creditex receives the same planning record and can open the authorised customer, installer, service site, job, appointment and address provenance. Fifty-three retained audit domains load independently in deterministic 50-record keyset pages, replacing the original 53-domain burst and avoiding one unbounded private-data response. Production-scale D1 rows-read and latency telemetry remain unverified.

### Safety and release evidence

- `npm.cmd run validate` passed type checking, warning-free lint, 31 of 31 integration tests, the complete application suite, all 119 migrations, customer-plan PDF audit, Vinext production build and Sites bundle audit.
- A persistent production-schema regression executed all 53 audit-domain first-page queries and all 53 cursor-page queries against a fresh database: 106 of 106 passed. Independent final review found no remaining P0, P1 or P2 defect.
- Archive `.openai/site-release-c519344.tar.gz` is 7,775,395 bytes with SHA-256 `CD5CA5072B17BC6970CB6EDEE0CA1A3C29D195A535397A91C9A0794810975F9C` and 373 entries. Sites stored 359 files and 31,590,400 bytes with content hash `sha256:455c203ec7dfe5c21c5559453b33e4e7f1b92910412d9cd4130ac903ccb2aeb7`.
- Signed-in installer QA loaded 7 company-scoped jobs, all 23 columns and the successful 7-row CSV status. Signed-in Creditex QA opened the single assigned job, complete audit core, manual-address warning, one appointment and correct empty quote, case and governed-evidence groups. The custom-domain health endpoint returned HTTP 200. No customer, job, intent, case, evidence, certificate, submission, trade or settlement record was created or changed; the authorised workspace and group reads appended their designed audit-view events.
- Sites versions 272 and 273 were superseded during signed-in QA. Version 272 exposed the missing installer Jobs index; version 273 restored that index but exposed invented installer projection columns and an over-broad audit request. Both defects are covered by the final production-schema regression.
- Production still lacks `TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT` and `TLINK_ADDRESS_AUTOCOMPLETE_TOKEN`. Manual entry remains available and visibly fails closed to `manual_pending_review`; an approved provider and credential remain required for verified autocomplete.

## Released milestone: TRADE-MULTI-ACTIVITY-USABILITY-42

Status: released and historical with atomic multi-activity planning, installer and
customer usability, evidence-complete field gates and D1-compatible customer
asset history

Release status: primary application commit
`103439d03a5c322757cea27e77e8b147b6c85590` implemented the milestone.
CRM diagnostic `ce0996779818690751016dfd5b3efdd8e7c1586e` and guard correction
`82e0faf64906047a5f42fabf83c605edf320cb63` resolved a separate production
CRM schema-guard failure. Subsequent asset diagnostic
`eeb636665a21d230b7150e03d60f614b7f71b1db` isolated the remaining
production-only D1 asset timeline incompatibility. Final application commit
`13dbf2ddc4eea32c6a929ef15cb258a263ff99ea` was validated, pushed to GitHub
and Sites managed `main`, saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_e113332d3dac8191bff9ed71b5d51487`
and deployed as Sites version 279 through
`appgdep_6a7178bb43c08191b86b568dabd45b94` with environment revision 19.

### Outcome

One installer job can plan multiple compatible government program activities
atomically, retain each exact activity independently and carry the same job,
customer, schedule, commercial and governed-evidence context through web and
mobile field work to the authorised compliance workspace. The new-customer form
is open by default, phone and email are mandatory, existing-customer search
remains available, the date-time picker stays within the viewport, and the
final review shows every activity without implying that a certificate or case
already exists.

The installer Jobs register retains the exact known 23-column Dataforce
interchange while placing customer identity first for daily work, providing
callable contact links, complete populated-category filters and explicit
navigation. Customers sort by first name then last name and show dated latest
jobs. Schedule appointments expose controlled quote view, revision and send
preparation.

### Safety boundary

- Every activity selection is validated server-side and retained in the same
  atomic job transaction; duplicate selections and partial mappings fail.
- Web and offline completion require submitted evidence for every active case,
  exclude superseded evidence and atomically revalidate photo proof.
- A changed installation date immutably supersedes every still-planned
  activity intent and creates an exact next revision in the same guarded
  schedule transaction. Linked cases remain date-locked.
- JSON control bodies are limited by streamed actual bytes, and offline
  bootstrap companion rows are bounded to the selected 500-job cohort with an
  overall fail-closed cardinality limit.
- Government activity, evidence policy and calculation authority remains
  external and independently governed. This milestone does not create a
  certificate, regulator submission, trade or settlement.
- Historical production was Sites version 279 from exact final application commit
  `13dbf2ddc4eea32c6a929ef15cb258a263ff99ea`.

`npm.cmd run validate` passed type checking, warning-free lint, 31 of 31
integration tests, 1,443 main tests with 1,441 passed, 2 intentionally skipped
and 0 failed, all 120 migrations through
`0119_trade_multi_activity_jobs.sql`, the customer-plan PDF audit, Vinext
production build and Sites server-bundle audit. The focused asset timeline suite
passed 9 of 9, and independent final review found no remaining P0, P1 or P2
defect.

Archive `.openai/site-release-13dbf2d.tar.gz` is 7,781,979 bytes with SHA-256
`D6AC82425EC5EE82B84318978177D49F0E41E54DF755094FEC935F7549FDAA67`
and 374 entries, including all 120 migrations and zero CSV entries. Sites stored
360 files and 31,682,560 bytes with content hash
`sha256:1630c642f67fb83d38fd428197e05e4ae32e4bad97c29eb111d6c090760d7dc3`.

Signed-in installer QA exercised New Job without submission, all 23 Dataforce
columns and CSV export, customer A-to-Z sorting and filters, callable contacts,
dated latest jobs, schedule quote access and the assigned internal compliance
workspace. Signed-in customer asset QA rendered the asset and timeline
workspace; `/api/trade-assets` returned HTTP 200 under request/ray
`a25b2c9d7a1275df`, and errors-only worker logs contained zero events. The
custom-domain health endpoint returned HTTP 200. No production customer, job,
business, intent, case, evidence, certificate, submission, trade or settlement
record was created or changed.

Sites versions 277 and 278 were superseded during signed-in QA. Version 277
proved the production schema was present but the customer asset workspace still
failed. Version 278 isolated the seven-arm compound timeline query. Version 279
executes seven bounded owner-, customer- and site-scoped statements in one D1
batch, globally sorts them by the unchanged API contract and returns at most 500
rows without presenting a partial history as complete.

Production still lacks `TLINK_ADDRESS_AUTOCOMPLETE_ENDPOINT` and
`TLINK_ADDRESS_AUTOCOMPLETE_TOKEN`. Manual entry remains available and visibly
fails closed to `manual_pending_review`; an approved provider and credential
remain required for verified autocomplete.

## Released milestone: TRADE-BUSINESS-IDENTITY-QUOTE-DELIVERY-43

Status: released and historical with unified business identity, controlled branding,
immutable customer quote documents, server PDFs and retained delivery evidence

Release status: application commit
`fcfca482b0f86413423af2af8c5ae77054e6186f` was validated, pushed to GitHub
and Sites managed `main`, saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_a6468ced690881919d2e29c591fd11f3`
and deployed as Sites version 280 through
`appgdep_6a71bf0136dc81918e71ba815cddd0ff` with environment revision 19.

### Outcome

One TLink Business workspace now owns business identity, appearance, up to six
postcode/radius service areas, quote defaults, notifications, customer-document
preview and account closure. Installer or wholesaler account type is immutable.
Logo and banner uploads accept only signature-checked JPEG or PNG files up to
3 MB, strip metadata and remain private. Six controlled colour themes and three
border styles are reused across the owner workspace and customer documents.

Direct-customer quotes now support the current authorised customer email,
additional authorised recipients, a customer-details shortcut, an editable
email introduction and standard terms. Every newly issued version freezes exact
business, branding, recipient, customer, scope, totals and terms in one
immutable `trade-quote-document-v1` snapshot. The same snapshot renders the
private customer review, branded HTML and text email and two-page A4 PDF.
Delivery retains exact hashes, provider ID and attempt state. A version is
marked sent only after Resend accepts the API request and returns a provider
message ID; inbox delivery remains unverified.

### Safety boundary

- Customer totals are recomputed on the server. Internal supplier cost, markup
  and margin remain outside the customer snapshot, email and PDF.
- Customer-facing logo, banner, review and PDF responses require the exact
  active review token and use `no-store`; owner branding media separately
  requires verified trade access.
- Account closure requires recent Firebase authentication and typed
  `CLOSE ACCOUNT`, then atomically closes access, records the retained ledger and
  administrator notification, revokes active quote links, clears review-token
  material and suspends active team members.
- Closed owners receive a terminal signed-in state and cannot mutate retained
  identity. Firebase deletion, physical erasure and recovery are not claimed.
- SMS, payment, invoice PDF or invoice email delivery, certificate creation,
  regulator submission, trade and settlement remain disabled or out of scope.

`npm.cmd run validate` passed type checking, warning-free lint, 31 of 31
integration tests, 1,457 main tests with 1,455 passed, 2 intentionally skipped
and 0 failed, all 121 migrations through
`0120_trade_business_identity_and_quote_delivery.sql`, the customer-plan PDF
audit, Vinext production build and Sites server-bundle audit. The focused
closure set passed 22 of 22, and independent final review found no remaining P0,
P1 or P2 defect.

Archive `.openai/site-release-fcfca48.tar.gz` is 7,833,168 bytes with SHA-256
`806E919D9144B30A162C051660444F82F7BEAFE542EEBEB954C742675161139B`
and 375 entries, including all 121 migrations and zero CSV entries. Sites stored
361 files and 31,856,640 bytes with content hash
`sha256:cf01b5bdf49058a7b12e7177e864c08a17af1203dc23f1e4b22a10ce5d7dcc2c`.

Signed-in custom-domain QA exercised the unified Business, Appearance, Quote
defaults and Templates sections and opened one existing quote without saving or
sending. It verified the authorised recipient, additional-email,
customer-details, exact totals, private review and issued-PDF controls. The
customer review rendered on desktop and at 390 px with the exact $4,444.00 total
and no visible compliance-partner name. Health, homepage, dashboard and current
homepage assets returned HTTP 200. The final five-minute Sites errors-only log
contained zero events. Opening the existing customer review records or reuses
its designed daily `viewed` audit event; no customer, business, quote version or
commercial value was changed.

Remaining controlled limitations are a real Resend receipt and customer email
client rendering, private-object retention for unreferenced removed branding,
legacy pre-`0120` issued versions without a frozen snapshot, and the deliberately
absent account-recovery and physical-erasure workflows.

## Released milestone: TRADE-WORKSPACE-DELIVERY-RECOVERY-44

Status: released and historical with a complete themed trade shell, one-page business
settings, restored workspace navigation, reliable quote review and PDF access,
truthful provider-delivery state and worker-safe rollback handling

Release status: primary recovery commit
`b7e40751e2556ffc64e37704c641a6e917046bb6` implemented the TLink workspace
and delivery recovery. Final application commit
`9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c` added the worker-safe legacy
fallback correction, was validated, pushed to GitHub and Sites managed `main`,
saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_fd653b2ad83c81918fd23a3366735271`
and deployed as Sites version 282 through
`appgdep_6a71e7f3af3c81918f0f89a3e0354d36` with environment revision 19.
Sites version 281 from the primary recovery commit was superseded during
release QA after the inherited rollback route returned HTTP 500.

### Outcome

Fourteen accessible themes now govern the complete trade shell and customer
documents. Account, Appearance, Service areas, Quote defaults, Notifications,
Templates and Close account are visible together on one Business settings
page, each with a local save action. The Jobs register uses the available
workspace width while retaining the company-scoped Dataforce-aligned fields,
and Schedule keeps the permanent installer CRM navigation.

Quote issuance preflights the exact server PDF before creating an immutable
customer review link. Existing issued reviews, PDFs and media remain available
only to the active customer token or current verified trade owner. Successful
Resend API submission is stored as `provider_accepted`, not customer inbox
delivery. The authorised lead relay now allows 20 seconds and its outer health
check allows 25 seconds. The legacy electricity fallback uses a no-store,
no-index 307 redirect to the deployed no-index asset without relying on a Node
filesystem.

### Safety and release evidence

- Exact application commit
  `9c278bb23f3f5eb9c3878c5a4cfc946264f1a29c` passed
  `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration
  tests, 1,466 main tests with 1,464 passed, 2 intentionally skipped and 0
  failed, all 121 migrations, the customer-plan PDF audit, Vinext production
  build and Sites server-bundle audit.
- The TLink recovery-focused set passed 104 of 104 before the final fallback
  correction, and the fallback set passed 8 of 8 after it.
- Archive `.openai/site-release-9c278bb.tar.gz` is 7,829,193 bytes with SHA-256
  `EC1B166DD9957DA17C4F889E4802C349A76A71454627769D12B5BFD5A1E503E2`.
  Sites stored 361 files and 31,907,840 bytes with content hash
  `sha256:86f36c8d918da0ae1b634db811ed645a27d4a50a1a35acc0eba79d5e20488d96`.
- Signed-in custom-domain QA opened Jobs, Schedule, Business and one existing
  test quote without saving or sending. The existing review rendered its exact
  $4,444.00 total and its PDF returned HTTP 200, `application/pdf`, 399,318
  bytes and a valid `%PDF-1.7` header.
- After Sites version 281 exposed the inherited rollback failure and was
  superseded, ten consecutive version-282 fallback probes returned HTTP 307 to
  the deployed asset and the target returned HTTP 200 with its no-index
  directive.
- Release QA did not upload branding, save settings, add a recipient, issue or
  send a quote, close an account, or create or change a customer, job, intent,
  case, evidence, certificate, submission, trade or settlement record.

Remaining controlled limitations are unverified real Resend receipt and Gmail
or Outlook rendering, the next authorised live monitor proof of the 20/25
second timeout relationship, separately governed retention for unreferenced
branding, legacy pre-`0120` quote reconstruction, and the deliberately absent
account-recovery and physical-erasure workflows.

## Released milestone: TRADE-DOCUMENT-CONTROLS-AND-JOBS-45

Status: released and live with exact Jobs cells, explicit customer-document
identity, full-width banner framing, clear invoice totals and immutable issued
PDF artifacts

Release status: exact application commit
`bfd472359dd8ec2457379bc3694dc3c9503ac7dd` was validated, pushed to GitHub and
Sites managed `main`, saved as
`appgprj_6a550c378000819185caf094173422bb~appgver_435abd4eabd081918c58fd7adbbb49ae`
and deployed as Sites version 283 through
`appgdep_6a7221a403808191a44c354d51922058` with environment revision 19.

### Outcome

The owner-scoped Jobs register renders one job per row with 23 separate
Dataforce-aligned headings and corresponding cells. Its visible register,
column selector, all-field search, horizontal scroll and CSV export use the
same authoritative column declaration; callable mobile values and company scope
remain intact.

Business settings independently saves the customer-facing business name, phone,
email and bank/payment details. Its 5:1 banner crop controls make the exact
full-width PDF frame visible before issue. Quote and invoice previews share that
identity, banner and theme. Invoice authoring and output show item rows,
subtotal, discount, GST, total and configured payment details. Redundant
customer-facing `Work`, `Always included` and `Your base scope` wrappers are
removed.

Each new quote or invoice revision freezes its customer-document identity and
financial presentation. Issued PDF bytes are retained as the authoritative
private artifact and verified against the document identity on read. A provider
acceptance conflict enters `reconciliation_required`, remains non-resendable
and cannot be presented as issued until reconciled.

### Safety and release evidence

- Exact application commit
  `bfd472359dd8ec2457379bc3694dc3c9503ac7dd` passed
  `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration
  tests, 1,494 main tests with 1,492 passed, 2 intentionally skipped and 0
  failed, all 124 migrations, the customer-plan PDF audit, Vinext production
  build and Sites server-bundle audit.
- The focused milestone acceptance review passed 62 of 62 tests.
- Sites version 283 stores 364 files and 31,682,560 bytes with content hash
  `sha256:e3da2fb4a4e4b342a0825a145d8ee3dd2124002123d04c28de753e6767b734c7`.
- Signed-in custom-domain QA found 8 company-scoped Jobs rows, 23 visible
  headings and 23 direct cells in each inspected row. Schedule retained all 12
  CRM tabs and the expected two existing appointments.
- Business settings showed every section on one page, the explicit 5:1 banner
  frame and side-by-side quote/invoice previews with the full-width banner,
  customer-facing identity, line items, $4,040 subtotal, $200 discount, $384
  GST, $4,224 total and payment area.
- Public root, `/api/health` and `/direct-trade/dashboard` returned HTTP 200;
  the final 30-minute errors-only production Worker query returned zero events.
- Release QA did not upload branding, save settings, issue or send a quote or
  invoice, or create or change a customer, job, intent, case, evidence,
  certificate, submission, trade or settlement record.

Remaining controlled limitations are controlled Gmail and Outlook proof for
both quote and invoice plus provider callback reconciliation, a production
invoice send, legacy issued PDFs without provable retained bytes, the approved
Australian address-provider integration, and independently approved complete
manual VEU, SRES/STC and NSW governed bundles.

## Released milestone: CREDITEX-NATIONAL-CALCULATOR-47

Status: the complete governed VEU calculator was released from exact application
commit `d192d46b4e2056114251ec7cb0e3cfca3b5ea5d9` as Sites version 294 through
deployment `appgdep_6a77aa33d1288191965ba076f690dd46`. Exact corrective commit
`ad63b90a4e99211998aa1947b7ddd61d5ac1f640` bounds registry history refreshes and
was superseded as Sites version 295. Exact guided calculator and PDRS
licensed-runtime commit `1d3abe172e4eb2fa006fab639233cda49a6d37d4` was deployed as
Sites version 296. Exact simplified quote-calculator commit
`11f4721b678425a4294e95c631e0d37d3fab0ffd` was saved as historical Sites
version 297 with identity
`appgprj_6a550c378000819185caf094173422bb~appgver_f6c71f20596c8191a59a1ee2c23045df`
and deployed through `appgdep_6a781d231ee08191a7d506389be1676b` with
environment revision 19 at `https://compare.ausenergyassessments.com`. Sites
stored 378 files and 33,105,920 bytes with content hash
`sha256:03f919b3ec2902590c8079a1d6edf9d725e6163bb515ec6b761be3ed12b099c5`.
The 8,158,365-byte publication archive had SHA-256
`FCB2FA3E954FA758EB069C70B76A712C1FC23FEC0EC432380EBD3B58D8646563`
and was removed locally after Sites accepted the package and recorded custody.

The released milestone provides one source-controlled calculator workspace
across 35 Australian program pathways and 216 activity templates. Program,
activity, scenario, installation date, postcode or service inputs and
approved-product selectors are driven by typed catalogues. Every result is an
estimate with deterministic formula and source provenance; certificate
creation, submission, trade and settlement remain disabled. The same governed
calculator is available to Creditex administrators and verified installer
accounts from the TLink trade dashboard under `Calculator` for quote and invoice
preparation. The trade surface is estimate-only and cannot refresh registries.

The shared quote flow now follows a short activity, plain-English scenario,
date, brand, model, postcode and formula-input sequence. It omits compliance
attestations such as consumer-fact-sheet, disposal and warranty questions from
the quote calculator, keeps registry and calculation evidence under collapsed
details and removes the registry-refresh action from the trade surface. Source
trust, accepted-snapshot freshness and installation-date eligibility remain
enforced server-side. Quote mode is estimate-only; the default compliance path
remains strict.

Future quote dates follow the official rule windows rather than today's date.
VEU accepts dates from 30 June 2026 onward subject to the selected product's
effective window, SRES accepts dates through 2030, and NSW and local programs
use their official effective windows.

Official-product foundations now include:

- 16,684 current CER registered solar-water-heater and air-source-heat-pump
  products plus both current CER postcode-zone documents;
- 31,418 stable GEMS records from 11 official data.gov.au resources under the
  automatic daily registry contract;
- 44,119 stable rows across all 14 live-tested federal feeds, including 12,701
  CER-hosted CEC module, inverter and battery rows that remain controlled-manual
  until commercial reuse permission is recorded;
- 2,024 current Synergy supported-solution rows parsed under a controlled-manual
  contract, while Horizon Power remains blocked without a supported feed; and
- the active VEU Public Registry projection of exactly 75,492 Public Visible
  rows, comprising 64,715 `Approved` and 10,777 `Legacy` rows.

VEU exact source bytes and custody metadata are retained in content-addressed R2
objects. D1 holds indexed current and historical projections for fast product
search and server-side validation. Calculations query D1 only and never download
or parse the registry. A live 64 MB acquisition, R2 replay, validation and D1
activation completed with all 75,492 rows.

The post-optimization production VEU refresh POST succeeded with HTTP 200 under
request and Ray identifier `a2821aca0bc9b95b`, using 70.404 seconds wall time
and 3.748 seconds CPU time. The active projection still contains 75,492 rows and
the UI reports snapshot prefix `78853aad-a77...`; the full snapshot identifier
was not captured and is not claimed. An earlier pre-optimization refresh returned
HTTP 503 at the intentional fail-closed resource boundary. The optimized refresh
subsequently succeeded and later product GET requests returned HTTP 200.

The VEU catalogue contains 32 definitions. Thirty aggregate activity codes are
formula-ready. Twenty-seven expose an executable estimate path: 21 fully
available aggregate families plus six enforced partial subsets. The fully
available set is `3`, `13`, `15`, `17`, `22`, `24`, `25`, `26`, `27`, `30`,
`35`, `36`, `37`, `38`, `39`, `40`, `41`, `42`, `43`, `44` and `48`.
Codes `14`, `28` and `32` have formulas but remain source-gated.

The exact partial-estimate messages are:

- `1`: Exact estimates are available for 1C small systems and supported 1D
  systems. The 1C medium-system Bs/Be conflict between official sources remains
  fail-closed.
- `6`: Exact estimates are available for supported single-split and multi-split
  systems. Multi-split estimates use the approved outdoor unit plus the total
  connected indoor-unit capacities; packaged systems remain fail-closed.
- `31`: Exact estimates are available for 31A motors selected from the
  installation-date GEMS register. Activity 31B remains fail-closed until an
  exact VEU-approved product contract is available.
- `33`: Exact estimates are available for 33A products selected from the
  installation-date VEU Public Registry. Activity 33B remains fail-closed
  because the governed registry connector has no exact 33B product contract.
- `34`: Exact estimates are available only for sites that are not required to
  comply with Building Code Part J6. The Part J6 baseline branch remains
  fail-closed.
- `46`: Exact historical estimates require an installation-date-eligible Legacy
  VEU product. The current Public Registry has no Approved activity 46 product
  for a current installation.

The national readiness result is 50 `estimate_available` plus 6
`partial_estimate_available`, for 56 of 216 executable templates and 160 blocked
or non-executable templates. The sealed coverage hash is
`sha256:35e5ff0ff2bacff2504305a30be71c8b38ebe285f33d729bb842c364df124347`.
Certificate actions enabled remain 0.

Signed-in production QA passed on Sites version 297. On the trade dashboard, a
future-date SRES solar-PV quote for 17 August 2026, postcode 3000 and 6.6 kW
returned 39 STCs. A VEU Activity 6 scenario (xi) quote for ERS Tech model
`ERS-AC24KWH-G` on 17 August 2026 with 3.5 kW indoor heating and cooling
capacities returned 2 VEECs. Consumer-fact-sheet and disposal questions were
absent, registry refresh was absent and calculation details were collapsed.
The signed-in administrator calculator also loaded at release 297. BESS1 and
BESS2 remain not live-active until the central licensed CEC snapshot is
available. Certificate actions remained disabled.

The version-297 package is pinned to exact application source
`11f4721b678425a4294e95c631e0d37d3fab0ffd` in GitHub and the Sites managed
source branch. The release retained the sealed 56-of-216 calculation coverage
result and active 75,492-row VEU registry projection while adding the simplified
quote contract and future-date handling verified above.

Every formula-dependent product must match the exact official VEU category,
status and installation-date window. Only an `Approved` row inside its declared
inclusive window or a `Legacy` row inside its exact closed inclusive window can
count. GEMS-only, fuzzy, current `Legacy` and out-of-window matches fail closed.

Controlled VEU boundaries remain explicit:

- Activity 14 has no live Public Registry rows, Activity 28 has no governed
  connector or rows, and Activity 32 has no stable exact VEU-to-GEMS crosslink;
  Activity 32 must never use fuzzy matching;
- Activity 46 has no current `Approved` rows and 674 `Legacy` rows available
  only for exact in-window historical use;
- Activity 45 is closed; Activity 47 BESS1 and BESS2 definitions, licensed CEC
  POST route and nightly worker path are deployed but remain not live-active
  until an accepted licensed snapshot exists; BESS3 and BESS4 still require
  exact governed inverter-output authority, and BESS5 still requires the Scheme
  Administrator's exact recording method;
- Activity 27's AEMO load-table alternative is not enabled, the Part 34 J6
  refurbishment branch fails closed, and PBA and other project-based activities
  remain governed project methods rather than deemed calculators.

The version-297 calculator, bounded refresh correction and VEU snapshot were
verified through the signed-in administrator and verified-installer estimate
paths. That release record does not claim that the guarded daily schedule,
certificate creation, certificate submission, certificate trade or settlement
occurred. At the version-297 checkpoint, NSW TESSA and
administrator-accepted battery lists were unavailable as supported machine
feeds.

## Prior released milestone: AEA-CALCULATOR-USABILITY-AUTHORITY-48

Status: historical. Exact executable application commit
`ca3d84a497258426c7ab34c87e8059df1cba2a27` is released as Sites version 300
through deployment `appgdep_6a7875602838819182dc5ba7dec6366b` with
environment revision 19 at `https://compare.ausenergyassessments.com`.
Initial milestone source `c9fb34115209c0ea0a1fc02ee2095250458c256f`
is historical Sites version 298.

### Outcome

Make the customer and trade paths materially easier to understand and make the
estimate-only calculator useful without a login, while retaining exact product,
effective-date and compliance boundaries.

### Released scope

- Add a public anonymous quote-only calculator that uses the governed estimate
  contract without granting registry refresh, compliance or certificate access.
- Lead the customer landing page with one obvious home-plan action, use a
  one-question-at-a-time planner, plain household taxonomy and a direct TLink
  login beside Account. The taxonomy separates hydronic heating, wood heating,
  air conditioning and heat pumps and includes electric hot water with a gas
  booster and two-phase electrical supply.
- Make VEU Activity 15 weather-sealing scenarios explicit so doors, windows,
  exhaust fans, wall vents, temporary and permanent chimney or flue sealing and
  evaporative-cooler outlets are not hidden behind one ambiguous form.
- Allow future installation dates inside each program and product's official
  effective window.
- Support 1 to 10 identical-model heat-pump or solar-water-heater units in one
  estimate. Mixed-model multi-unit jobs remain forward work.
- Support repeatable indoor-unit selection for VEU Part 6 multi-split and
  variable-refrigerant-flow quotes and a packaged-system quote-only estimate.
  Packaged-system compliance and other strict multi-product compliance bundles
  remain blocked until their exact governed contract is complete.
- Add the official TESSA D17 to D20 automatic registry implementation and exact
  source validation. The live official source contained 746 rows, comprising
  663 `Active` and 83 `Cancelled`, with source SHA-256
  `3770ac57885bbd968e35e25c67b4546e9ff6d4325c63cf4c4592a9b5da0178b0`.
  The source is activated and current in version 300.
- Let a trade enter the customer discount once and apply that exact amount to
  the next quote or invoice. Certificate counts are not converted to dollars
  automatically because certificate prices and provider fees are not fixed by
  the scheme formula.
- Do not add a customer-shareable rebate receipt. The product owner rejected it
  as unnecessary; the retained workflow ends at the practical quote or invoice
  discount handoff.

### Controlled limits after release

- Sites does not contain `CREDITEX_CEC_BATTERY_API_USERNAME`,
  `CREDITEX_CEC_BATTERY_API_PASSWORD` or
  `CREDITEX_CEC_BATTERY_LICENCE_REFERENCE`.
- BESS1 and BESS2 remain pending until those licensed platform credentials
  create and activate an accepted snapshot.
- BESS3 and BESS4 remain blocked because the current licensed CEC contract does
  not supply the exact Rule-required maximum rated AC inverter output.
- Repeated water-heater units must use one identical approved model, and
  packaged-system calculations remain quote-only.
- The post-TESSA GEMS refresh failed closed because official resource
  `gems-commercial-refrigerators` decreased from 7,500 to 7,499 rows. Current
  public GEMS search returns `OFFICIAL_PRODUCT_REGISTRY_STALE`; no GEMS-backed
  calculator can be represented as active or current until the prior and
  current retained source bytes are exactly reviewed and the decrease is
  accepted or rejected through the governed process.

### Release and live evidence

- The saved-version identity is
  `appgprj_6a550c378000819185caf094173422bb~appgver_e084d0c2568c81918bdcf23adc78ad5e`
  with Sites content hash
  `sha256:29ca942f7801e5657cff10f4dd2e1e5dde14fc9386f19fb51f6691703c58db73`.
  Sites stored 384 files and 33,607,680 bytes.
- Local archive `.openai/site-release-ca3d84a.tar.gz` is 8,175,111 bytes with
  SHA-256 `a2df1764b0850d46f8088ddd8fe6e8c422d6072f9560df08d43fdba81f82a79a`,
  398 entries and all 126 migrations.
- Historical version-298 public QA loaded the homepage, `/plan` and
  `/calculator`, showed Account and TLink login links and returned 39 STCs for
  future date 17 August 2026, postcode 3000 and 6.6 kW small-scale solar PV.
- Version-300 signed-in trade QA returned 39 STCs for small-scale solar PV using
  installation date 9 August 2026, postcode 3000 and 6.6 kW. It also verified
  the VEU 1C repeated identical-unit quantity and Activity 15 plain-English
  scenario flow.
- Version-300 administrator QA refreshed TESSA before GEMS. The activated D17
  picker exposed 70 official brands, or 71 options including the placeholder;
  Aestiva exposed four exact models, or five options including the placeholder.
- The later GEMS refresh failed closed on the reviewed decrease described above.
  No quote, invoice, certificate or customer record was written.

## Prior released milestone: AEA-IMMERSIVE-CUSTOMER-JOURNEY-49

Status: exact executable application commit
`bc4096d61cb493e819555d72113d0c77d45a1653` is pushed to the GitHub branch and
Sites internal `main`, and is released as Sites version 301 through deployment
`appgdep_6a7898485dd48191acb31466092b5fe8` with environment revision 19 at
`https://compare.ausenergyassessments.com`. Sites version 300 is historical.

### Outcome

Give public customers a more directional, accessible and responsive home-energy
journey while keeping the trade workspace static and extending quote-only water
heater estimates to mixed approved products without weakening compliance.

### Released scope

- Replace the public home experience with a semantic, lightweight CSS and HTML
  spatial journey. It uses no canvas, WebGL or video, respects reduced-motion
  preferences and adapts across desktop, laptop and mobile layouts.
- Make the planner task-first and connect each result to a clear `Start here`
  action. Add a TLink-logo link that goes directly to the trade dashboard.
- Keep the trade route static. Public spatial animation is not mounted on the
  trade route.
- Support mixed exact approved SRES solar-water-heater and air-source-heat-pump
  quote rows and VEU 1C, 1D, 3C and 3D quote rows, with up to 10 systems in one
  estimate.
- Strict compliance remains fail-closed at one unit. Multi-system
  quote flexibility does not authorise certificate creation or relax governed
  product and effective-date checks.
- Do not add a customer-shareable rebate receipt.

### Release and validation evidence

- Local archive `.openai/site-release-bc4096d.tar.gz` is 9,823,592 compressed
  bytes with SHA-256
  `5ae1990b73dd2fd54bebfc5182b8a1616fc0a51afd925ecd09cfd726eebc01a3`,
  399 tar entries, 385 files and all 126 migrations.
- Saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_57a5cb197f548191a5ef29ab9c99f59e`
  has Sites content hash
  `sha256:3bbab6b63c31708d6b9ded69b50da11e31d45ff75557d82823d3b12fc4a02e3b`.
  Sites stored 35,328,000 bytes across 385 files. Provider identity is
  `info294029--aea-energy-comparison`.
- Full validation passed: typecheck, lint, 32 of 32 integration tests, 1,803
  main tests with 1,793 passed, 10 intentionally skipped and 0 failed, all 126
  migrations, the customer-plan PDF audit, the production build and the Sites
  audit. Independent focused final validation passed 115 of 115.
- Signed-out live QA verified the public home, `/plan`, the result `Start here`
  action and `/calculator`. Native future date `2026-09-03` persisted and a live
  solar-PV calculation returned 39 STCs. The browser console showed no warnings
  or errors.
- Live trade-route QA confirmed the route stayed static and contained no public
  animation. Signed-in dashboard QA was unavailable because both live browser
  sessions presented the sign-in boundary; no signed-in v301 QA is claimed.

## Prior released milestone: AEA-IMMERSIVE-PLAN-ACTION-HANDOFF-50

Status: exact executable application commit
`f797ab7ee447bc31d66b5760f6613e46f107e97d` is pushed to the GitHub branch and
Sites internal `main`, and is released as Sites version 302 through deployment
`appgdep_6a790aefc05c8191b4a03f72181f7031` with environment revision 19 at
`https://compare.ausenergyassessments.com`. The Sites deployment URL is
`https://aea-energy-comparison.info294029.chatgpt.site`. Sites version 301 is
historical.

### Outcome

Carry the public customer from a guided home journey into a useful, personalised
plan and an obvious next action, while keeping the contact handoff minimal,
consented and independent from account creation.

### Released scope

- Put the generated home image on the public home and planner and connect it to a
  semantic four-stage home journey. Progressive CSS 3D and pointer depth add
  spatial movement without WebGL, canvas or video, and reduced-motion users get
  a stable presentation.
- Separate `Open wall vents` from `Open or unused chimney or flue`, remove the
  duplicate `Heat-pump space heating` choice and safely normalise the precise
  legacy heating value into reverse-cycle air conditioning.
- Put `Start here` and answer-specific `Quick wins` before the longer roadmap.
  Recommendations cover only relevant actions such as filter and app controls,
  layers or electric throws, ventilation and moisture, hot-water routines,
  appliance timing, solar load shifting, EV charging, fans and shading.
- Provide a no-account basic enquiry beside a distinct `Create free account`
  action. The public enquiry accepts only name, email and/or phone, postcode, one
  interest, an optional message and explicit consent. It does not send plan
  answers, NMI, interval data, usage, budget, address or account data.
- Keep public enquiries under `hold_for_authority_review` with `autoSend: false`.
  Remove the timing-only false-success path, retain honeypot filtering and ensure
  the client cannot describe a filtered request as received.
- Correct shared navigation and result widths so the header, image, roadmap and
  enquiry remain usable without horizontal overflow on desktop and mobile. The
  professional trade workspace remains static.
- Update the Google Apps Script relay source for the home-upgrade enquiry. The
  hosted Apps Script deployment remains unverified and is not claimed current.
- Do not add a customer-shareable rebate receipt.

### Release and validation evidence

- Local archive `.openai/site-release-f797ab7.tar.gz` is 11,484,967 compressed
  bytes with SHA-256
  `291686F6352979EBE7C9E342BFB20BF67FBE0D3796BB68A6B3A530391333AFD2`,
  402 tar entries and all 126 migrations.
- Saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_33c4dd63992481919b3d760cee8831fd`
  has Sites content hash
  `sha256:1e2af6133642887179c6887212801973a49006bf9a4f76a3f98d9eb3daf06300`.
  Sites stored 37,048,320 bytes across 388 files. Provider identity is
  `info294029--aea-energy-comparison`.
- Full `npm.cmd run validate` passed before deployment. Independent release
  review found no remaining P0 or P1 issue.
- Desktop live QA measured equal 1,407-pixel client and scroll widths with all
  navigation visible. The decoded home image was 1,253 pixels wide and the
  `/plan` image was 1,313 pixels wide. The result exposed `Start here`, `Quick
  wins`, the no-account enquiry and the distinct account action.
- Live taxonomy QA showed separate `Open wall vents` and `Open or unused chimney
  or flue` choices and no `Heat-pump space heating` choice.
- At a 390-pixel mobile override, client and scroll widths were both 375 pixels;
  the form was 297.6 pixels wide and navigation was 325.6 pixels wide. The
  browser showed no warnings or errors. No lead was submitted during QA and the
  viewport was reset afterward.

## Prior released milestone: AEA-PERSONALISED-PLAN-OPEN-TRADE-LEADS-51

Status: milestone application commit
`a0fcbf200ece76f68bbd83c298f1d556333c615e` and production PDF-font correction
`79f7e2e5be14464410ba40a749453c7473b22d4d` are pushed to the GitHub branch,
GitHub `main` and Sites internal `main`. Exact executable commit
`79f7e2e5be14464410ba40a749453c7473b22d4d` is released as Sites version 305
through deployment `appgdep_6a797f25df8c819187590b70811a6794` with
environment revision 20 at `https://compare.ausenergyassessments.com`. Sites
versions 303 and 304 are historical.

### Outcome

Give a household a clearer property-specific journey, a useful personalised
report and one consented path to every matching platform-approved trade, without
requiring an account or adding a second trade-qualification system.

### Released scope

- Keep the public header, journey, question card, result and enquiry surfaces on
  one responsive width contract. Add a reduced-motion-aware holographic energy
  field to the customer experience while the professional trade workspace stays
  static.
- Ask for property type, storeys, approximate internal floor area, occupants and
  shared walls. Treat apartments, units, townhouses, villas, duplexes, strata,
  body corporate, owners corporation and shared common property as one clear
  approval context, while external-wall insulation remains a separate fact.
- Generate the customer plan from report contract
  `2026-08-10-personalised-report-v4`, design contract
  `2026-08-10-personalised-report-design-v3` and PDF contract
  `2026-08-10-personalised-plan-pdf-v7`. The customer email attaches the
  personalised report with a cover, property context, priorities, quick wins and
  useful AEA and government resources.
- Convert a consented no-account enquiry into one idempotent public opportunity
  and private contact-release record. Platform approval is authoritative. Every
  active platform-approved installer with a declared matching service and state
  and any active matching service area receives the opportunity. There is no
  six-trade cap and no separate capability-qualification subsystem.
- Recheck active platform approval and current customer consent before contact
  disclosure or notification. Manual assignment uses the same platform-approval,
  service, state and area contract.
- Keep the complete customer plan and PDF private. Australian Energy Assessments
  retains the submitted name, email, phone and postcode. Matching trades receive
  email, postcode, service and the non-empty question; sharing name and phone is
  separately optional.
- Sign the Google Apps Script relay and health probe, reject stale or invalid
  signatures, preserve one stable submission identity across retries and dedupe
  repeated delivery before downstream effects.
- Add forward migration `0126_public_trade_lead_contact_release.sql` only. The
  migration chain ends at `0126`; no separate per-service approval migration or
  table exists.

### Release and validation evidence

- Saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_248c3d6df9448191b171e990ac8dfdd1`
  and deployment `appgdep_6a797f25df8c819187590b70811a6794` identify exact
  commit `79f7e2e5be14464410ba40a749453c7473b22d4d`, environment revision 20
  and project `appgprj_6a550c378000819185caf094173422bb`. Sites stored 391
  files and 37,201,920 bytes with content hash
  `sha256:e2869ae853c4e927c32799128bb83133c7a3d1974effd60ed23baacec5ae6976`.
  No separate local v305 release-archive identity was supplied.
- Historical Google Apps Script version 12 deployment
  `AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW`
  served v305. The prior version 10 deployment
  `AKfycbwstZJE6asc39Mtbw1uEN_IE0osNOqcHvRV-Ope-AKfOgooEXMVHr5Hff2gHPXSv308`
  is archived.
- The signed `runOperationalHealthCheck` ran from 18:08:25 to 18:09:18 Sydney
  time. Monitor `api-health-1786349306423` was healthy: `site_runtime` HTTP 200
  in 1,555 ms, `electricity_plans` HTTP 200 in 35,575 ms, `gas_plans` HTTP 200
  in 13,232 ms and `lead_delivery` HTTP 200 in 2,193 ms for probe
  `7bbd1b86-db74-4b0f-acc9-290ff8ae9469`. Worker request
  `a28d84795b0fba39` returned HTTP 200 with outcome `ok`, 1,198 ms wall time and
  7 ms CPU. The final five-minute errors-only query returned zero events.
- Production migration preflight found 210 opportunities, 210 non-empty source
  references and 0 duplicate source references before migration `0126`. After
  deployment, the refreshed signed-in owner Database console reported 239
  application tables and confirmed `public_trade_lead_contact_releases` is
  present.
- Full `npm.cmd run validate` passed typecheck, lint, integration, all 1,858 main
  tests with 10 intentional skips and zero failures, `db:check`, the PDF audit,
  production build and Sites bundle audit. The focused font, public and account
  group passed 41 of 41.
- Live v305 result and print QA preserved Townhouse, two storeys, 100-199 m2,
  three/four occupants and two or more shared sides. Quick wins, optional
  name/phone trade sharing and the private full-plan boundary were present. The
  impossible all-walls-adjoin-other-dwellings option was absent, and desktop
  client width equalled scroll width.
- Sites version 304 exposed a production-only runtime fetch stall for PDF fonts.
  Corrective commit `79f7e2e5be14464410ba40a749453c7473b22d4d` bundles and validates
  both Liberation Sans programs without a customer-plan PDF network fetch.
  Production PDF requests `a28d5de18fe874e0` and `a28d603abf6674e0` then
  returned HTTP 200 `application/pdf` in 467/441 ms wall/CPU and 452/430 ms
  wall/CPU. Local Cloudflare validation returned a valid 268,767-byte PDF in 203
  ms cold and 115 ms cached; its audit found 10 tagged pages and two embedded
  font programs.
- No real customer lead was submitted. The post-v305 mobile viewport override
  did not apply, so no new live mobile emulation is claimed. Earlier 341-pixel QA
  of the same visual source had no overflow; the font-only corrective commit did
  not change that visual source.

### Controlled source limit

GEMS remains fail-closed. The accepted commercial-refrigerator artifact has
7,500 rows with SHA-256
`dcd5e18d9c58ddf13cde8aa1c00f48c704965b7156db61b1a330eef2752d73df`.
The held candidate has 7,499 unique rows with SHA-256
`db6068208c9bc6fca9033879a166dbce1ad0941e376aea786ac5b155dd013b09`.
The exact missing record is unknown without authorised read-only access to the
retained R2 bytes, so no GEMS-backed pathway may be represented as current.

## Released milestone: TLINK-JOB-SCHEDULE-PLANNING-66

Release status: exact corrective application commit
`df86aa3ced0ee8d67022626369ebb0412af0b8da` is validated and pushed to GitHub
branch `codex/job-schedule-week-calendar` and Sites internal `main`. It is
released as current Sites version 335 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_bfbac71cff188191af22d0819944fb4d`
and deployment `appgdep_6a7eec87402c81918ed74c29a8f03755` reconcile to
that source. Deployment succeeded on provider
`info294029--aea-energy-comparison` with environment revision 20. Sites stored
424 files and 39,761,920 bytes with content hash
`sha256:e70ba30cd399229086af36c1565e202a7558b097294e69798f23f69b3af4122b`
and sediment `file_000000009fb0820ba1573cc5b72a19f4`. The local version-335
archive is 12,198,748 bytes with 438 tar entries and SHA-256
`48d2a866ff37c0df7bf13525b5d551a35f0bd8b6abcc0eabcc1da15bc13f7f20`.

### Outcome

Let a trade user assign and schedule a job in one save, inspect and adjust
existing appointments directly on the visible week, stage several guarded
changes and deliberately save or discard the complete plan without duplicate
booking prompts, and keep the internal and connected calendars consistent with
the exact saved duration and useful authorised job details.

### Implemented scope

- Assignment and the first appointment commit atomically with revision,
  accepted-quote, active-member, capability and conflict guards. Job detail GET
  projects the revision needed by that compare-and-swap write.
- A saved appointment appears once. Another form opens only through the explicit
  `Add another` action.
- Appointment cards open a dismissible detail dialog with the accepted quote,
  authorised phone and email, service address, directions and 15-minute controls.
  Closing the dialog retains the exact selected-job deep link; `Back to all jobs`
  clears it deliberately.
- Whole appointments move in 15-minute steps and their accessible bottom edges
  resize duration. A 30-minute appointment occupies 32 pixels against a 64-pixel
  hour, and typed or saved duration changes use the same geometry. Up to five
  distinct changes remain local with one `Unsaved` state until Save commits the
  batch or Discard restores server truth without a write.
- Batch scheduling preserves appointment and job revisions, assignment,
  accepted-quote, capability, same-worker overlap, unavailability,
  compliance-intent, notification and external calendar-sync boundaries.
- Every connected-calendar mutation forces a provider PATCH and verifies the
  returned start and end before recording the sync as current. Authorised events
  include the customer name and contact details, full service location, job
  reference, appointment type, notes and exact TLink job URL while protected-lead
  privacy remains enforced.
- Different workers may overlap. Final same-worker conflicts, including
  conflicts created inside one batch, fail closed.
- The unsupported direct-customer compliance intake is hidden for accepted
  released leads while the API permission denial remains unchanged.

### Release and validation evidence

- Full `npm.cmd run validate` passed in 74.3 seconds on exact corrective source
  `df86aa3ced0ee8d67022626369ebb0412af0b8da`, including typecheck,
  warning-free lint, integration and Node tests, all 140 migrations, database
  checks, customer-plan PDF audit, production build and Sites bundle audit. This
  release changes no schema and adds no migration.
- Signed-in owner desktop QA measured an exact 32-pixel 30-minute card against a
  64-pixel hour and confirmed the accessible bottom-edge resize control.
- Accepted AEA job `TLJ-X5JVPTHX` was booked exactly once for Saturday 15 August
  2026 from 2:00 pm to 4:00 pm and produced a rich Google Calendar event. The
  exact job deep link remained selected when appointment details closed and
  `Back to all jobs` cleared it.
- At 390 by 844 there was no horizontal overflow and the appointment-details
  dialog remained usable. The `Test 123` Google event displayed 4:00 pm to
  4:30 pm, matching the saved 30-minute appointment.
- Controlled provider PATCH proof changed James William job `TLJ-X5JVPTHX` from
  2:00-4:00 pm to 2:00-3:45 pm through the phone dialog. TLink reported `1
  appointment saved. Connected calendars were updated and verified`, and Google
  reloaded at exactly 2:00-3:45 pm. The job was restored to 2:00-4:00 pm;
  authoritative TLink reload showed two hours and Google reload showed exactly
  2:00-4:00 pm with no remaining 3:45 occurrence.
- `/api/health` returned HTTP 200 with `Cache-Control: no-store`,
  `Content-Type: application/json` and
  `{ "ok": true, "service": "aea-energy" }`. The Sites errors-only 120-minute
  query returned one information-level cancelled job-detail GET caused by the QA
  browser reload, request `a2af48cb9998e7d1`, and no exception or error. Widened
  45-minute logs showed both schedule PATCH requests, `a2af47a15e5fe7d1` and
  `a2af489e3eb1e7d1`, with outcome `ok`, followed by successful CRM and schedule
  GETs.
- Historical version 334 from
  `f92b2e1c90178e8fb56f1b2841b4cbbf7bb7e7cb` was saved as
  `appgprj_6a550c378000819185caf094173422bb~appgver_df433c53dcc481919d1a7474c8426cd5`
  and deployed through `appgdep_6a7ee956504881918dbe3752c62d1080`. It carried
  the duration, connected-calendar, rich-event and job-revision corrections but
  was superseded by version 335 to preserve the exact job deep link while
  appointment details are open.
- Historical corrective version 333 from
  `d35fdb8d52056fec6b62b6b56a4739a0443cadcf` was saved as
  `appgprj_6a550c378000819185caf094173422bb~appgver_55bd301f865c8191b6987afa0b940f9c`
  and deployed through `appgdep_6a7ed5605fd881918d2f288f2194f66e`. Its release
  gate passed 36 of 36 integration tests and 2,255 total Node tests with
  2,245 passed, 10 intentionally skipped and zero failed.
- Intermediate version 332 from
  `362be0632b5e1a1d89a312c791c3665924f037d7` was saved as
  `appgprj_6a550c378000819185caf094173422bb~appgver_8c462e5b0ef08191850c4ac79373a180`
  and deployed through `appgdep_6a7ed1cbcc0c81919e2204380055f04b`. Its package
  content hash was
  `sha256:2761c5235a0e4a83cd11f77f4bd3a562788e1b712288f2589b9262273bb95fba`,
  and its local archive SHA-256 was
  `5FCA9C6CAA92BDF4780378C276A561DDC57ED68021D886B02F5CCC3CC816C5A1`.
  Live QA exposed an incorrectly mounted direct-customer compliance intake and
  one expected HTTP 403. There was no data or privacy bypass; version 333
  superseded it with the UI gate.
- Separate signed-in staff identities with team or own schedule permission were
  unavailable. Live staff-role presentation and permission mutations remain
  unverified while authoritative server permission tests remain green.
- The hosted product remains a pre-launch test environment. Test records may be
  replaced, but the final wipe remains a separately authorised launch operation.

## Previous released milestone: TLINK-JOB-SCHEDULE-WEEK-CALENDAR-65

Release status: exact executable application commit
`4d3463ec1173be50e3b76ef92fa92e9cb1f81993` is validated and pushed to GitHub
branch `codex/job-schedule-week-calendar` and Sites internal `main`. It was
released as historical Sites version 331 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_27287ed04e3c8191be9b208dcedeb705`
and deployment `appgdep_6a7e857ee3588191bd857fe21cd8ec41` reconcile to
that source. Deployment succeeded on provider
`info294029--aea-energy-comparison` with environment revision 20. Sites stored
424 files and 39,690,240 bytes with content hash
`sha256:085383d397d4deec9ce80f277bc9971dc32b0988c4d7b3dc375be97120893fbd`.
The local version-331 archive is 12,184,305 bytes with 438 tar entries and
SHA-256 `9FFD9B378B089EAEC882BC1E2FF5C3222B7A929F9B80DF3DB0805B7422F64508`.

### Outcome

Let a trade user see the relevant Monday-to-Sunday calendar while assigning and
scheduling a job, without crowding a large team into one unreadable view or
allowing stale client state to bypass worker-specific conflicts.

### Implemented scope

- One job `Schedule` tab now contains assignment, current appointments, booking
  controls and the focused week calendar. The replaced `Assign` tab and action
  are removed.
- Previous, next, today and direct-week controls navigate without an artificial
  future horizon. The job date recentres the calendar, while deliberate manual
  browsing remains independent until that date changes.
- Team-scope viewers can show All workers or one named worker. Own-scope viewers
  receive only their own server-authorised calendar. The signed-in viewer, not
  the business owner flag, controls the `Me` label.
- Calendar toolbar and boundary time labels align without clipping. A
  double-click on an open position creates a one-hour proposal, and its bottom
  edge resizes in 15-minute increments through a 32-pixel touch target with an
  equivalent keyboard path.
- Same-worker overlap and unavailability are blocked in the live preview and an
  atomic D1 guard. Different workers can be scheduled at the same time.
- A missing or inactive assignee, an unloaded or hidden proposal week, and any
  latest calendar-load failure keep appointment submission disabled with a
  recoverable status and retry path.
- Direct-owned quote completion retains `Done` and adds
  `Schedule and assign job`, which closes the delivery preview and opens the
  combined tab. Released AEA leads remain assignable before acceptance, but all
  appointment and rescheduling mutations require an accepted row for the exact
  current quote version, including a transaction-time race guard.
- Focus, visibility, same-job navigation and bounded polling refresh accepted-job
  eligibility without remounting the job workspace or discarding draft schedule
  and assignment choices. Mutations fail closed while that refresh is pending.
- An accepted customer can use `Save acceptance PDF`. The accepted-only route is
  token-authorised, returns private secure PDF headers and renders the retained
  signed acceptance, selected scope, invoice and payment snapshot. Test payment
  state preserves the `DO NOT PAY` warning.

### Release and validation evidence

- Full `npm.cmd run validate` passed on the exact final application source:
  typecheck, warning-free lint, 36 of 36 integration tests, 2,235 total Node
  tests with 2,225 passed, 10 intentionally skipped and zero failed, all 140
  migrations, PDF audit, production build and Sites server-bundle audit. The
  final focused set passed 63 of 63 after the last refinements; the preceding
  broader calendar and acceptance-PDF audit passed 111 of 111; `git diff
  --check` passed.
- Signed-in owner/team-scope live QA passed at 1440 by 1000 and 390 by 844. The
  calendar stayed aligned and contained, the phone week remained internally
  scrollable, All/Me filters passed, double-click produced a one-hour proposal,
  and proposal resize changed 60 to 45 to 60 minutes. The accepted AEA job no
  longer showed acceptance-wait copy; its server-saved assignment remains
  `Unassigned`, so it correctly required assignment before booking. No assignment
  or appointment was saved.
- The accepted-customer receipt control was visible on desktop and phone. Its
  live PDF GET returned HTTP 200 twice. Two earlier invalid OCR transcriptions
  produced expected handled 404 `QUOTE_LINK_NOT_FOUND` probes; the exact link
  returned 200. No quote decision or message was submitted, and no connected
  accounting-provider draft export was executed.
- Historical version 328 from
  `510a3eca360ccdce45411f2fcdcc6237a0804923` first exposed the completed feature,
  but live QA found the assignment button clipped. Version 329 from
  `c082239d88a8debd112ee0a304885bb6626b01e8` was also superseded after its
  same-specificity rule lost to a later component stylesheet. Version 330 from
  `b29598f7d7f3c3f07a86cf9e36fcccf6b167d47d` corrected the layout. Version 331
  was the verified refinement release and is historical after version 332
  replaced it.
- Health returned HTTP 200 with `ok: true`. The final one-minute error-only
  Worker query returned zero events; the handled OCR 404 probes were not crashes
  or failed Worker outcomes. A separate signed-in own-scope staff identity was
  unavailable, so live own-role presentation remains unverified while
  authoritative route, permission and UI coverage is green.
- The hosted product remains a pre-launch test environment. Test records may be
  replaced, but the final wipe remains a separately authorised launch operation.

### Historical follow-on outcome

The first two recorded follow-on actions were delivered by versions 332 and 333.
The current priority order is the single next-five sequence below.

## Previous released milestone: TLINK-QUOTE-ACCEPTANCE-INVOICE-ACCOUNTING-64

Release status: exact executable application commit
`9624507b9f4ed274169b67076a40ddb34cd26acb` is validated, pushed to GitHub and
Sites internal `main`, and released as historical Sites version 327 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_02b29fe421e08191aa90224edfd0335a`
and deployment `appgdep_6a7d96af6830819193ccc0f33ff86abf` reconcile to that
source. Deployment succeeded on provider `info294029--aea-energy-comparison`
with environment revision 20. Local archive `aea-energy-sites-v327.tar.gz` is
12,164,300 bytes with 438 tar entries and SHA-256
`95DE14D1809A290898236FF65026F6AD9447EB37A91126D61710CA9FDA31C347`. Sites
stored 424 files and 39,966,720 bytes with content hash
`sha256:288982ce37c09394283008a4591df411ef860c53835705001d5261bbb3030afb`;
the package contains all 140 migrations through
`0139_trade_accepted_invoice_one_per_job.sql`.

### Outcome

Make customer quote acceptance reliable and turn one accepted quote into one
immutable invoice and one exact accounting handoff without re-entering customer,
line, certificate, GST or total details.

### Implemented scope

- Accept immutable quote snapshots containing negative STC, VEEC, ESC and other
  certificate or rebate adjustments while keeping product and labour values
  non-negative and requiring the signed line sum to equal the accepted totals.
- Make acceptance replay-safe with a stable decision identifier and payload hash.
  A lost response can return the same exact accepted receipt without a second
  decision, invoice or finance mutation.
- Create at most one immutable accepted invoice per job inside the acceptance
  transaction. Freeze the accepted lines, signed subtotal, GST and total, due
  date and complete bank-transfer details without overwriting manual, quick or
  accounting finance state.
- Show the accepted invoice in the job and invoice register with deterministic
  precedence, one row per job and reconciliation or attention states preserved.
- Add reusable Price Book certificate items with zero cost and a required
  negative sell price. Quote use maps them to signed adjustment rows while
  ordinary product and labour rows still reject negative values.
- Export the exact accepted invoice to Xero, MYOB and QuickBooks Online through
  provider-specific draft-invoice adapters. Preserve signed line-level subtotal,
  GST and total arithmetic, use actual Australian QuickBooks tax-code IDs, stable
  provider idempotency keys and exact found-record collision checks before any
  provider write.

### Release and validation evidence

- Independent acceptance, invoice, register, certificate and accounting review
  passed 101 of 101. The integrated regression set passed 103 of 103 and the
  release-document set passed 6 of 6.
- Typecheck, warning-free lint, `db:check` across all 140 migrations, production
  build with Sites bundle audit and `git diff --check` passed.
- Raw unfiltered `npm test` reported 2,202 total: 2,178 passed, 10 skipped, 7
  failed and 7 cancelled. Every failure and cancellation is confined to the
  preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
  SHA-256 remains
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
- No live Xero, MYOB or QuickBooks provider export was executed during release
  validation. Provider-side draft creation, connected-account tax mapping and
  round-trip reconciliation remain the first controlled follow-up.

## Previous released milestone: TLINK-VERSIONED-QUOTE-DELIVERY-63

Historical release status: exact executable application commit
`852aaa4b60cc72b598b375bcd96bc4cc9dd29d3d` is validated, pushed to GitHub and
Sites internal `main`, and released as historical Sites version 326 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_adb266d1b0a88191bb7df8841d02c1f2`
and deployment `appgdep_6a7d472339648191843e05066c7d576b` reconcile to that
source. Deployment succeeded on provider `info294029--aea-energy-comparison`
with environment revision 20. The local 12,128,693-byte archive has 436 tar
entries and SHA-256
`3164A99777EE66ECF8C6B5F35A2F2364C3A4296FFACEC60B347ED08700E24239`. Sites
stored 422 files and 39,833,600 bytes with content hash
`sha256:8ef0f48632dac835b45ab48c1a14d4c70d4d2f191f4def5a43aff50c4aa55b5f`;
the package contains all 138 migrations through
`0137_trade_quote_delivery_renderer_revision.sql`.

### Outcome

Preserve the immutable email and PDF content of a quote across delayed delivery
and deployment changes, while keeping percentage discounts mathematically clear
when STC, VEEC or other rebate lines are negative.

### Implemented scope

- Record the email renderer revision on every durable quote-delivery row.
  Existing rows use frozen revision 1 and newly issued rows use revision 2.
- Rebuild delayed and manually retried email with the stored or inherited
  renderer revision, then verify subject, recipient, email hash, PDF filename
  and PDF hash before any provider request. Unknown revisions fail closed.
- Keep one final percentage-discount control outside line-item ordering. Apply
  it after net included lines, including negative rebate lines and fixed-dollar
  discounts. Exclude optional and choose-one rows from its base.
- Keep confirmation inside the sticky submit footer so it stays beside the send
  action throughout PDF review.
- Open a staged progress modal immediately after `Create job and quote`, with
  clear customer, job, accepted-detail and file-transfer phases during the
  roughly ten-second handoff.

### Incident and release evidence

- Quote `Q-TLJ-X4LMAQXU`, delivery
  `66499ae8-f1a7-406b-befb-4cebca78ed7c`, was queued under version 324. No cron
  invocation was available to drain it.
- Version 325 health-route draining attempted delivery but correctly stopped
  before Resend with `QUOTE_DELIVERY_CONTENT_CHANGED`: its new renderer did not
  reproduce the older row's stored integrity hash. This was an integrity guard,
  not provider acceptance or Gmail loss.
- Version 326 supplies frozen v1 and current v2 renderers. The third automatic
  attempt used renderer revision 1 without changing the immutable email or PDF
  hashes. Provider acceptance occurred at `2026-08-13T04:49:50.861Z` with
  message ID `bcee0035-743e-4795-acb0-7512b731e740`; callbacks recorded sent at
  `2026-08-13T04:49:56.651Z` and delivered at `2026-08-13T04:50:00.168Z` with
  provider status `email.delivered`. The exact row is now `delivered`, attempts
  equal 3, and failure, error, retry and lease state is cleared. Visible Gmail
  inbox placement remains unverified and is not claimed.
- Focused quote, delivery, PDF, discount and migration-inventory coverage,
  typecheck, warning-free lint, all 138 migrations, production build with Sites
  bundle audit and `git diff --check` passed.
- Raw unfiltered `npm test` is not represented as passing. Its known failures
  and cancellations remain confined to the preserved unrelated
  `test/trade-field-evidence-finalisation.test.mjs`, SHA-256
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.

## Previous released milestone: TLINK-QUOTE-DELIVERY-WORKFLOW-62

Version 325 used exact application source
`37a4faf2e9cbbc6eee5ffdf007366d7944152761` and saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_4815104beb548191a5f747deee51c8b7`.
Its deployment succeeded on provider `info294029--aea-energy-comparison` with
environment revision 20; the deployment ID was not retained. Sites stored 420
files and 39,823,360 bytes with content hash
`sha256:a9df49e58bcd5462037cfc2ec37b8eaaef38612d9aa447d57de2a1fabbd0646f`.
The release added exact-delivery request draining, a bounded health-route drain,
the final percentage-discount control, sticky-footer consent and the staged
lead-to-job progress modal. Its live drain exposed the historical renderer
integrity mismatch and stopped safely before the provider.

## Previous released milestone: TLINK-QUOTE-EDITOR-DELIVERY-CORRECTION-61

Release status: exact executable application commit
`c12fa0613901aa7cb4c1c2167b0e4720e57b0900` is validated, pushed to GitHub and
Sites internal `main`, and released as historical Sites version 324 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_c3f6022a453c8191a29d5e356267d7bc`
and deployment `appgdep_6a7d2c7a471c819192d6390b0d59e9fc` reconcile to that
source. Deployment succeeded on provider `info294029--aea-energy-comparison`
with environment revision 20. Sites stored 420 files from a 39,761,920-byte
archive with content hash
`sha256:18b106a2a7edb790229f2a947b3ec47b52864aab53b81fc2e1f46973adb18e7d`;
the package contains all 137 migrations.

### Outcome

Make quote creation easy to correct and reorder, make the customer editor clear,
and repair the two production database binding defects that prevented quote
issue from durably queuing customer email.

### Implemented scope

- The customer editor shows the primary name, contact details and address once.
  Secondary contacts, sites, linked jobs, assets and history use bounded
  progressive disclosure, and every editable control remains visible and
  consistently formatted.
- Every normal and choice quote row has its own `Price book item` selector.
  Selecting an item fills its current description, type, price and GST together;
  selecting `Custom line` clears the authoritative item reference and keeps a
  random line editable.
- Percentage and fixed-dollar discounts are independent repeatable rows with
  editable customer-facing labels, so STC, VEEC, referral and sale adjustments
  can remain separate. The authoritative calculation prevents total discount
  from exceeding the positive included scope and reduces GST proportionally.
- Normal rows, choice rows and discount rows support desktop drag-and-drop plus
  44-pixel `Up` and `Down` controls for touch, keyboard and mobile use. The full
  line object moves, saved positions persist and the issued PDF preserves the
  exact authored A/B/A order instead of regrouping by section.
- Quote consent is visible above the preview. `Review quote PDF` scrolls to and
  focuses the generated PDF, while sending, accepted, delivered and attention
  states remain visible with their request reference.
- The production issue failure was caused by two D1 binding-count defects in the
  atomic issue batch: the issued-event statement bound an extra quote-version ID,
  and the delivery-outbox insert omitted one timestamp binding. Both are fixed.
  The route now reports queued success only after the immutable version, event,
  secure link, PDF and non-null durable delivery row commit together.

### Validation and release evidence

- Focused integrated customer, quote, PDF, reorder and delivery coverage passed
  83 of 83. The combined quote and delivery set passed 89 of 89, and price-book
  coverage passed 7 of 7.
- Typecheck, warning-free lint, `db:check` across all 137 migrations, production
  build with Sites server-bundle audit and `git diff --check` passed.
- Raw unfiltered `npm test` reported 2,134 total: 2,110 passed, 7 failed, 7
  cancelled and 10 skipped. Every failure and cancellation is confined to the
  preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
  SHA-256 remains
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
- `/api/health` returned HTTP 200 at `2026-08-13T02:32:28.712Z`.
- Signed-in production QA opened job `TLJ-X23Z3GL9`. Overview and customer
  details were visible. Draft version 1 loaded three quote rows and three
  customer-shared photos; each row exposed `Custom line`, the three saved items
  and `Labour`, plus enabled Drag and bounded Up/Down controls. Totals remained
  `$4,700` excluding GST, `$470` GST and `$5,170` including GST.
- Preview opened the real delivery dialog with consent at the top. `Review quote
  PDF` was operable and the PDF showed the same three items and totals. Consent
  was not checked, Confirm and submit was not pressed, and the temporary UI state
  was discarded by returning to edit and reloading. No controlled live email was
  sent or received and no provider callback was reconciled.

## Previous released milestone: TLINK-QUOTE-JOB-INVOICE-USABILITY-60

Release status: exact executable application commit
`e757ac2402da0830b68d0e50e95afd61281c03c0` is validated, pushed to GitHub and
Sites internal `main`, and released as historical Sites version 323 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_2b0ec0ac2ba881918f97c0bc77756ca3`
and deployment `appgdep_6a7d163a7a608191ab3e260ed58f63a3` reconcile to that
source. Deployment succeeded on provider `info294029--aea-energy-comparison`
with environment revision 20. Sites stored 420 files with archive content hash
`sha256:e3d9ba2384f9442bce46646b36db3af857287481333097aa4c10eb8d45bc7522`;
the source package contains all 137 migrations.

### Outcome

Keep quoting usable when a saved row is incomplete, put the customer and job
information needed for daily work in one clear workspace, simplify assignment,
and let staff correct draft invoice order without re-entering line items.

### Implemented scope

- An incomplete saved quote row no longer collapses all totals to `Check items`
  or makes Preview appear inert. Validation identifies the exact row and missing
  field, highlights it, scrolls it into view and moves focus there. Quote-choice
  validation uses the same bounded authoritative choice contract before preview.
- A valid quote keeps live subtotal, GST, discount, total, cost, sell and margin
  calculations. Preview remains a non-sending step and opens the exact email and
  PDF review for a valid draft.
- Jobs Actions includes permission-gated `Edit customer` for linked customers
  the trade owns. It opens the existing customer editor and update boundary;
  platform-private references remain protected and non-editable.
- The job Overview presents separate structured job and customer information,
  including name, phone, email and address components, status, assignment and
  schedule. This is bounded operating alignment with Creditex and Dataforce, not
  a claim that their distinct compliance and installer roles are identical.
- Assignment uses one capability-filtered active-team dropdown plus one compact
  Save action. The competing search and load-more controls are removed from the
  assignment surface.
- Correctable draft invoices support desktop drag-and-drop and 44-pixel up/down
  controls for touch and keyboard use. Reordering preserves every line value and
  flows through the existing correction revision; issued invoice history remains
  immutable.

### Validation and release evidence

- The affected quote, jobs, invoice and team set passed 92 of 92. An independent
  final review passed 106 of 106 relevant tests.
- Typecheck, warning-free lint, `db:check` across all 137 migrations, production
  build with Sites server-bundle audit and `git diff --check` passed.
- Signed-in production QA reproduced the saved blank quote-description defect,
  then confirmed the exact invalid field was identified and focused. A valid
  `$110` quote opened the exact email and PDF preview. It was not saved or sent.
- Signed-in QA inspected the jobs register, customer editor, structured job and
  customer details, and the single-dropdown assignment surface without saving a
  customer or assignment change.
- The production invoice list loaded. No correctable draft invoice existed in
  the available working-demo data, so live rendering and interaction of the new
  reorder controls remain unverified; source regression coverage passed.
- `/api/health` returned HTTP 200 at `2026-08-13T00:57:08.421Z`.

## Previous released milestone: TLINK-RELIABLE-QUOTES-JOBS-59

Release status: exact executable application commit
`d15ceda44255a706c10a699347b9bd54eba60c5e` is validated, pushed to GitHub and
Sites internal `main`, and released as historical Sites version 322 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_a8e54fbf4cac81919d1167626542cc2c`
and deployment `appgdep_6a7d06e32e9c8191ae98c3b875564465` reconcile to that
source. Deployment succeeded on provider
`https://aea-energy-comparison.info294029.chatgpt.site` with environment revision
20. Sites stored 420 files and 39,669,760 bytes with content hash
`sha256:87b51cd53dcc3def0962c6c3c7f3bfaee4e4acf1a0b9819392dd642880ad5a7b`.

### Outcome

Make quote pricing immediately understandable, make quote delivery durable and
truthful when a provider fails, and give trade businesses one dense jobs register
that exposes the fields and actions needed for daily operation.

### Implemented scope

- The quote editor has explicit percentage and dollar discount actions. Each
  overall discount has editable customer-facing details for labels such as a
  sale, referral credit or certificate value.
- Quote lines and totals update live from one authoritative calculation. The
  editor shows subtotal excluding GST, GST, discount including GST, total
  including GST, internal cost, sell value and margin. A fixed discount cannot
  reduce the quote below zero.
- Issuing a quote atomically records the immutable issued version, secure link,
  PDF and durable delivery outbox before the browser receives success. A lost
  browser response replays the same version without sending a duplicate.
- Delivery processing uses a compare-and-set lease, provider idempotency and at
  most five automatic attempts. The customer-facing states are exactly
  `Sending`, `Email accepted for delivery`, `Delivered` and `Needs attention`.
  One manual retry creates an immutable successor delivery rather than mutating
  the failed attempt. Complaints and opt-outs remain suppressed.
- Jobs is a dense configurable register with separate Job ID, first name, last
  name, phone, email, street address, postcode, suburb, state, assigned worker,
  schedule, status, quote total excluding GST and certificate-bucket columns.
  Server-side filters, sorting, paging and saved column choices remain
  tenant-bound. Right-click, keyboard and visible Actions controls open the same
  view, edit, assign and schedule operations.
- Job status follows the controlled precedence `Cancelled`, `Certified`,
  `Audited`, `Complete`, `Assigned`, `Quoting`. Certificate buckets remain
  `Pending` with a zero count until an authoritative program source exists.
- Additive migration `0136_trade_quote_delivery_outbox.sql` extends the packaged
  inventory to 137 migrations and owns the durable quote-delivery ledger.

### Validation and release evidence

- The integrated quote-delivery, discount, live-total and jobs-register set
  passed 102 of 102. The broad stale-repair set passed 80 of 80 and integration
  passed 36 of 36.
- Typecheck, warning-free lint, `db:check` across all 137 migrations, production
  build, Sites server-bundle audit, `git diff --check` and the customer-plan PDF
  audit passed.
- Raw unfiltered `npm test` reported 2,114 total: 2,090 passed, 7 failed, 7
  cancelled and 10 skipped. Every failure and cancellation is confined to the
  preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
  SHA-256 remains
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
- Signed-in production QA opened existing job `TLJ-X23Z3GL9`. Jobs showed rows 1
  through 13 of 13, the requested separate columns and zero page-level horizontal
  overflow. The first quoted job showed `$4,700` excluding GST.
- Quote lines `$200`, `$3,500` and `$1,000` rendered a live `$4,700` subtotal
  excluding GST, `$470` GST, `$5,170` total, `$3,191` cost and `$1,509` margin.
  Both discount actions were visible. A temporary 10 percent discount changed
  the subtotal to `$4,230`, GST to `$423`, discount including GST to `$517` and
  total to `$4,653`; it was removed without saving.
- Release QA did not issue, send or retry a quote and did not prove provider inbox
  receipt. `/api/health` returned HTTP 200 at
  `2026-08-12T23:57:03.130Z`.

## Previous released milestone: TLINK-TEAM-ONE-CLICK-QUOTE-58

Release status: exact repair and executable application commit
`523b517c4027ef72f2b267c95ae8c36fd26af92d` is validated, pushed to GitHub and
Sites internal `main`, and released as historical Sites version 321 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_e6fdbb289b9081918f4eaeb2167d71bf`
and deployment `appgdep_6a7c9aa092088191896d869614891e2f` reconcile to that
source. Deployment succeeded on provider
`https://aea-energy-comparison.info294029.chatgpt.site` with environment revision
20. Sites stored 412 files and 39,546,880 bytes with content hash
`sha256:a071cd89ac2137ff5877943785decf00cdefa983056c9d029226e21fbc086424`.

Historical Sites version 320 used application source
`732f096ca5a8d606cf616ae7ec323ae9d2ce66b7`, saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_6f8fcc323a708191b385cbb4384d7f2b`
and deployment `appgdep_6a7c85c3787c8191b79ee717958643c6`. It succeeded and
remained public until version 321 replaced it.

Historical Sites version 319 used application source
`9bc981227e258dffb036a1ddf9acd6ad9117b72a`, saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_f56d55c000988191a5d215afbe9f64c8`
and deployment `appgdep_6a7c7a96fe2c8191be72871005057712`. Deployment failed
before activation with `incomplete input: SQLITE_ERROR`, returned a null URL and
left Sites version 318 live until version 320 succeeded.

### Outcome

Give growing trade businesses a complete, uncluttered Team workspace and make one
Interested action create the company-owned job, quote and canonical job Files
needed to start work immediately.

### Implemented scope

- Team is a first-class workspace with owner-governed access permissions, a dense
  roster with separate first name, last name, phone and email columns, clear Open
  actions, device inventory, saved permission presets, active and inactive
  lifecycle history, immediate access revocation and retained records.
- Add-member contact fields are aligned. The phone control strips letters in the
  client, and the server rejects non-phone characters before Australian
  normalisation.
- Team member files are deliberately generic documents or photos with a title and
  optional expiry date. The replaced licence and credential form is removed.
  Active documents due within 30 days create permission-scoped drawer warnings
  and durable, idempotent owner-email work without sending during release QA.
- Each active team member has an allowlisted schedule colour. Availability can be
  maintained by the member for themselves and by an owner or delegated team
  manager for staff, without widening job or appointment visibility.
- Job, quote, customer, schedule, reports, price book, discount, evidence and team
  administration permissions support own-work and team-work boundaries. Only the
  owner can close the business account.
- One Interested action atomically creates or replays that exact company's
  customer, primary contact, service site, numbered job and draft quote, then
  opens the quote workspace. Every company accepting the same marketplace lead
  receives its own tenant-owned IDs, records, media objects and replay boundary.
- Production version 320 exposed the exact failure before mutation: the D1
  Interested preflight used a seven-term compound `SELECT`, above the production
  limit of five terms. Version 321 replaces it with one non-compound
  `SELECT 1 WHERE EXISTS(...) OR ...` preflight while retaining the all-or-nothing
  tenant-owned workflow.
- Every customer-selected quote photo is copied into the accepting company's
  canonical job Files before success is returned. The accepted contact, scope,
  answers and copied photos remain available after the source lead is withdrawn,
  expires or is removed.
- Missing accepted CRM first and last names are persisted independently as
  `Redacted`, so the composed display is `Redacted Redacted` when both are
  unavailable. The immutable accepted-disclosure snapshot remains truthful and
  keeps undisclosed name fields blank until the company manually updates its CRM
  record.
- Additive migrations `0131_trade_team_permissions_and_member_files.sql`,
  `0132_public_lead_accepted_disclosure.sql` and
  `0133_public_lead_job_files.sql` remain deployed. Migrations
  `0134_team_member_documents_and_colours.sql` and
  `0135_team_document_expiry_warnings.sql` extend the packaged inventory to 136
  migrations. Sites-incompatible trigger bodies remain installed and verified at
  runtime from exact complete statements.

### Validation and release evidence

- Product-focused Team coverage passed 67 of 67, bounded schedule coverage passed
  34 of 34, lead and expiry coverage passed 35 of 35, integration passed 36 of
  36, and independent audit coverage passed 68 of 68.
- Typecheck, warning-free lint, `db:check` across all 136 migrations, production
  build, Sites server-bundle audit, `git diff --check` and the customer-plan PDF
  audit passed.
- Raw unfiltered `npm test` reported 2,066 total: 2,042 passed, 7 failed, 7
  cancelled and 10 skipped. Every failure and cancellation is confined to the
  preserved unrelated `test/trade-field-evidence-finalisation.test.mjs`, whose
  stale mock and source-location expectations were not edited. It retains SHA-256
  `6E972EED70B34832B314C32D59B27C72296AC5C0D5A7BCA378733B115A819EA6`.
- Signed-in production QA reloaded the pictured existing lead. `Create job and
  quote` was present and enabled, and the prior workflow-preparation error was
  absent. The Team workspace showed aligned separate first-name, last-name,
  phone, email, status, colour and action columns, bordered `Open` actions and
  no `More` text. The add-member contact fields were equal-height, equal-width
  aligned pairs, and entering `abc0412def345678` into the telephone field left
  `0412345678`. The document vault exposed only title, optional expiry and one
  PDF/JPEG/PNG file input. The colour palette and self/team availability choices
  were visible; this account had no appointments, so appointment colour rendering
  was not observed live.
- Release QA did not click Interested on the live lead, upload a member document,
  mutate availability, send a quote, send a document-expiry email or send any
  other live email. `/api/health` returned HTTP 200 and the 20-minute Sites Worker
  errors-only query returned zero events after inspection.

## Previous released milestone: AEA-DURABLE-PUBLIC-LEAD-QUOTE-57

Release status: exact application commit
`621797579ea1f2249e8679b26056066a4c824668` is validated, pushed to GitHub and
Sites internal `main`, and was released as historical Sites version 318 at
`https://compare.ausenergyassessments.com`. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_b10013e775f481919c719d4f00f2260e`
and deployment `appgdep_6a7c2aece3248191abf36ae69cdb2095` reconcile to that
source. Deployment succeeded on provider `info294029--aea-energy-comparison` at
`2026-08-12T08:12:48.019629Z` with environment revision 20.

### Outcome

Make the first public enquiry attempt durable before returning success, deliver
the customer plan and internal review independently after acceptance, replace
the false lead-delivery timeout monitor with a read-only readiness check, let a
matched trade inspect quote photos without downloads and open a prefilled quote
workflow directly from Interest.

### Implemented scope

- The prior first-attempt failure was caused by cold PDF and font generation
  followed by a synchronous Google Apps Script relay inside the public request.
  That work exceeded the request budget and aborted before the customer could
  trust the result.
- The public request now records canonical intake in D1 and R2 plus independent
  customer-email and internal-review outboxes before returning HTTP 200 with a
  truthful queued delivery state. PDF generation, Resend customer delivery and
  Google Apps Script internal review happen asynchronously with durable retries.
- The operational lead check is a signed, read-only readiness probe over the D1
  schema and indexes, R2 capability and provider configuration presence. It does
  not call the external relay, create a lead, send email or claim provider inbox
  delivery.
- Clicking an authorised quote-photo thumbnail opens the whole protected image
  in a focus-contained lightbox. X, backdrop and Escape close it and object URLs
  are revoked after use.
- Interest creates or reuses a deterministic pseudonymous CRM customer, contact,
  site, job and draft quote, then opens the prefilled quote editor. Issue and
  send remain explicit. Current recipient and access are checked at each new
  issue or send, and an issued customer PDF and secure link are immutable. Per
  the product-owner decision, no withdraw-or-change workflow was added after
  issue.
- Additive migrations `0129_public_plan_delivery_outboxes.sql` and
  `0130_trade_issued_document_cleanup.sql` extend the packaged inventory to 131
  migrations.
- The existing Google Apps Script project and deployment ID
  `AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW`
  were updated in place to version 15 at 12 August 2026 18:10 with description
  `durable public-plan delivery and read-only readiness monitoring`. The hosted
  relay source exactly matches SHA-256
  `8afa2f66415f30c1220509585935f4167a43a3d2b3170f70fcb0fc943b851be2`.

### Validation and release evidence

- `npm.cmd run validate` passed with typecheck, warning-free lint, 36 integration
  tests, 1,980 total tests with 1,970 passed, 10 intentional skips and 0 failures,
  all 131 migrations, the 24-page customer-plan PDF audit, production build and
  Sites bundle audit. `git diff --check` passed.
- Focused quote and photo coverage passed 123 of 123, durable lead and email
  coverage passed 38 of 38, monitor coverage passed 29 of 29, and the broader
  regression set passed 85 of 85.
- The custom-domain health route, plan and trade dashboard returned HTTP 200.
  The 15-minute post-release Worker error query returned zero events.
- No synthetic production lead, customer email or quote was sent. The first real
  post-release customer and matched-trade delivery remains the explicit runtime
  proof gap.

## Previous released milestone: AEA-LEAD-SUBMISSION-SERVICE-CALCULATOR-56

Status: exact executable application commit
`e01d7fc8eb80292ddfb019366355293c1103c5fe` is pushed to
`origin/codex/sites-custom-domain-migration` and Sites internal `main`, and was
released as historical Sites version 317. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_524c3bf7b99c81918281002a6aaf9aca`
and deployment `appgdep_6a7bf11b64a8819187ab2155e60906ad` reconcile to that
source. Deployment succeeded at `2026-08-12T04:06:57.633776Z` with environment
revision 20 at `https://compare.ausenergyassessments.com`.

### Outcome

Keep customers on the enquiry while photos and the lead are being submitted,
make reused plan facts readable, route one canonical 12-service lead through the
trade email and CRM workflow, and simplify the current Activity 46 estimate
without exposing private commercial data provenance.

### Implemented scope

- Reused plan facts render as readable label and value cards in two desktop
  columns and one narrow-screen column instead of collapsing into one-word lines.
- Submit opens an immediate modal before the lead request. Focus stays in the
  modal, backdrop and Escape cannot dismiss it, document scrolling is locked and
  departure receives the browser warning while lead creation or photo upload is
  in progress. Determinate stages cover the base lead and each selected photo.
- A failed photo upload can retry only the remaining photos without resubmitting
  the lead. Skipping remaining photos requires confirmation. Completion then
  focuses the existing four-option electricity, gas, rebate and plan gateway.
- One canonical catalogue now owns 12 customer and trade services, including
  `electric-cooking` as `Electric cooking and cooktops`. Public lead validation,
  any-selected matching, mandatory trade email, CRM, notification, job and work
  paths use the same values. A business owner can change the capabilities used
  for future leads without rewriting existing opportunities.
- Trade lead email retains the mandatory durable delivery and privacy checks but
  now uses deterministic escaped TLink-branded HTML with a plain-text fallback.
- The public certificate-price response and calculator client no longer expose
  a commercial source name or link. Gross estimates remain available for all
  supported certificate types only while the latest price data is current.
- Activity 46 uses purchase date for its rule boundary. Purchases from 30 June
  2026 use the current simple built-in or freestanding scenario, A$200 minimum
  payment and 1.5 reduction rounded to 2 VEECs. Purchases from 14 April through
  29 June 2026 retain the exact legacy listed-product path. Earlier history fails
  closed until the exact rule versions are added.

### Validation and release evidence

- Full implementation commit `1e7a835a2b0f967b725a9a6400ec5872fbf7cbf1`
  was saved as historical intermediate Sites version 316 under
  `appgprj_6a550c378000819185caf094173422bb~appgver_005cf69ce1ac8191a068af6e69c22c68`
  and deployed through `appgdep_6a7bef81996c8191951f013dce24d698`.
- Version 317 adds only the final calculator footer correction from `selected
  installation date` to `selected activity date`. Sites stored 397 files and
  39,034,880 bytes with content hash
  `sha256:17d143da5104ac5231b50aac712b46c280b4f1af8b963d17f7786426e17364dc`
  and all 129 migrations.
- Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
  1,946 total tests with 1,936 passed, 10 intentional skips and 0 failures,
  `db:check` across all 129 migrations, the customer-plan PDF audit, production
  build and Sites bundle audit. `git diff --check` passed. The final static copy
  correction then passed typecheck, lint, production build and the Sites bundle
  audit.
- Independent review returned GO with no P0 or P1 finding. The focused risk set
  passed 135 of 135.
- Live `/api/health` and `/api/certificate-prices` returned HTTP 200. The public
  price response contains no `sourceName` or `sourceUrl`. Live plan inspection
  confirmed readable reused-fact cards, and live Activity 46 inspection confirmed
  purchase date, current scenario choices and no obsolete product picker.
- No real lead or trade email was submitted during version-317 QA. The upload
  modal and navigation protections are verified by source and regression tests,
  not by a production submission.

## Previous released milestone: AEA-PRACTICAL-PLAN-TRADE-EMAIL-QUOTE-PREP-55

Status: exact executable application commit
`ec7cfe49b3d43ae44756cd4ed77924229dd28a3a` is pushed to
`origin/codex/sites-custom-domain-migration` and Sites internal `main`, and was
released as historical Sites version 315. Saved version
`appgprj_6a550c378000819185caf094173422bb~appgver_e55118f62f488191b616250cd819863d`
and deployment `appgdep_6a7b42f0ec288191b1c79b062233cf81` reconcile to that
source. Deployment succeeded on provider `info294029--aea-energy-comparison` at
`2026-08-11T15:42:54.685549Z` with environment revision 20.

### Outcome

Make a public plan enquiry useful enough for a desktop quote, guarantee one
durable email delivery for every active approved matched trade, and give the
customer the same practical plain-language plan in email and the post-submit
gateway without weakening privacy or requiring an account.

### Implemented scope

- Each active approved trade match must own one unique durable notification
  delivery before lead matching is reported as successful. Exact opportunity
  batches drain after a lead request and from health, signed-in trade polling and
  the minute scheduler. Provider failures retain the delivery and retry after 5
  minutes, 30 minutes, 2 hours, 4 hours, 8 hours, 16 hours and then daily until
  accepted, withdrawn or no longer eligible.
- The public-plan notification path does not depend on an optional account email
  preference. Every send still rechecks current platform approval, consent,
  matching service and service area, current email, opportunity and match state,
  suppression and idempotency.
- Email attachment and post-submit gateway download use one canonical customer
  PDF generator. For the same plan inputs they are byte-identical. The audited
  fixture is a tagged 24-page report with embedded fonts, semantic lists, 48
  checked links and no active content.
- Practical plan actions use plain-language immediate, better and long-term
  choices across draughts, moisture, ventilation, glazing, shading, heating,
  cooling, hot water, cooking, solar, batteries, electric vehicles and
  assessment preparation. Gas replacement advice is conditional and recommends
  efficient affordable electric alternatives without claiming product or savings
  outcomes.
- The enquiry offers optional three-to-four-question preparation packs for all
  11 services, deduplicates only genuinely shared questions and lets the customer
  explicitly reuse known private plan facts. Mobile and desktop photo controls
  request service-relevant JPEG or PNG images without making answers or photos a
  condition of the base lead.
- The final enquiry is open by default and reuses known switchboard, roof,
  hot-water, insulation, solar and multi-system heating facts instead of asking
  for them again. The representative nine-service path fell from 19 questions to
  three, the all-service path has at most five, and one selected service has one
  or two. The summary keeps reverse-cycle air conditioning, gas ducted or space
  heating and evaporative cooling together. Wide whole-appliance and work-area
  photos are requested before labels; safe full-switchboard and inverter views
  remain useful.
- The certificate estimator uses a concise one-or-two-system quantity control,
  assumes zero prior VEU-funded water heaters for the public estimate while
  reserving final history checks for the accredited provider, combines raw
  reductions within one prescribed activity before the final whole-certificate
  rounding, and shows a current gross AUD value for supported certificate types.
  Stale or missing price data fails closed and any changed input clears the prior
  certificate and dollar result.
- Private quote answers and stripped photo derivatives are stored in D1 and R2,
  never exposed through a public URL or email attachment, and are available only
  to exact active matches for the relevant selected service. Withdrawal blocks
  access immediately; bounded tombstone cleanup removes retained R2 objects after
  failure or withdrawal.
- Additive migration `0128_public_plan_quote_preparation.sql` owns the quote-pack
  answers, files, grants, withdrawal and cleanup state. The packaged inventory is
  all 129 migrations through `0128`.
- The mobile enquiry surface has corrected horizontal padding and retains its
  readable, no-overflow one-column layout.

### Validation and release evidence

- Historical Sites version 311 was saved from exact milestone source
  `ceac4486531995a11a566d224b6638c0678fb3d4` as
  `appgprj_6a550c378000819185caf094173422bb~appgver_59994c1e46e88191b01a512cbf0e1561`.
  Its exact 393-file, 38,963,200-byte archive has content hash
  `sha256:8e92e79fcf36f499aa58beab765420a8483a99a0b47412e9a2c222938bd0d832`.
  The deployment ID was not retained in this handover.
- Historical Sites version 312 from exact compatibility hotfix
  `33e9c3e11cf933ea4e752f21781f66f6ec8c2c37` added exact stored version-4,
  version-6 and version-7 contact-release validation and recovered zero-attempt
  terminal consent skips. Saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_922f83ef18c881918992e00a6d98df96`
  deployed through `appgdep_6a7b13c66a6c819184d327dfda5cfcfc`, but production
  D1 rejected the deep final claim with expression depth 100.
- Historical Sites version 313 from
  `bf26fb818773ba3405da9aadae247427426da1bb` kept complete stored-release
  validation before claim and used a shallow exact-pair predicate in the atomic
  D1 claim.
- Historical Sites version 314 from customer enquiry and calculator commit
  `c1a62944078ace043b68bb23a37e924d3e91fefc` was saved as
  `appgprj_6a550c378000819185caf094173422bb~appgver_a3a30ab242c0819184e4ec846fa5ef2c`
  and deployed through `appgdep_6a7b30ccbc348191833216f9b4b41c02`. Live plan
  and calculator checks passed, including multi-system heating retention,
  streamlined quote preparation, input-result invalidation and a current gross
  certificate value, but the signed-in Leads GET still returned HTTP 500. Version
  314 is an intermediate release, not the current verified lead-workspace state.
- Version 315 splits the trade-opportunity read into one atomic D1 batch of nine
  bounded statements. The maximum conservative query budget is 54 against the
  live limit of 100, no statement uses more than five joins, and the base read
  returns a deterministic ordered set capped at 100. Exact-match, project-consent,
  public-release, withdrawal, contact, quote and arrival guards remain fail-closed.
- Final `npm.cmd run validate` passed typecheck, warning-free full lint, 1,936
  total tests with 1,926 passed, 10 intentional skips and 0 failures, `db:check`
  across all 129 migrations, the customer-plan PDF audit, production build and
  Sites bundle audit. `git diff --check` passed.
- The audited canonical PDF has 24 tagged pages, embedded fonts, semantic lists,
  48 checked links and no active content. Email attachment and gateway download
  remain byte-identical for the same inputs.
- Live desktop and 355-pixel mobile QA confirmed the quote-preparation pack,
  service-specific questions, camera or file controls, readable customer form
  and no horizontal document overflow. The deployed bundle contains the four-way
  customer next-step gateway. No new lead was submitted solely for visual QA.
- Live signed-in version-315 QA reloaded an existing expected match. The refresh,
  load and false-empty errors were absent, and the workspace showed 10 matching
  leads with the expected consented detail. The exact GET and safe UI reload
  succeeded and the post-check Worker
  errors-only query was empty. No mutating PATCH smoke was run and no lead status
  was changed.
- `/api/certificate-prices` remained current with `lastCheckedAt`
  `2026-08-11T14:00:46.718Z`; the latest AUD gross inputs were STC 39.65, ESC
  29.50, VEEC 82.25, PRC 2.80, LGC 8.00, ACCU 38.75 and SMC 38.40. The customer
  view labels these as gross before registration, audit, compliance, processing
  and other fees.
- Previously skipped delivery `bd53ebf192e525465b9026470b3ca5c5` was recovered
  exactly once and reached `delivered` through Resend provider message
  `a237b559-27c9-4ba1-a4f5-b9d4e582580f`, with `provider_accepted`, `email.sent`
  and `email.delivered` evidence. Current-version-7 control delivery
  `d8a7968ff3ff1e5fbad350ed8692796e` also reached `delivered` through provider
  message `e81bbf1b-5c32-40f6-8395-aa6141187712`.

## Previous released milestone: CREDITEX-VEU-REGISTRY-ROUNDING-LIMITS-54

Status: exact executable application commit
`481cb3970ffd0efe498c9fbf7c9ba5f6a7e945c7` is pushed to
`origin/codex/sites-custom-domain-migration` and Sites internal `main`, and is
released as Sites version 310 through deployment
`appgdep_6a7a78c959908191a2fbd39fc247dfc2` with environment revision 20 at
`https://compare.ausenergyassessments.com`.

### Outcome

Restore the fail-closed VEU approved-product picker, apply the statutory
rounding point to each separately eligible prescribed activity and enforce the
Schedule 4 water-heater premises-history limits before a quote estimate can be
returned.

### Released scope

- The missing fifth scheduled trigger was the VEU freshness failure. The VEU
  refresh now runs from the provisioned minute scheduler behind one 07:25
  Australia/Sydney daily gate. The 48-hour stale-data fail-closed boundary is
  retained.
- The current activated VEU Public Registry snapshot is
  `ce79c9dc-63e8-4c27-9f4e-ee7961b423ba`, refreshed
  `2026-08-11T00:09:32.316Z`, with 75,492 rows and source SHA-256
  `1fb51867a4de9b2ee306f1cc943c1444b6351b3b2c19ef3041f48c59cc3278b6`.
- Victorian Energy Efficiency Target Act 2007 section 18(1A) applies rounding
  to each separately eligible prescribed activity and rounds an exact half up.
  Two separately eligible 7.5-VEEC activities therefore return 16 VEECs, not
  15. Raw values are not combined before rounding.
- Victorian Energy Efficiency Target Regulations 2018 Authorised Version 020
  Schedule 4 limits prior plus current relevant water-heater products to two at
  residential premises from 10 June 2019 and five at non-residential premises
  from 31 May 2023. The calculator now requires a fail-closed prior-count answer
  and enforces the limit across identical and mixed models.
- Water Heating and Space Heating and Cooling Activity Guide version 3.20 keeps
  in-line additional-storage and manifold-connected systems outside the
  eligible estimate path.
- Certificate creation, submission, trading and settlement remain disabled. No
  certificate action occurred during release validation.

### Release and validation evidence

- Saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_328bc0ff50648191abfb6cd0b6aafed8`
  identifies exact executable commit
  `481cb3970ffd0efe498c9fbf7c9ba5f6a7e945c7`. Sites stored 392 files and
  38,727,680 bytes with content hash
  `sha256:c238b3125d74473df101491648c78308402fcbefc846d8ea72f95006a81864f3`.
  The package contains all 128 migrations.
- Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
  1,897 tests with 1,887 passed, 10 intentional skips and 0 failures,
  `db:check`, the customer-plan PDF audit, production build and Sites bundle
  audit. The focused combined set passed 80 of 80, the estimate-route set passed
  21 of 21 and independent review passed 104 of 104. `git diff --check` passed.
- Live `/api/health` returned HTTP 200. Activity 3C official-product search
  returned HTTP 200 with `ok: true`, 421 matches and first result AGM Energy
  `AGMHP270W`. Signed-in visual QA confirmed enabled brand and model pickers with
  no stale-registry error. The post-release Worker error query returned zero
  events.

## Previous released milestone: AEA-STRUCTURED-CUSTOMER-ENQUIRY-GATEWAY-53

Status: historical exact executable application commit
`ad972cf2f61aeb59f2021f56b3c908ddb3ace0a0` is pushed to
`origin/codex/sites-custom-domain-migration` and Sites internal `main`, and is
released as historical Sites version 308 through deployment
`appgdep_6a79e3700444819191ac709f0bd509c6` with environment revision 20 at
`https://compare.ausenergyassessments.com`. Sites version 308 is superseded by
historical versions 310, 317, 318, 320, 321, 322 and 323 and the current version
324 release.

### Outcome

Replace the narrow single-service enquiry with one readable, privacy-controlled
customer handoff that captures a searchable structured address, lets the
household request every relevant service, distributes the resulting lead to all
approved matching TLink trades and gives the customer an immediate four-way next
step without requiring a customer account.

### Released scope

- The public enquiry stores first and last name separately and captures postcode,
  exact suburb and state, street address and optional unit number. Postcode drives
  the available locality choices before street and unit details are entered.
- Customers can select any of the 11 available services or select all. The lead
  handoff targets every active platform-approved trade whose declared services
  and service area match the submitted request, without a six-trade cap.
- Australian Energy Assessments retains the complete address for its private CRM
  record. Email and postcode are shared for trade replies; the household controls
  whether trades also receive name, phone and street address.
- The customer-account prompt is absent from the public enquiry. A successful
  enquiry opens a native next-step gateway with exact actions for electricity
  comparison, gas comparison, the rebate calculator and the printable plan.
- The plan result next-step actions use light-mint buttons with dark text and
  full-width mobile layout so their labels remain readable in normal, hover and
  focus states.
- Additive migration `0127_public_trade_lead_customer_address.sql` adds split
  customer identity and structured-address custody while retaining the legacy
  combined-name field for a safe mixed-version deployment. The packaged and
  audited migration inventory is 128 migrations through `0127`.
- The exact committed Apps Script relay source was saved in the existing relay
  project and an update of the existing deployment to version 14 was initiated.
  A live signed lead-delivery probe for that hosted version remains unverified;
  no real customer lead was submitted during release QA.

### Release and validation evidence

- Saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_d5eaf4c6b458819187a105747dfc6075`
  identifies exact executable commit
  `ad972cf2f61aeb59f2021f56b3c908ddb3ace0a0`. Sites stored 392 files and
  38,696,960 bytes with content hash
  `sha256:881c057c42808490cc7d354c6c0e8a349a17fcb774e201d5cd302f9c7ed19e57`.
- The local 392-entry release package was 11,903,586 bytes with SHA-256
  `f9ce016769722f6b47d17107ec2d3d1ab0670a8afea3007a3ec5d0e117a859c8`
  and included all 128 migrations through additive `0127`.
- Final `npm.cmd run validate` passed typecheck, warning-free lint, integration,
  1,882 tests with 1,872 passed, 10 intentional skips and 0 failures,
  `db:check`, the customer-plan PDF audit, production build and Sites bundle
  audit.
- Live `/api/health` returned HTTP 200. Postcode `3000` resolved Melbourne, VIC;
  `0872` exposed the valid NT, SA and WA locality tuples; invalid `9999` returned
  the expected HTTP 400. The recent Worker outcome was clean apart from that
  deliberate 400 validation probe.
- Fresh production assets `HomeEnergyPlanner-BCCDCklm.js` and
  `HomeEnergyPlanner-DMhDf6y_.css` expose the split-name, structured-address,
  select-all multi-service and next-step gateway release. Live DOM QA confirmed
  first and last name, postcode to suburb/state to street/unit progression, all
  11 services, privacy toggles and no account prompt.
- The light-mint next-step actions were visually readable. Browser QA opened the
  native gateway with a temporary client-side successful-response mock, so no
  real lead was sent, and verified its four exact destinations and 390-pixel
  mobile layout.
- The authorised internal lead-webhook probe was not run because hosted secret
  values are redacted and no local test token exists. Hosted v14 lead delivery is
  unverified, not failed.

## Previous released milestone: AEA-COMPLETE-GUIDED-HOME-ENERGY-JOURNEY-52

Status: historical exact application commit
`6df3fab3c9eaca55445cf1c3f16e58b276aae6fd` is pushed to
`origin/codex/sites-custom-domain-migration`, `origin/main` and Sites internal
`main`, and released as Sites version 307 through deployment
`appgdep_6a79b1799b988191a1ac6ac58888e134` with environment revision 20 at
`https://compare.ausenergyassessments.com`. Sites version 306 from application
commit `c75ff7bb4355f2f74bc9996527900c3d515ab85e` is historical and superseded by
the v307 mobile-header hotfix.

### Outcome

Give households one complete, simple journey from a 38-screen home intake to a
personalised professional-quality plan, useful quick wins, clear enquiry and
account choices, guided electricity and gas comparison and an actionable report
without weakening privacy, calculation authority or the static trade workspace.

### Released scope

- The public planner asks one plain-English question per screen, preserves all
  supported answers through no-account enquiry, free-account handoff and print,
  and conditionally skips irrelevant questions without asking the household to
  enter unsafe roof, subfloor or electrical areas.
- Results include answer-specific Australian Government-aligned quick wins, an
  ordered roadmap, a no-account enquiry, a separate free-account path, printable
  plan and clear electricity, gas, calculator and rebate handoffs.
- Electricity and gas comparison use guided three-step journeys, keep NMI and
  interval data private, retain calculation and retailer checks and present one
  clear next action after results.
- Customer-facing copy spells out Australian Energy Assessments. The compact
  390-pixel header presents `Account` then the TLink logo without a separator dot
  or document overflow; the professional trade workspace remains static.
- The customer report uses
  `2026-08-10-professional-personalised-report-v5`, design contract
  `2026-08-10-professional-personalised-report-design-v4` and PDF contract
  `2026-08-10-personalised-plan-pdf-v7`. Its 18-page audited PDF is tagged, uses
  embedded fonts and contains 37 checked links.
- July 2026 NatHERS Existing Homes guidance and technical material and Australian
  Government quick-win sources are planning references only. The plan does not
  claim a NatHERS rating, assessment or endorsement.
- Google Apps Script relay version 13 keeps deployment ID
  `AKfycbxBjHL_I3aw0FsGkOVaUDic6AwW1W0ItuxadP1NF-0NolTwLahYnc9PsGpPAdv2tMqW`
  and the signed, exact-healthy delivery boundary. No real customer lead was
  submitted during release verification.

### Release and validation evidence

- Saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_cd22401f7e1c819197951851476ec4d8`
  identifies exact commit `6df3fab3c9eaca55445cf1c3f16e58b276aae6fd`.
  Sites stored 391 files and 37,744,640 bytes with content hash
  `sha256:77467b54e8262afe476a5f57460b15da11d5b5b6b286e9d54bbdfeda74c69806`
  under provider identity `info294029--aea-energy-comparison`.
- Historical v306 saved version
  `appgprj_6a550c378000819185caf094173422bb~appgver_60682607e5148191aa5351d3716bd9df`
  and deployment `appgdep_6a79aa88b3088191af653a395a2501a1` identify
  `c75ff7bb4355f2f74bc9996527900c3d515ab85e`; its 391-file, 37,744,640-byte
  package had content hash
  `sha256:61319a3fa5e852f5f8c9edbe8fe94a1508e612147a5252907d477e9da5084fd8`.
- Full validation passed with 1,859 tests passed, 10 intentionally skipped and 0
  failed, plus typecheck, warning-free lint, production build, all 127 migrations,
  the customer-plan PDF audit and Sites bundle audit. The v307 header correction
  then passed its focused 22 of 22 checks, typecheck, lint and production build.
- The signed version-13 operational monitor returned exact `healthy` with
  `site_runtime` HTTP 200 in 1,134 ms, `electricity_plans` HTTP 200 in 43,155 ms,
  `gas_plans` HTTP 200 in 15,840 ms and signed `lead_delivery` HTTP 200 in 2,588
  ms for probe `3d36c715-4904-4a1b-bde3-aa3e8253c74b`.
- Live v306 QA exercised desktop and 390-pixel planner progression across the 38
  screens, electricity and gas guided handoffs, full brand naming and no
  horizontal overflow. Live v307 QA confirmed the compact header shows Account
  then TLink with no separator dot and no horizontal overflow. `/api/health`
  returned HTTP 200 and the recent Sites Worker errors-only query was empty.

## Released milestone: AEA-PUBLIC-PERFORMANCE-RECOVERY-69

Remove continuous decorative rendering and oversized public assets from the home and planner, defer the full Surge workspace and postcode corpus until explicitly needed, use client navigation across the main household paths, enforce build-time performance budgets and close the work with desktop, phone and sustained-homepage release QA. This recovery stays within the existing visual, planner, assistant, API, privacy and data contracts.

Deployment source `bc71dda1fa5e79f4529c4ba408bd481a87a066ba`, containing performance implementation `bd27d65f98b80b673c5ffc9812b9bc92bd78f9a4`, passed complete validation and live desktop and phone QA and is deployed as public Sites version 370. Exact package and deployment evidence is recorded in release truth.

## Released milestone: AEA-PUBLIC-SURGE-UX-OPTIMISATION-71

Carry the preferred wide format through the public and customer platform, correct the stretched Surge intake controls, make every customer Surge entry open the complete `/surge` workspace and put the mascot-led command-centre treatment on the homepage without restoring the former expensive rendering stack.

Exact application commit `9c5e7199f3f9c521cf47510dafcf39cbe74d81f6` passed the full validation gate, was pushed to GitHub and Sites managed `main`, saved as Sites version 371 under `appgprj_6a550c378000819185caf094173422bb~appgver_4ce93839857c819180106e9800440d9e` and deployed publicly through `appgdep_6a883f07c4108191a8f1fcc7db68dba1` with environment revision 24. Desktop and 390 by 844 live QA confirmed the 1760-pixel shared shell, optimised 70,632-byte Surge homepage asset, full-page navigation, equal 46-pixel Step 11 fields and no horizontal overflow. Release truth contains exact archive and runtime evidence.

## Released milestone: AEA-SURGE-CONTINUITY-TYPOGRAPHY-72

Replace fragmented page-level typography with seven shared platform roles, make Surge service-request actions visually meaningful, keep question-and-answer turns chronological, retain completed home context across same-browser routes and tabs, and remove the redundant compact-header subtitle.

Exact application commit `9dc33106b51cb708837cbefa911ff1eaa3fa778d` passed the full validation gate, was pushed to GitHub and Sites managed `main`, saved as Sites version 372 under `appgprj_6a550c378000819185caf094173422bb~appgver_4a303cbf5afc8191bba9ec89b793fcd3` and deployed publicly through `appgdep_6a884b8fb4008191a62cea5d73058669` with environment revision 24. Desktop and 390 by 844 live QA confirmed the shared type scale, clear 48-pixel actions, correct conversation ordering, retained completion state and no horizontal overflow. Release truth contains exact archive and runtime evidence.

## Released milestone: AEA-SURGE-RESPONSIVE-QUICKCHAT-75

Restore the small floating mascot as a lazy in-place quick chat while keeping deliberate Surge links on the complete `/surge` workspace. On phones, collapse the long context rail and starter prompts behind compact native disclosures, remove the dedicated workspace's nested scroll trap, retain the compact platform typography and corners, and protect homepage copy contrast over the optimised mascot image.

Exact application commit `93458d308f2861286f2cde673a7f922c24201bac` passed the full validation gate, was pushed to GitHub and Sites managed `main`, saved as Sites version 375 under `appgprj_6a550c378000819185caf094173422bb~appgver_e3e5ced77f708191a734ca186c90c09f` and deployed publicly through `appgdep_6a885b22f07c8191af4887b6e6331ed9` with environment revision 24. Live desktop and 390 by 844 phone QA confirmed the popup/full-page navigation boundary, collapsed mobile context, page-level chat scrolling, preserved desktop context and HTTP 200 health. Versions 373 and 374 were superseded responsive-layout checkpoints contained in this release.

## Released milestone: AEA-SURGE-MOBILE-NAVIGATION-76

Make home-context editing self-revealing and restore the preferred compact horizontally swipeable phone header without regressing the collapsed Surge drawers, page-level chat scrolling or fixed desktop navigation.

Exact application commit `cec5d66422ff9fe140b7d160c4d7ced836d6b74f` passed the full validation gate, was pushed to GitHub and Sites managed `main`, saved as Sites version 376 under `appgprj_6a550c378000819185caf094173422bb~appgver_49ef85c0ba9c81919996c18fdb33939f` and deployed publicly through `appgdep_6a8861729c64819198b2e984832b3f06` with environment revision 24. Live 390 by 844 phone QA confirmed the 327-pixel header strip exposes 869 pixels of swipeable destinations without page overflow, the context drawer remains collapsed by default and an `Edit` action moves and focuses its matching intake form at 16 pixels from the viewport top. Desktop retained the eight-column navigation, and public health returned HTTP 200 with all 17 maintained topics and 109 current official sources ready.

## Released milestone: AEA-SURGE-CONTEXT-QUALITY-77

Keep the complete home context permanently visible on desktop while retaining the compact phone drawer, and make every save advance through the next unreviewed section until all 45 details are reviewed. Establish the requested Priority 1 freshness boundary across the 109-source official registry and the requested Priority 2 privacy-safe aggregate quality foundation without storing conversation content or customer identity.

Exact application commit `62b8f947731f8f9f313d3c6a2b8c4e4972d98c03` passed the full validation gate, was pushed to GitHub and Sites managed `main`, saved as Sites version 378 under `appgprj_6a550c378000819185caf094173422bb~appgver_37bca6308e5481918c3a2be69a2048c4` and deployed publicly through `appgdep_6a8871da825c8191926a9d71cca8f4df` with environment revision 24. Live desktop QA confirmed the rail is open and non-collapsible; sequential QA completed steps 1 through 13 and reached 45 of 45 reviewed; 390 by 844 QA confirmed the same rail remains a collapsed, tappable phone drawer. All 109 official sources carry volatility and reuse metadata, programme facts fail closed past the governed review date, and migration `0154_surge_conversation_quality_daily.sql` stores aggregate outcome counters only.

## Released milestone: AEA-SURGE-PRACTICAL-ASSESSOR-GUIDANCE-81

Remove the unsolicited account-copy card, API, server helper, component and persistence table. Keep home context private to the same browser. Expand deterministic early guidance with practical provider-neutral measures selected from the latest saved context, and make Surge qualify complex questions like an energy assessor by asking one highest-value question at a time until it has enough context for a reliable answer. Retain governed official-source and fail-closed controls for rebates, certificates, tariffs and eligibility. Prohibit em dashes and en dashes in generated customer conversation copy.

Exact application source `1b2509768bbca7947e3a01438da4c8814d20fe90` passed focused checks 110 of 110 and the full repository validation gate, including 36 integration tests, 2,851 repository tests with zero failures and 11 intentional skips, all 157 migrations, production build, Sites bundle audit and performance audit. It was pushed to GitHub and Sites managed `main`, saved as Sites version 390 under `appgprj_6a550c378000819185caf094173422bb~appgver_9c189c6e240c8191b5e3d98d97606065` and deployed publicly through `appgdep_6a89b86b8c048191bb5d187f9e972407` at environment revision 24. Fresh desktop QA confirmed the account controls are absent, current assets load without console errors and the workspace has no horizontal overflow.

Follow-on application source `0944c9b91765535b873b30029f545bde8f744831` adds generic grounded product and certificate guidance across the supported official registries. Exact STC quantities require an exact registered model and postcode; VEEC quantities require a governed scenario; current certificate market references fail closed when stale and explain why the customer discount is lower than the last trade value. Neutral product comparisons require exact verified specifications. The source passed 41 of 41 focused checks and the full repository validation gate, was pushed to GitHub and Sites managed `main`, and was deployed as Sites version 391 through `appgdep_6a8af0d5ca1081919f3c86b55f68a163`. Live desktop and phone QA passed with zero browser errors.

## Released milestone: AEA-SURGE-CONTEXT-GUIDANCE-CONTROLS-80

Recalculate saved-context guidance whenever the allowlisted profile changes so removed moisture or damp answers immediately remove moisture guidance. Complete the requested five follow-on controls with a bounded official review queue, a reviewed conversation-quality corpus and thresholds, aggregate-only continuity failure detection, measured surface-specific JavaScript graph budgets, and explicit signed-in save and deletion of an account context copy.

Exact application source `8d887f867269a157d84928fb553eac4951ed517b` passed the full validation gate and was pushed to GitHub and Sites managed `main`. Sites saved it as version 389 under `appgprj_6a550c378000819185caf094173422bb~appgver_dd2b493446408191b9b4b321d682d39b` and deployed it publicly through `appgdep_6a898f2b620c81918109cac63f954590` at environment revision 24. Live desktop QA confirmed 45 of 45 saved responses and no moisture advice after moisture was removed. Live phone QA confirmed compact secondary drawers, a visible composer and no horizontal overflow.

## Incorporated milestone: AEA-SURGE-GOVERNANCE-QUALITY-BUDGETS-82

Complete the requested five priorities with a fail-closed source-approval hash registry, a reviewed 20-case conversation corpus and aggregate quality gate, deterministic session continuity rehearsal, separate home, Surge, plan and calculator JavaScript and stylesheet graph budgets, and expanded practical-tip, product, certificate, brand-comparison and context-clarification regressions.

The foundation passed `npm.cmd run validate`, including all 36 integration tests, the complete repository suite, fresh D1 migrations through `0159_surge_conversation_quality_dimensions.sql`, customer-plan PDF audit, production build, Sites bundle audit and public performance budgets. Exact application source `7627d3ef7a28002b3b1b2cf6aebdbf76257683b7` was saved as Sites version 392 and then incorporated into the exact version 393 rental release source recorded above.

## Next five logical product steps

1. Reconcile the client service schedule against the governed question set, report wording, exclusions and completion rules without importing third-party branding or proprietary text.
2. Run a supervised end-to-end assessor rehearsal on a test property, including optional-module toggles, section recovery, evidence capture, issue, supersede and 60-day report access.
3. Add operational review screens for public rental requests so staff can triage, deduplicate, contact and deliberately convert an accepted request into a TLink job.
4. Keep the optional electrical, gas and smoke-alarm workflow available only in pre-launch/test-data mode; customer use and live launch remain gated on licensed-practitioner review of declaration wording and test logic.
5. Run physical Android and iOS field QA for offline job visibility, reconnection, large-photo upload, interrupted save recovery and issued-report viewing.

## Global stop conditions

Stop the affected work when:

- an action could expose or irreversibly alter production customer, trade or evidence data;
- complete export or restore evidence is unavailable;
- a provider, legal or industry decision requires an authorised human;
- an ABN review cannot be supported by an authoritative source;
- an access-control or tenant-boundary test fails;
- migration reconciliation has an unexplained variance;
- the release commit, artifact and deployment identity do not match;
- rollback cannot be completed inside the approved window;
- a public claim or regulated workflow lacks current authority.
