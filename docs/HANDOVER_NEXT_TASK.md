# Next task handover

Status: released implementation milestone

Prepared: 31 July 2026

Milestone ID: `CUSTOMER-INSTALLER-SUBMIT-17`

Implementation baseline: `a0a438271b03936e3972383e5586c2a12caa51aa`

Released application for this milestone: Sites version 234 from application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b`

Current source checkpoint: the documentation-only child containing this record; it does not change the executable application identity above

Production URL: `https://compare.ausenergyassessments.com`

The [complete current-state audit](./audit/2026-07-21-complete-current-state/README.md) remains the immutable evidence baseline. [RELEASE_TRUTH.md](./RELEASE_TRUTH.md) owns released implementation status and application deployment identity. [ROADMAP.md](../ROADMAP.md) owns approved forward sequencing. The household and experienced-assessor pilot remains deliberately deferred while the five next product steps recorded below are completed.

## Current milestone outcome

Make the final installer-response confirmation one authoritative action. The contact details entered in the modal are now validated and saved by the same server request that transitions the project into private matching, creates the installer opportunity and records consent. The customer no longer saves the profile first, collides with a second read or receives an instruction to repeat data entry elsewhere.

The production failure persisted after the earlier trigger-count correction because the submit path selected raw D1 `address_line_1` and passed it to readiness logic that only recognised camel-case `addressLine1`. The profile update had succeeded, but the following project request falsely reported that the street address was missing. Application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b` removes that split source of truth: modal contact travels with the project request and is committed in the same guarded D1 batch.

## Current user outcomes

- `Save details and request responses` is the only customer action needed: it saves the modal contact and submits the installer request.
- Valid modal details do not depend on a prior profile PATCH, profile revision token or another-tab recovery loop.
- A genuinely stale project revision still fails closed before contact or matching state is partially changed.
- Replaying an already submitted matching or quote-review project updates authoritative contact without creating another opportunity or consent record.
- The success dialog confirms `Request sent`, and the overview shows the project as `Installer matching`.

## Current scope and boundaries

- Same-origin authentication, customer ownership, project-status checks, field validation and project compare-and-swap protection remain enforced.
- Postcode and state remain project-derived and update the private profile service area; phone, street, unit and suburb come from the confirmed modal.
- Contact details remain withheld during matching and are not released to installers until the customer separately approves direct contact.
- The release does not change the 12-file evidence boundary, supplier allocation rules, direct-contact consent or the deferred field pilot.
- Live verification intentionally submitted one working-demo project to prove the complete production path; no real customer, trade or wholesaler account was involved.

## Current acceptance and release evidence

- Focused authoritative-submit regressions pass 50 of 50.
- Exact application commit `7d7a821123d9b70cace08ac632d58ca1d3851b1b` passes `npm.cmd run validate`: type checking, warning-free lint, 31 of 31 integration tests, 915 total tests with 913 passed and 2 intentionally skipped, all 87 migrations through `0086_customer_evidence_multi_photo_prompts.sql`, the tagged-PDF audit, Vinext production build and Sites server-bundle audit.
- `git diff --check` passes. GitHub `main`, branch `codex/sites-custom-domain-migration` and Sites managed `main` contain the exact application SHA.
- Local archive `aea-sites-7d7a821.tar.gz` is 7,086,533 bytes with SHA-256 `22DE94F3E9B22493FF79ED9DC70FF62F6D8B7259DC02AEB93E33B28445EEF2C3`.
- Sites stored 312 files, 27,770,880 bytes with content hash `sha256:3ffeb4fb493c6426cb78aceb8792de7e2e65830181d410c23d53ea9a8a87cc9f`.
- Sites version 234 is saved as `appgprj_6a550c378000819185caf094173422bb~appgver_06f96686a8dc8191a0e01c2555c2de1b` and deployed as `appgdep_6a6bf3695b6081918ce2a9dd77bc3869` with environment revision 19.
- Signed-in production verification submitted project `154aee4d-3648-4c7c-b393-c6715c518b24` through the modal. The submit returned HTTP `200` under request `a238af3e5f81164e`, the dialog showed `Request sent`, the overview showed `Installer matching`, and the post-deployment Worker error-only query returned zero events.

## Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Current executable application commit: `7d7a821123d9b70cace08ac632d58ca1d3851b1b`
- Sites application version: 234
- Sites saved-version identity: `appgprj_6a550c378000819185caf094173422bb~appgver_06f96686a8dc8191a0e01c2555c2de1b`
- Sites production deployment: `appgdep_6a6bf3695b6081918ce2a9dd77bc3869`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 87
- Immutable audit changes: none
- Working-demo data changed during live verification: project `154aee4d-3648-4c7c-b393-c6715c518b24` moved from draft to installer matching, transactionally created the opportunity and consent records, and triggered normal notification and allocation processing

## Known release risk

The last recorded exact production-only `npm audit --omit=dev` result reports six existing advisories: one low and five high. Dependency remediation remains a separate bounded patch with the complete validation and live-release gates.

## Prior released milestone: `CUSTOMER-INSTALLER-PHOTOS-16`

### Outcome

Remove trigger-amplified false conflicts and let each guided photo prompt hold several independent photos. Exact application commit `5acc4ccf37acd608dc437d3a074410b1d840f706` passed the complete release gate and was deployed as historical Sites version 233 through `appgdep_6a6be56ca9ac8191918423bd57f0a05d`. Documentation checkpoint `a0a438271b03936e3972383e5586c2a12caa51aa` recorded that release before version 234 superseded it.

Those multi-photo, private-evidence, trigger-safe change-count and per-photo control contracts remain active underneath version 234.

## Prior released milestone: `CUSTOMER-PLAN-DURABILITY-15`

### Outcome

Make plan completion durable and understandable: keep guided photos visible where customers added them, preserve safe resumable evidence handling, make deletion recoverable, turn plan history into a useful comparison and check-in tool, submit installer requests from one confirmation, and deliver worker-safe accessible PDF and email reports.

Implementation commit `e74278c8b62c569541ea84b5a431917d03a1c13a` completed the product slice. Its first saved Sites version 231 failed before public activation because a private Next Fontkit bundle referenced `__dirname`; version 230 remained live. Corrective child `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d` replaced that private boundary with public `@pdf-lib/fontkit`, added a post-build Sites bundle audit and became the executable source for version 232. Documentation checkpoint `2c55430757c316b4045e3edd9a26263a24793f14` recorded that release before version 233 superseded it.

### User outcomes

- A newly selected guided photo immediately shows a local preview, filename and saving state in the exact card where it was added.
- A saved photo stays visible after reload with replace and remove controls; if work choices change, the photo remains visible under a clearly labelled earlier-selection group.
- Guided evidence is not silently duplicated as generic evidence.
- A draft that is being deleted cannot still look active, accept new uploads or open through a stale continue link; recoverable cleanup can be finished from the dashboard.
- Customers can compare two plain-language roadmap versions, download a private-safe comparison, record private before-and-after observations and restore an earlier roadmap only as a new draft version.
- Missing private contact details save and the installer request submits from one confirmation, with one bounded authoritative conflict recovery rather than a second customer step.
- PDF and email delivery retain the premium visual hierarchy, embedded fonts, semantic lists and links. Unsupported scripts receive a clear fail-before-save response rather than corrupted visible text.

### In scope

- In-place pending and saved guided-photo previews, save or upload status, replacement, cancellation and removal.
- Stable capture slots, metadata stripping, resumable multipart private evidence uploads and compare-and-swap retake or removal.
- Retained guided evidence after work choices change, without duplicating generic evidence or supporting PDFs.
- Durable `deleting` state, frozen evidence writes, retryable D1 and R2 cleanup, and deletion-aware dashboard and direct-route behavior.
- Plain-language revision history, two-version comparison, privacy-filtered export, private outcome check-ins and guarded draft-only restore.
- One-confirmation private-profile save and installer request with a single bounded conflict recovery.
- Embedded Liberation Sans, tagged-document foundations, semantic lists and links, WCAG AA small-copy colours and fail-before-save unsupported-text handling.
- Public worker-safe `@pdf-lib/fontkit` plus a production bundle guard against `__dirname` and the private Next Fontkit marker.
- Migration `0085_customer_evidence_resumable_retake.sql` and the focused evidence, deletion, history, request, email and PDF regressions.

### Out of scope

- The deferred household and experienced-assessor field pilot.
- Real Gmail or Outlook desktop delivery acceptance and independent assistive-technology or PDF/UA conformance.
- Customer-visible crop, blur, redaction or annotation.
- Restoring a browser `File` object after a full reload without customer reselection.
- Rendering CJK, Arabic, Devanagari, Vietnamese or other scripts not covered by the current embedded fonts.
- Editable revision names or private revision notes.
- New provider configuration, live installer-request submission or mutation of working-demo evidence during release verification.
- The five forward product steps recorded below.
- Changes to the immutable dated audit or a Netlify deployment.

### Privacy and safety boundaries

- Evidence remains same-origin authenticated, owner scoped, private by default and unavailable to installers unless the customer explicitly marks it for the existing allocated-installer sharing boundary.
- Image metadata is stripped before durable storage; uploads remain bounded to 12 files of 8 MB and expired sessions cannot revive a deleted or deleting project.
- Retake and removal require the exact observed evidence revision so a stale browser cannot overwrite a newer file.
- Deletion freezes new evidence writes before cleanup and never treats a partially cleaned project as active again.
- Comparison exports exclude exact address, room names, evidence filenames, private notes and custom roadmap wording.
- Restoring a roadmap cannot replace project identity, private notes, evidence, quotes, installer activity or contact-release state.
- Contact details remain private platform data until the customer separately approves a named installer handover.
- A PDF with unsupported text fails before save and does not emit replacement characters or a partially corrupted document.

### Acceptance criteria

- Pending, saved and earlier-selection guided photos remain visible in the matching guided-photo section with accurate state and controls.
- Resumable sessions, stable capture slots, stale-revision rejection and deleting-project upload denial pass focused server and UI regressions.
- Deleting projects stay excluded from active totals, recommendations, continue links and editable detail routes until cleanup finishes.
- Version comparison, export, private check-ins and restore preserve all excluded private and installer state.
- Profile save and request submission use one confirmation and one bounded authoritative conflict recovery without replaying project, evidence or request writes.
- Focused PDF and email correction tests pass 18 of 18; type checking, warning-free lint, 31 integration tests, 914 total tests with 912 passed and 2 intentionally skipped, all 86 migrations, the Vinext production build, bundle audit and diff hygiene pass.
- Every page of the nine-page tagged-PDF audit is visually clean and contains no clipping, overlap, missing glyph, harsh corner or footer defect.
- GitHub, Sites managed source, saved version 232 and the public deployment resolve to exact corrective application commit `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`.
- Live signed-in inspection loads the saved roadmap, comparison and check-in UI and shows a selected working-demo photo directly beneath its matching guided prompt without mutating it.

### Stop conditions

Stop the affected path when:

- an evidence write could cross owners, bypass the private default, exceed the upload limits, retain unsafe metadata or resume after deletion starts;
- a stale retake, removal, deletion cleanup, profile update or request could overwrite newer state;
- deleting a draft could expose it as active, silently abandon private objects or allow a normal edit route;
- a comparison export or restore could include or overwrite excluded private or installer state;
- an unsupported script could produce corrupted or partially saved customer output;
- a generated Sites server bundle contains `__dirname` or the private Next Fontkit marker;
- live verification would replace or remove a working-demo photo, save profile data or submit an installer request;
- the release commit, GitHub branch, Sites source, archive, saved version and deployment do not reconcile;
- the immutable audit would change; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

### Release evidence

The exact application source passed:

```powershell
node --test test/customer-plan-pdf.test.mjs
npm.cmd run audit:sites-server-bundle
npm.cmd run validate
git diff --check
```

Observed results:

- implementation commit: `e74278c8b62c569541ea84b5a431917d03a1c13a`;
- failed non-live Sites version 231: saved identity `appgprj_6a550c378000819185caf094173422bb~appgver_7a589f567528819189cf033456193bda`, deployment `appgdep_6a6bcf5c0f7c8191b877d27581f9d82e`, failure `__dirname is not defined`; it never became public and version 230 remained live;
- corrective executable application at that release: `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`;
- focused PDF and email correction set: 18 of 18 passed;
- integration suite: 31 of 31 passed;
- complete test suite: 914 total, 912 passed, 2 intentionally skipped and 0 failed;
- type checking and warning-free lint: passed;
- migration verification: all 86 migrations through `0085_customer_evidence_resumable_retake.sql` passed against fresh SQLite and Cloudflare D1 paths;
- PDF audit: nine visually clean pages, tagged-document foundation present, document format `2026-07-31-tagged-plan-pdf-v6`, unsupported scripts fail before save;
- Vinext production build, the Sites bundle audit and `git diff --check`: passed with no `__dirname` or private Next Fontkit marker;
- GitHub `main`, the working branch and Sites managed `main`: exact application SHA `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`;
- local release archive: `aea-sites-7e1f0a8.tar.gz`, 7,085,796 bytes, SHA-256 `9555352A7F723A615F2D97E2BFEE736DCD6D491C4189B5E100D179D7CB121974`;
- Sites stored archive: 311 files, 27,760,640 bytes, content hash `sha256:e48b4226de4114a1c68ab45ed29021778470a3333b477a44131f07b080e5f2f0`;
- Sites application version 232: saved identity `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8`, production deployment `appgdep_6a6bd28a71888191be19f89db9b82ca5`, environment revision 19;
- live signed-in inspection loaded the saved roadmap, two-version comparison, privacy-filtered export action and private check-in UI;
- a selected working-demo photo remained visibly named with `Added privately to this draft` in its matching guided card; and
- no working-demo photo, project, profile or installer request was saved, replaced, removed or submitted. The post-deployment Sites Worker error-only query returned zero events.

### Released implementation state at version 232

- GitHub branch: `codex/sites-custom-domain-migration`
- Implementation commit: `e74278c8b62c569541ea84b5a431917d03a1c13a`
- Corrective application commit at release: `7e1f0a85214aa505cb83ed9f8c5da9644b57df0d`
- Sites application version: 232
- Sites saved-version identity: `appgprj_6a550c378000819185caf094173422bb~appgver_0476874df3f081919c8e4c4acb4fd0f8`
- Sites production deployment: `appgdep_6a6bd28a71888191be19f89db9b82ca5`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 86
- Immutable audit changes: none
- Working-demo data changed during live verification: none

### Known release risk at version 232

The last recorded exact production-only `npm audit --omit=dev` result reports six existing advisories: one low and five high. The package installation used for the worker-safe Fontkit correction reported 23 advisories across the full development tree, but no automatic audit fix was run and that broad count is not substituted for a fresh production-only audit. Dependency remediation remains a separate bounded patch with the complete validation and live-release gates.

## Prior released milestone: `CUSTOMER-INSTALLER-REQUEST-14`

The prior release established explicit completed-stage styling and the focused private installer-request dialog with protected recovery. Its exact application commit was `2607cc53f2e4c79546701e29d3d182fde4670952`, deployed as Sites version 230 through deployment `appgdep_6a6b5469c8bc81919f0e2c9ef22da602`. Documentation baseline `8a3a38c2e68de30f77720be0800acf6119fb32f0` recorded that checkpoint. Those contracts remain active underneath version 234.

## Prior released milestone: `CUSTOMER-ROADMAP-CONTEXT-13`

The prior release established the authoritative pre-roadmap home and work context, goal-derived priorities, `What shaped this roadmap` summary and non-duplicated quote-preparation stage. Its exact application commit was `0db488f325a79e22d126aace75647715b59c96f9`, deployed as Sites version 229 through deployment `appgdep_6a6b38fcccbc8191b8b2daedf57b9e24`. Documentation-only child `f4dbde8b742ece96e44f5a941f26bc712b0f82f8` recorded that checkpoint without changing the executable application. Those contracts remain active underneath version 234.

## Earlier released milestone: `CUSTOMER-PROJECT-CLEANUP-12`

The earlier release established compact project controls and guarded permanent deletion for unused private drafts. Its exact application commit was `da35ce60295d6c7150cddd9b35e33fcf64c8521b`, deployed as Sites version 227 through deployment `appgdep_6a6b22db21c48191a2dedbdbf05274ef`. Documentation-only child `563a4d805d9c6443096d5c73317ec18fc56f041e` recorded that checkpoint without changing the executable application. Those controls remain active underneath version 234.

## Earlier released milestone: `CUSTOMER-PLAN-TRUST-11`

The earlier release established the shared premium preview, duplicated bottom actions, guided private photos, bounded revision compare and restore through `0084_customer_plan_revision_restore.sql`, tagged-PDF foundations through format `2026-07-30-tagged-plan-pdf-v3` and adaptive email compatibility. Its exact application commit was `bc427d295b3106907904a3c0b7bf9f2945561cd1`, deployed as Sites version 224 through deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2`. Documentation-only child `23594c2b61dec855aeba0a10ba5a28eb3aeaf692` was later published as historical Sites version 225 without changing that executable application. Those contracts remain active underneath version 234.

