# AEA Energy and TLink forward roadmap

Status: current

Roadmap owner: product owner

Engineering owner: technical lead

Last reconciled: 1 August 2026

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

## Unreleased milestone: CREDITEX-COMPLIANCE-OPERATIONS-25

Status: release candidate in the working tree; final validation and release pending

### Outcome

Establish the first case-centred Creditex operations slice in TLink. An installer can link an exact governed activity and evidence-policy version to a guided job, the field app can preserve and upload the original evidence chain, and assigned Creditex users can triage, inspect, correct and dual-control the case without treating an estimate, export or local ledger entry as a regulator action.

### In scope

- Separate compliance organisations, verified invitation-only memberships and server-enforced administrator, case-manager, reviewer and auditor roles.
- Effective-dated programs, activities and evidence policies with distinct official code, specification part, product category and scenario fields, source SHA-256, exact case pinning and irreversible publication or withdrawal.
- Atomic job and case creation with category, jurisdiction and planned-date checks; participant abilities, equipment, assignments, tasks, findings and immutable case events.
- Requirement-led AEA Field capture of exact original bytes, SHA-256, capture and location envelope, registered-device provenance, encrypted offline queue, resumable upload and rejected-evidence supersession.
- A no-index Creditex portal with exception-led queues, bounded searches and filters, case workspace, evidence review, audited same-user evidence-view receipts, corrections, dual-control decisions, access administration and provider-neutral batch staging.
- Server-derived decision bases that pin the exact revision, rule and source hashes, canonical evidence digests, findings and any verified calculation run. A withdrawn policy remains available for correction and audit but blocks approval and staging.
- Data models and read-only portal projections for participants, abilities, equipment, calculators, batches, artifacts, responses, certificate lots, trades and settlements. External execution remains disabled.
- A controlled [Australian program source register](./docs/compliance/AUSTRALIAN_PROGRAM_SOURCE_REGISTER.md), [Creditex operating model](./docs/compliance/CREDITEX_OPERATING_MODEL.md) and [Dataforce and Runabout parity record](./docs/compliance/CREDITEX_DATAFORCE_PARITY.md).

### Excluded until later governed milestones

- Publication of any real activity or evidence policy before Creditex supplies and approves its private authority, evidence interpretation and current effective source pack.
- Unverified certificate or rebate calculations, customer price promises, registry submission, certificate creation, trading, settlement or manually asserted external responses.
- A live Dataforce or Runabout import, connector, cutover or retirement. Complete private parity remains blocked on authorised exports, field dictionaries, reports, formulas and a Runabout walkthrough.
- Production regulated cases. The production catalogue starts with no published activities or evidence policies and therefore cannot open a live claim.
- Approved retention, legal hold, backup, restore, real-device acceptance, regulator connector credentials or a broad Creditex team rollout.

### Acceptance gates

- Every active case pins an immutable published activity and complete evidence policy; withdrawn policies retain correction and audit access while approval and staging fail closed.
- The job, case and first event commit together or not at all, and child-record, assignment, evidence, batch and ledger tenant boundaries fail closed.
- Creditex access requires an email-verified exact Firebase identity, active organisation, active membership, allowed role and, for reviewer or auditor evidence, an active case assignment.
- An accept or reject action requires a recent same-user evidence-view receipt; the primary decision basis is generated on the server and cannot be replaced by a secondary reviewer or caller-authored JSON.
- Evidence completion, abort, expiry and device revocation races cannot delete the completion winner; original bytes and their server-verified hash are retained, and database guards block deletion of evidence-linked media.
- Auditors remain read-only, a final administrator cannot demote or suspend themself, and all governed writes and access events are immutable and organisation-scoped.
- The complete repository and mobile validation gates, independent final review, exact release provenance and public portal checks pass before this milestone is described as released.

The settled candidate passes 81 of 81 focused Creditex, governance, access, viewer, field-evidence, guided-job, photo and database-console tests. The complete `npm.cmd run validate` gate passes type checking, warning-free lint, 31 of 31 integration tests, 1,077 main tests with 1,075 passed, 2 intentionally skipped and 0 failed, all 98 migrations through `0097_creditex_operations_lifecycle.sql`, the customer-plan PDF audit, production build and Sites server-bundle audit. New schema and seed statements `0093` to `0097` retain one complete SQLite statement per physical line for the Sites D1 execution contract, including the retained `0096` history slot. The 132 governed trigger definitions are installed idempotently in at most 40-statement prepared D1 batches with automatic portal retries; every installed definition must exactly match its expected `sqlite_schema` SQL before Creditex access, governed case creation, verified trade access, team access or governed customer-media deletion can continue. AEA Field separately passes 6 of 6 tests, lint, type checking and Android and iOS export. Independent review approves release only as an empty invitation-gated baseline. Authenticated Creditex administration, non-admin least privilege, representative physical-device capture, hosted R2 evidence viewing, backup and restore, private rule-pack accuracy, approved calculator provenance and registry behavior remain unverified or blocked until separately accepted.

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

1. **Replace the shared bootstrap with named Creditex administrators:** provision at least two named verified administrators, require strong authentication, review least privilege and suspend the `info@ausenergyassessments.com` bootstrap from routine use.
2. **Approve one exact production rule pack and physical-device path:** Creditex selects one VEU `6(23)` category and scenario, signs the authoritative activity and evidence policy, and accepts capture, offline recovery, review and correction on representative iOS and Android devices.
3. **Approve custody and withdrawn-policy governance:** implement the signed retention, legal hold, deletion, backup and restore schedule and an explicit continuation or supersession decision for cases whose pinned policy is withdrawn.
4. **Release the first independently verified calculator:** reconcile exact inputs, units, effective dates, product and climate lookups, caps and rounding to official or Creditex-approved vectors, then dual-approve one calculator while all others remain disabled.
5. **Rehearse one provider and legacy cohort:** build an authorised dry-run submission adapter plus response reconciliation, map representative Dataforce and Runabout records without source mutation, reconcile every count, hash and exception, then run a bounded parallel pilot.

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
