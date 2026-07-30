# AEA Energy and TLink forward roadmap

Status: current

Roadmap owner: product owner

Engineering owner: technical lead

Last reconciled: 30 July 2026

Baseline: [Complete current-state audit](./docs/audit/2026-07-21-complete-current-state/README.md)

## How this roadmap is used

The dated audit is the immutable evidence baseline. [Release truth](./docs/RELEASE_TRUTH.md) records the latest reconciled implementation and deployment state. The [next-task handover](./docs/HANDOVER_NEXT_TASK.md) contains one executable milestone. This roadmap contains only approved forward work and measurable gates.

Sequence is dependency based, not a calendar promise. A source change is not a release. A roadmap item is complete only when its required tests, release identity and runtime evidence are recorded.

## Product decisions

- TLink trade software costs A$0.
- Access is never granted by a payment, plan, seat, lead, job or quote state.
- A trade applicant must supply a checksum-valid Australian Business Number.
- A valid checksum is only an input check. An authorised reviewer must verify the business against an authoritative source before any trade workspace or trade API becomes available.
- Installer and supplier permissions remain role scoped. Licences, insurance, product evidence, privacy controls and jurisdiction rules remain separate approval gates where applicable.
- Household accounts remain free and private.
- Household planning remains independent, brand-agnostic and advisory. It is not represented as a NatHERS assessment, certificate, quote or savings guarantee.
- Household advice records owner or renter tenure separately from strata or common-property approval and supports several concurrent goals because authority, comfort, budget and upgrade sequencing can differ.
- TLink remains the authoritative trade record until an approved migration changes that boundary.
- Applied database migration history is immutable. Database change uses staged forward migrations: a compatible expansion before application activation, followed by a separately reconciled contract cleanup only after the new application is live.

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

## Next five logical product steps

1. **Real Outlook desktop and assistive-technology acceptance:** verify the delivered report in Outlook desktop's Word rendering engine and representative screen-reader and keyboard workflows using dedicated non-customer fixtures.
2. **Visible photo redaction and persistent resumable queue:** add customer-visible crop, blur, redaction or annotation controls and restore resumable upload state across a full page reload without exposing private evidence.
3. **Pan-Unicode PDF font coverage and fallback:** add approved font coverage or deterministic fallback for CJK, Arabic, Devanagari, Vietnamese and other supported customer scripts while retaining fail-before-save for anything still unsupported.
4. **Editable revision labels, notes and richer history sharing:** let customers name revisions, add bounded private context and share or export selected comparisons without broadening restore or installer-access scope.
5. **Pilot readiness telemetry and deferred field test:** define privacy-safe completion, upload, PDF, email and request telemetry, then run the household and experienced-assessor field test only when the product owner resumes the pilot.

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