## Earlier released milestone: `CUSTOMER-PLAN-SPACING-10`

The earlier release established consistent spacing and rounded surfaces throughout the premium PDF and email. Its exact application commit was `e74c2d95889a381cb3bb434607bc6584e54cf722`, deployed as Sites version 222 through deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28`. Documentation-only child `c2599eb5bedb11b1648da2b4a60e11b242cb2abb` was later published as historical Sites version 223 without changing the executable application. Those visual contracts remain active underneath version 234.

## Earlier released milestone: `CUSTOMER-PLAN-TECH-PRESENTATION-09`

The earlier release established the exact-brand technical presentation, truthful completed-plan signals and single household or professional evidence boundary. Its exact application commit was `f401575a5bf463b85c7688424db0b99dddd220c5`, first deployed as Sites version 220 through deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f`. Those contracts remain active underneath the later spacing and trust releases.

## Earlier released milestone: `CUSTOMER-PLAN-PREMIUM-REPORT-08`

The earlier release established the shared premium PDF, responsive email HTML and plain-text hierarchy while retaining the reliable non-mutating native attachment path. Its exact application commit was `fb6cacf8b0309a3fc26b40a43da5b025050d22d2`, first deployed as Sites version 218 through deployment `appgdep_6a6a11c02e088191bb27cc302c8b35af`. Documentation-only child `a92e18b9ea79b53eaf6eda8665f37ec02c861972` was recorded as historical Sites version 219 without changing that executable application. The shared report projection and privacy boundaries remain active underneath the later technical presentation and spacing releases.

## Earlier released milestone: `CUSTOMER-PLAN-NATIVE-PDF-07`

The prior release established the reliable non-mutating browser-native PDF attachment path. Its exact application commit was `8cdec99bcd2d1cb9f2ec0dc18c87a71860412642`, first deployed as Sites version 216 through deployment `appgdep_6a69f763e0b08191b6ac8539e0828d84`. Its delivery mechanism remains active underneath the premium report presentation.

## Earlier released milestone: `CUSTOMER-PLAN-DIRECT-PDF-06`

The prior direct-PDF release used a client worker and produced a valid PDF from the public planner. Its exact application commit was `d5c675a5ceffa6e924df033e8cb8b505bb4d6336`, first deployed as Sites version 214 through deployment `appgdep_6a69e79a91548191987f12631559cb1f`. The signed-in action was not exercised during that release and later failed the product-owner operational check: it saved the project and could process or upload pending evidence before generating the PDF, then relied on a delayed hidden-link click. It is superseded by `CUSTOMER-PLAN-NATIVE-PDF-07`.

## Earlier released milestone: `CUSTOMER-PLAN-PRO-PRINT-05`

The prior release added the optional self-declared professional review and bounded everyday-action section. Its exact application commit was `ee75aadfd6800c01b92532b2d376a4a1e33c9d74`, first deployed as Sites version 212 through deployment `appgdep_6a69c4f838bc8191a0e050da219ab4a6`. Its temporary-frame browser-print mitigation passed source-level gates but was superseded after the product owner reproduced a Chrome freeze.

## Earlier released milestone: `CUSTOMER-PLAN-EVIDENCE-04`

The prior release established the shared categorized fourteen-question home-detail taxonomy, explicit `Not sure` handling, private-by-default evidence scope, bounded plan history and one concise privacy-filtered report across email and print. Its exact application commit was `6540ee671e64dbfdf80592283a1954b2ff482355`, first deployed as Sites version 210 through deployment `appgdep_6a695ca742d081918d73196751713f98`.

## Earlier released milestone: `CUSTOMER-PLAN-DECISION-03`

### Milestone outcome

Turn the current household plan into a decision-ready, independently useful document without implying a site assessment, authenticated assessor review or savings guarantee.

The milestone completes the four post-context product priorities:

1. explain why each controlled plan item appears, what remains unknown and what could change its position;
2. show no more than three safe, material next questions, with `Not sure` always valid;
3. add a private customer-owned review worksheet that clearly labels feedback as `Recorded by you`; and
4. produce one privacy-filtered independent plan brief for accessible preview, email and A4 print or browser PDF.

It also removes the visible product drift reported in the same customer journey:

- reinforce readable project-preparation guide paragraphs on the navy canvas;
- make the draft save-status message readable and announce changes accessibly;
- replace the stale public `/plan` recommendation contract with the current canonical advisor options and generator; and
- provide an accessible email-recipient dialog plus `Print or save PDF` action from the signed-in plan step.

### User outcomes

- A household can understand the controlled evidence behind each recommendation without being shown a false numerical confidence score.
- At most three unanswered questions identify the next information that could materially change safety, permission or plan order.
- A customer can privately record questions, feedback they heard and proposed changes without the system claiming that an assessor authored or verified them.
- Accepting a recorded proposal does not silently change the plan. A customer must explicitly add it as a private plan step.
- A verified signed-in customer can save the exact current draft, enter one confirmed recipient and request one independently useful plan email.
- The email response says `Accepted for delivery`; it does not claim inbox delivery.
- The same privacy-filtered document appears in a high-contrast A4 print view that supports printing or the browser's Save as PDF action.
- The public quick planner uses the same canonical goals, tenure, approval, budget, home-feature and recommendation boundaries as the signed-in advisor.
- Private project labels, exact location, room routines, filenames, account contact data, private notes, customer review text and arbitrary permission text do not enter the independent brief.

### In scope

- Bump the versioned customer plan contract while preserving edited legacy plans through the existing conflict boundary.
- Add bounded, controlled rationale and next-question derivation.
- Extend the existing owner-scoped advisor-profile JSON with at most twenty private review items.
- Keep review kinds, targets and statuses allowlisted and text capped at 500 characters.
- Add a shared privacy-filtered plan-document projection with escaped inline HTML and plain text.
- Add authenticated, owner-scoped email delivery with explicit recipient confirmation, strict single-address validation, idempotency and a fail-closed five-attempt hourly rate limit.
- Reuse the configured email delivery provider. Do not add a new provider or send a release-test email to a real address.
- Add an accessible modal with focus management, Escape close, focus return and live status.
- Add an A4 print surface generated from the same saved plan projection.
- Reconcile the public quick planner and account handoff with the current canonical plan engine.
- Add focused domain, privacy, route, provider, accessibility, responsive and contrast regression tests.

### Out of scope

- The deferred household or experienced-assessor field pilot.
- Remote assessor invitations, authenticated assessor identity, external editing, access tokens or reviewer credentials.
- Professional evidence review, verification or a claim that an attachment has been assessed.
- A formal NatHERS assessment, NatHERS certificate, energy rating, equipment sizing or legal approval.
- Brands, provider ranking, current market prices, savings promises or finance advice.
- A server-side browser or a binary PDF generation dependency. A4 print plus browser Save as PDF is the bounded PDF path.
- Real customer, trade, wholesaler or assessor account creation.
- Installer opportunity, direct-contact, payment or subscription changes.
- Changes to the immutable dated audit.
- Netlify deployment.

### Privacy and safety boundaries

- Guidance and next questions are derived only from controlled inputs and fixed internal guide destinations.
- `Not sure` is useful evidence and never blocks saving or submission.
- Questions must not ask a person to climb a roof, enter a roof space, remove electrical covers, block required ventilation or perform unsafe inspection.
- Review text remains customer-owned private project data. It never enters installer opportunity output, permission packs, email, print or public planner URLs.
- Only the owning active customer can read or write the saved plan used for delivery.
- Email delivery accepts one normalized address, requires a verified account and explicit confirmation, and fails closed when rate-limit storage or provider configuration is unavailable.
- Custom plan text and private plan notes are omitted from the independent brief. The brief reports omitted counts without copying the wording.
- The report is an independent home energy plan prepared from customer selections. It is not a completed site assessment, quote, legal permission decision or savings promise.

### Acceptance criteria

- Every canonical generated plan item has bounded `Based on`, `Still uncertain` and `Could change if` guidance.
- Next questions are deterministic, unique, fixed-destination, safe and capped at three.
- Review-item normalization enforces kinds, targets, statuses, length and count; invalid targets do not create an assessor identity or verification state.
- Submitted-project locking and duplicate-before-revision behaviour remain intact.
- Review text cannot enter installer opportunity, permission-pack or independent-brief output.
- The plan email API rejects missing consent, unverified identity, inactive account, wrong ownership, archived projects, multiple or malformed recipients, oversized bodies, unavailable rate limiting and unavailable provider configuration.
- No automated test or live release check sends an email to a real address.
- The print surface uses the exact saved ordering and controlled current plan content, is keyboard reachable and renders on A4 without the application shell.
- The public `/plan` and signed-in advisor produce the same canonical item sequence for equivalent controlled input.
- Project-preparation paragraphs and the draft status meet readable contrast and mobile layout requirements.
- Focused tests, the full validation gate, all migrations, production build, diff hygiene, source provenance and desktop plus 390 px live checks pass.

### Stop conditions

Stop the affected path when:

- actual remote assessor access or identity is required;
- arbitrary review, project or permission text could escape into installer or shared output;
- an accepted review changes the plan without a second explicit customer action;
- an unsafe question or blocking guess would be introduced;
- legacy edited plan items would be lost during version regeneration;
- provider configuration, rate-limit storage or source provenance cannot be verified;
- a change would create or use a real account for release testing;
- the release commit, GitHub branch, Sites source, archive and saved version do not reconcile;
- a change would alter the immutable dated audit; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

### Release evidence

The exact application source passed:

```powershell
node --experimental-strip-types --test test/customer-plan-decision-support.test.mjs test/customer-plan-sharing.test.mjs test/customer-advisor-contract.test.mjs test/customer-project-advisor-ui.test.mjs test/customer-project-advisor.test.mjs test/home-energy-plan.test.mjs test/dark-canvas.test.mjs test/direct-trade-enquiry.test.mjs test/service-reminder-delivery.test.mjs test/site-navigation.test.mjs
npm.cmd run validate
npm.cmd test
npm.cmd run test:integration
git diff --check
```

Observed results:

- focused plan, privacy, provider, accessibility and navigation review set: 51 of 51 passed;
- complete suite: 784 tests, 782 passed, 2 intentionally skipped and 0 failed;
- integration suite: 31 of 31 passed;
- type checking: passed;
- warning-free lint: passed;
- migration verification: all 83 migrations passed on fresh SQLite and Cloudflare D1 paths;
- Vinext production build: passed;
- `git diff --check`: passed;
- GitHub and Sites managed source branch: exact application SHA `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e`;
- Sites application version: 208, deployment `appgdep_6a6943bcb758819196c764370a2b683a`, public, environment revision 19;
- required Sites delivery and limiter configuration names are present; secret values were not read or reproduced;
- live public `/plan` exposes the reconciled seven-part advisor intake and controlled question-led result;
- the live guide paragraph colour is `rgb(185, 204, 215)` on the navy canvas with no horizontal overflow;
- the live print route contains the ordered plan, decision questions, guide links and browser Print or Save as PDF action;
- representative local A4 output was inspected across four pages with complete cards, visible links, clean page breaks and no application shell;
- no real account was created or used, no working-demo data changed and no release check sent an email.

The authenticated email route and signed-in sharing UI were verified through owner-scope, privacy, provider, idempotency, limiter, modal and projection regressions. Live delivery was deliberately not exercised because the release boundary prohibits sending a test message to a real address.

### Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `e82481b2b4dfca61ef3c4aa4d9c3d0d1c725000e`
- Sites application version: 208
- Sites application deployment: `appgdep_6a6943bcb758819196c764370a2b683a`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 83
- Immutable audit changes: none
- Demo data changed during live verification: none

## Prior released milestone: `CUSTOMER-ADVISOR-CONTEXT-02`

### Milestone outcome

The administrator notification inbox now keeps an expanded case open and at its prior visible position when the automatic audited read-state update refreshes and reorders the queue.

The household project builder also completes the next four advisor priorities:

1. controlled evidence-source confidence and provenance;
2. postcode and state based broad climate sequencing;
3. room-by-room comfort evidence that changes advice only when the concern and use period belong to the same room; and
4. a renter, owner and strata permission checklist derived from tenure, approval context, the current plan and remaining evidence questions.

The result remains an independent, brand-agnostic planning workflow. It is not a NatHERS assessment, legal permission decision, quote, fixed-price estimate or savings promise.

### User outcomes

- An administrator can open an unread case without the case collapsing or jumping away when the read update completes.
- Explicit close and resolve remain deliberate actions.
- A deliberate queue, search, category, priority, status or assignee change resets the open-case boundary instead of keeping an out-of-filter record visible.
- A household can label each important controlled fact as not known, customer reported, photo available for review or document available for review.
- Evidence labels describe the available source only. They do not claim that a file is attached to the fact, professionally reviewed or verified.
- A valid matching postcode and state produce a broad planning profile that can change whether shading or building-shell investigation appears first.
- Invalid, non-residential or postcode/state-mismatched input produces no climate profile.
- A household can add up to twelve private room profiles using controlled room types, concerns and use periods.
- Same-room hot daytime evidence can lead with shade and solar control. Same-room cold overnight evidence can lead with safe draught and insulation investigation.
- Private room names and routines do not enter the installer opportunity.
- Renter-portable and reversible actions appear before permission-dependent fixed work.
- The customer can build and preview a five-section property-permission checklist before downloading it.
- A customer-selected permission class cannot remove a mandatory licensed trade or site check.
- Arbitrary permission titles, identifiers and note wording remain inside the signed-in project. The shareable checklist uses controlled text and private-note reminders.
- Every generated evidence, climate and room step links to a plain-language explanation.

### In scope

- Stabilise the expanded case in `AdminNotificationInbox` across audited background refreshes.
- Add a small pure state helper for queue pinning and explicit reset semantics.
- Add regression tests for reordering, filter-boundary updates, unavailable cases and deliberate filter changes.
- Add `customer_projects.advisor_profile` as additive JSON text through `0082_customer_advisor_profile.sql`.
- Persist and hydrate the advisor profile through create, update, list and duplicate project paths.
- Add server normalization for evidence sources, climate, rooms and permission items.
- Keep a maximum of twelve rooms, sixty characters per private room name and controlled values for room type, concern and use period.
- Keep a maximum of thirty permission items and controlled classifications.
- Generate the permission pack from tenure, strata context, current plan, evidence gaps and customer classifications.
- Keep authoritative safety rules in their controlled section even when customer classification differs.
- Replace arbitrary shareable permission text with controlled reminders.
- Derive installer opportunity context from broad climate, controlled room-type and concern aggregates, and known or unknown source counts.
- Preserve the exact-postcode allocation boundary while returning an empty postcode to installers before contact release.
- Add preparation-guide sections for evidence, broad climate and room comfort.
- Correct guide paragraph contrast on the navy customer canvas.

### Out of scope

- Professional review or verification of household evidence.
- Formal NatHERS climate zones, ratings, certificates or equipment sizing.
- Legal advice or proof that owner, agent, strata or owners-corporation permission has been granted.
- Brand, product, provider or installer ranking.
- Current market-price estimates or guaranteed savings.
- Automatic access for an assessor.
- Creation of real customer, trade, wholesaler or assessor accounts.
- Generic Database Console withdrawal.
- Changes to the immutable dated audit.
- Netlify deployment.

### Advisor and privacy boundaries

- Use `independent home energy plan`, not `NatHERS assessment` or `NatHERS certificate`.
- Treat `Not sure` as valid information.
- Do not infer attachment review, professional validation or proof from a customer source selection.
- Do not tell customers to enter roof spaces, climb roofs, remove electrical covers or block required ventilation.
- Keep room names, room use periods, permission titles, permission notes, exact location and project-private notes out of installer opportunity payloads.
- Keep arbitrary permission wording out of the shareable checklist.
- Use controlled aggregates only where installer matching needs them.
- Keep the permission checklist as a question and review aid. It does not grant permission or replace licensed or site-specific advice.
- Use broad climate only to order investigations. It does not size equipment or predict savings.

### Data and compatibility requirements

- `customer_projects.advisor_profile` is additive JSON text with default `{}`.
- The forward migration is `0082_customer_advisor_profile.sql`. Applied migration history remains unchanged.
- That prior release's plan version was `2026-07-29-evidence-climate-advisor`.
- The prior `2026-07-29-home-advisor` plan version is legacy and regenerates through the existing edited-plan conflict boundary.
- Server normalization derives climate from the stored postcode and state. Client-supplied climate text is not authoritative.
- Invalid evidence-source, room, concern, use-period and permission values fall back to controlled safe states.
- Room concerns affect plan sequencing only when the relevant concern and use period occur in the same room.
- User classification is supplementary. It cannot replace an authoritative permission or licensed-site-check rule.
- API writes remain owner scoped and preserve backward compatibility for rows without an advisor profile.
- Duplicate projects preserve the normalized advisor profile without creating installer disclosure.

### Acceptance criteria

- The first unread demo case remains expanded and first in the visible queue after its automatic audited read update.
- That case no longer shows its `Mark read` action after the update, while `Close case` remains available.
- Manual filter changes reset the pinned case.
- Evidence labels make no unsupported review or attachment claim.
- Valid postcode and state input produce one bounded planning profile; invalid or mismatched input produces none.
- Hot daytime and cold overnight rules do not cross-correlate separate rooms.
- Room and permission limits are enforced by server normalization.
- Renter-portable actions precede fixed or permission-dependent work.
- The permission pack contains five controlled sections and retains authoritative safety rules.
- Malicious or private permission titles, notes and identifiers are not copied into the pack.
- Installer opportunity output excludes private room and permission content.
- Focused tests, full validation, all migrations, the production build, diff hygiene, source provenance and live checks pass.

### Validation commands and observed results

The exact application commit passed:

```powershell
node --experimental-strip-types --test test/admin-notification-inbox-stability.test.mjs test/customer-advisor-contract.test.mjs test/customer-project-advisor-ui.test.mjs test/customer-project-advisor.test.mjs
npm.cmd run validate
node --experimental-strip-types --test
git diff --check
```

Observed results:

- focused advisor and administrator regression set: 38 of 38 passed;
- integration suite inside the release gate: 32 of 32 passed;
- full suite: 770 tests, 768 passed, 2 intentionally skipped and 0 failed;
- type checking: passed;
- warning-free lint: passed;
- migration verification: all 83 migrations passed on fresh SQLite and Cloudflare D1 paths;
- Vinext production build: passed;
- `git diff --check`: passed;
- application source and Sites managed branch: exact SHA `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77`;
- Sites application version: 206, deployment `appgdep_6a68ff2f45d08191aec1274c14168407`, public, environment revision 19;
- public health, guide, signed-out customer route and administrator shell: HTTP 200;
- signed-in customer verification: all five steps selectable; evidence labels, room profile, broad climate, editable plan and five-section permission preview present;
- responsive verification: desktop guide contrast is readable; the 390 by 844 computed layout has no horizontal overflow;
- signed-in administrator verification: one working-demo notification changed from unread to read, stayed expanded and retained its first visible position;
- no real account was created or used.

The Sites error-only query returned three informational canceled `/api/electricity-plans` health-monitor invocations and no exception message attributable to the newly checked release routes. The monitor cancellation remains a separate operational observation, not a passing end-to-end electricity-plan provider check.

### Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `7e772ace2dc8fa26a05863e1fa865d58e4fdbd77`
- Sites application version: 206
- Sites application deployment: `appgdep_6a68ff2f45d08191aec1274c14168407`
- Production URL: `https://compare.ausenergyassessments.com`
- D1 migration count: 83
- Immutable audit changes: none
- Demo data changed during live verification: one notification read-state only

### Release and stop conditions

Stop the affected work when:

- evidence wording would imply professional review that did not occur;
- broad climate wording could be mistaken for a NatHERS result;
- room or permission text could disclose private household information to installers;
- a customer classification could remove a mandatory safety or licensed-site check;
- advice could encourage unsafe inspection, blocked ventilation or unauthorised fixed work;
- a change would create or use a real account for release testing;
- the release commit, GitHub branch, Sites source, archive and saved version do not reconcile;
- a change would alter the immutable dated audit;
- a legal, regulated-service, privacy, provider or account-ownership decision requires an authorised human.

## Next five logical product steps

1. **Real Outlook desktop and assistive-technology acceptance:** verify the delivered report in Outlook desktop's Word rendering engine and representative screen-reader and keyboard workflows using dedicated non-customer fixtures.
2. **Visible photo redaction and persistent resumable queue:** add customer-visible crop, blur, redaction or annotation controls and restore resumable upload state across a full page reload without exposing private evidence.
3. **Pan-Unicode PDF font coverage and fallback:** add approved font coverage or deterministic fallback for CJK, Arabic, Devanagari, Vietnamese and other supported customer scripts while retaining fail-before-save for anything still unsupported.
4. **Editable revision labels, notes and richer history sharing:** let customers name revisions, add bounded private context and share or export selected comparisons without broadening restore or installer-access scope.
5. **Pilot readiness telemetry and deferred field test:** define privacy-safe completion, upload, PDF, email and request telemetry, then run the household and experienced-assessor field test only when the product owner resumes the pilot.
