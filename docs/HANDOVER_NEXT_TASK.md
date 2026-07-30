# Next task handover

Status: released implementation milestone

Prepared: 30 July 2026

Milestone ID: `CUSTOMER-PLAN-TRUST-11`

Implementation baseline: `c2599eb5bedb11b1648da2b4a60e11b242cb2abb`

Released application for this milestone: Sites version 224 from application commit `bc427d295b3106907904a3c0b7bf9f2945561cd1`

Current source checkpoint: the documentation-only child containing this record; it does not change the executable application identity above

Production URL: `https://compare.ausenergyassessments.com`

The [complete current-state audit](./audit/2026-07-21-complete-current-state/README.md) remains the immutable evidence baseline. [RELEASE_TRUTH.md](./RELEASE_TRUTH.md) owns released implementation status and application deployment identity. [ROADMAP.md](../ROADMAP.md) owns approved forward sequencing. The household and experienced-assessor pilot remains deliberately deferred while the five next product steps recorded below are completed.

## Current milestone outcome

Make the customer plan easier to review, safer to support with photos, recoverable after edits and more dependable across browser preview, PDF and email.

The release adds one shared premium on-page report renderer, a signed-in accessible preview dialog, a complete second action bar after the last plan step, guided private photo capture, immutable plan revision comparison and restore, a tagged-PDF foundation and an adaptive email-only compatibility boundary. It preserves the established product-neutral advice, household or self-declared professional evidence boundary and non-mutating PDF download path.

## Current user outcomes

- The public `/plan/print` page and the signed-in preview dialog use the same privacy-filtered premium report renderer as PDF and email.
- A signed-in customer can open the full report without leaving the project editor; focus remains inside the dialog, Escape closes it and focus returns to the triggering control.
- `Preview full report`, `Email this plan`, `Download PDF` and the conditional `Reset advisor suggestions` control appear after the final plan step as well as above the ordered plan.
- Both action bars use the same handlers, busy-state protection and customer-visible outcomes.
- Optional guided photo capture explains what each image helps a trade assess, requires three safety and privacy confirmations and keeps a 12-photo bound.
- Camera capture prefers the rear-facing device camera, shows a local preview and uses the existing private evidence upload path.
- Customers can compare bounded saved plan revisions and see changes to goals, home facts, pace, budget, plan version and ordered steps.
- Restoring an earlier revision is draft-only, requires an explicit confirmation and changes only the roadmap fields.
- Restore deliberately preserves project identity, address, work categories, private notes, adviser details, evidence, permissions, quotes and installer activity.
- A stale browser tab cannot silently overwrite a newer revision; unsaved local edits remain visible until the customer explicitly chooses to load the latest saved version.
- Public and signed-in PDF actions retain the browser-native attachment request and do not save a project, process a pending photo or upload evidence.
- PDF format `2026-07-30-tagged-plan-pdf-v3` adds document language, reading order, structural landmarks, link objects and decorative artifacts.
- The tag structure is a foundation only and is not represented as PDF/UA conformance.
- Email remains table based and client conservative; extreme content is adaptively shortened only in the email projection below an 88,000-byte HTML cap.
- Any shortened wording or omitted email-only steps or tips is disclosed in both HTML and plain text, while the full saved plan and PDF remain unchanged.
- The success response says the provider accepted the message and explicitly avoids claiming inbox delivery.
- Household-only and self-declared adviser reports retain the existing evidence wording, independent guidance and privacy exclusions.

## Current in scope

- Reuse one semantic `CustomerPlanReportPreview` for the public preview and signed-in modal.
- Keep the preview read-only and privacy filtered; guide links open safely in a separate tab.
- Duplicate the complete applicable plan action bar after the final ordered item.
- Add deterministic guided photo categories, confirmation gates, local preview and the existing owner-scoped private upload path.
- Separate photo and document upload choices instead of presenting duplicate generic file controls.
- Add `0084_customer_plan_revision_restore.sql`, immutable snapshots, bounded retention and owner-scoped revision endpoints.
- Compare normalized roadmap fields, including plan-version-only changes, and protect every save, submit, milestone and restore path with a revision token.
- Restore only draft roadmap fields and explicitly preserve all customer identity, evidence, access and commercial workflow records.
- Add a valid tagged-PDF foundation without unsupported list-role claims or a PDF/UA statement.
- Keep the full report model authoritative while adapting only extreme email rendering and disclosing every email-only omission.
- Preserve first-party branding, same-origin guide links, no-store headers, browser-native PDF delivery and existing email ownership, confirmation, idempotency and rate-limit controls.

## Current out of scope

- The deferred household and experienced-assessor field pilot.
- Independent credential or accreditation verification, an authenticated assessor identity, remote assessor access or evidence verification by AEA.
- A formal NatHERS assessment, NatHERS certificate, energy rating, equipment sizing or legal approval.
- Brands, provider ranking, current market prices, savings promises or finance advice.
- Automated image interpretation or a requirement to photograph an unsafe area.
- Delivered-client acceptance in controlled Gmail and Outlook inboxes.
- Independent tagged-PDF accessibility or PDF/UA conformance certification.
- Photo redaction, resumable upload, automated image analysis or a requirement to photograph an unsafe area.
- Revision labels, free-form revision notes, selective field restore or revision export.
- Before-and-after outcome tracking or savings measurement.
- A server-side browser, print service or persisted PDF object. The edge route generates response bytes in memory and does not store the PDF.
- Real customer, trade, wholesaler or assessor account creation.
- A release-test email or mutation of a working-demo project.
- Changes to the immutable dated audit or a Netlify deployment.

## Current privacy and safety boundaries

- Household answers and linked files remain household-supplied unless a current professional self-declaration is explicitly confirmed.
- A self-declared professional review never claims that AEA verified the adviser, accreditation, reference, evidence or observations.
- The declared adviser name, scheme or body, reference and notes enter the customer report only while the current declaration remains valid.
- Advice-affecting household or adviser changes invalidate the declaration instead of silently carrying an earlier professional claim forward.
- `Not sure` is a valid answer and never requires unsafe inspection.
- No question tells a person to climb a roof, enter a roof space, disturb insulation, remove an electrical cover or block required ventilation.
- Guided photo capture requires the customer to confirm safe ground-level access, avoidance of private or identifying material and no opening or removal of covers before camera or file selection is enabled.
- Meter-box guidance permits only a safely accessible closed exterior; it never asks the customer to open a switchboard or meter enclosure.
- New files use `private-plan` scope by default. Only files explicitly moved to `allocated-installers` with current consent can reach an allocated verified installer.
- Fact-link edits do not silently renew withdrawn installer-sharing consent.
- Installer matching excludes private files, and the installer preview counts only files marked for quoting.
- Email and print exclude exact location, account identity, project labels, filenames, private customer notes, room names and routines, customer-review text and custom plan wording.
- The optional self-declared adviser details and professional notes are the only review attribution intentionally projected into the customer report.
- Revision save, compare and restore operations require the signed-in project owner and a matching revision token.
- Restore changes only the private roadmap projection and cannot alter evidence, sharing, installer, quote or account records.
- The report is independent general guidance, not a site assessment, quote, permission decision or savings promise.

## Current acceptance criteria

- Public and signed-in previews use the same normalized privacy-filtered report content and premium hierarchy.
- The signed-in preview dialog traps forward and reverse Tab navigation, closes with Escape, locks background scroll and restores focus.
- Top and bottom plan action bars expose the same applicable controls and use the same busy-state protection.
- Guided photo capture remains optional, requires every safety and privacy confirmation and caps the pending set at 12.
- Photo categories, prompts and evidence links are deterministic and do not infer insulation or equipment facts from an unrelated image.
- Revision history is immutable, bounded and owner scoped.
- Comparison reports goals, home facts, pace, budget, plan version and step additions, removals, moves and changes.
- Restore is draft-only, confirmation gated and limited to roadmap fields.
- A typed `PLAN_REVISION_CONFLICT` triggers the explicit reload workflow; unrelated 409 business errors preserve their server message.
- Edits made while a save is in flight remain dirty and cannot be falsely reported as saved.
- PDF format `2026-07-30-tagged-plan-pdf-v3` contains document language, a structure tree, reading-order references, link objects and artifacts while making no PDF/UA claim.
- The representative eight-page A4 PDF remains readable, unencrypted, JavaScript-free and free of clipping or overlap.
- Worst-case email remains below 88,000 HTML bytes, discloses email-only shortening or omission and leaves the saved plan and PDF unchanged.
- Automated HTML retains responsive layout and the Outlook-hidden preheader; delivered Gmail and Outlook rendering remains a controlled follow-up rather than a release claim.
- Type checking, lint, 31 integration tests, the complete 850-test suite, all 85 migrations, the Vinext production build, diff hygiene, GitHub provenance and Sites provenance pass.
- Live `/plan`, `/plan/print` and `/api/health` checks pass without using a signed-in customer project.

## Current stop conditions

Stop the affected path when:

- a private file, note, room routine or exact location could enter shared or installer output;
- a fact-link edit could silently grant or renew sharing consent;
- a household answer would be represented as professionally checked without a current explicit adviser declaration;
- a self-declared adviser could be represented as credential-verified or endorsed by AEA;
- changed home or adviser details could retain an earlier professional declaration;
- a customer-plan action could invoke native print, process a pending photo, save or upload customer data, or rely on a delayed synthetic download;
- a PDF page could clip content, split an action card, orphan a heading, draw a raw URL or use unreadably small body text;
- behavioural advice could contradict the known tenure, comfort or equipment facts;
- a question would require unsafe inspection or encourage blocking required ventilation;
- a photo flow could enable capture before every safety and privacy confirmation, exceed its bound or default evidence to installer-visible scope;
- a stale revision could overwrite newer saved work, discard unsaved local edits without an explicit customer choice or restore a non-roadmap record;
- a tagged PDF could claim conformance that has not been independently tested;
- an email-only compatibility fallback could alter the saved plan or PDF, omit content without notice or claim inbox delivery;
- an email would be sent or a working-demo project would be saved during release verification;
- legacy edited plan state or plan-version provenance would be lost;
- the release commit, GitHub branch, Sites source, archive, saved version and deployment do not reconcile;
- the immutable audit would change; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

## Current release evidence

The exact application source passed:

```powershell
node --experimental-strip-types --test test/customer-plan-email-compatibility.test.mjs test/customer-plan-evidence-history.test.mjs test/customer-plan-pdf.test.mjs test/customer-plan-preview.test.mjs test/customer-plan-report-preview-dialog.test.mjs test/customer-plan-revision-restore.test.mjs test/customer-plan-revision-ui.test.mjs test/customer-plan-sharing.test.mjs test/customer-project-advisor-ui.test.mjs test/customer-project-guided-photos.test.mjs test/customer-property-arrivals.test.mjs
npm.cmd run validate
git diff --check
```

Observed results:

- focused preview, PDF, email, evidence, revision, photo and customer-project set: 73 of 73 passed;
- integration suite: 31 of 31 passed;
- complete suite: 850 tests, 848 passed, 2 intentionally skipped and 0 failed;
- type checking and warning-free lint: passed;
- migration verification: all 85 migrations through `0084_customer_plan_revision_restore.sql` passed against fresh SQLite and Cloudflare D1 paths;
- Vinext production build and `git diff --check`: passed;
- GitHub and Sites managed source branch: exact application SHA `bc427d295b3106907904a3c0b7bf9f2945561cd1`;
- Sites application version: 224, deployment `appgdep_6a6b151c0178819185e4d57c1cbf75c2`, public, environment revision 19;
- one synthetic representative report produced a 60,177-byte eight-page tagged A4 PDF; all eight pages were rendered and visually inspected for readable hierarchy, rounded surfaces, clipping, overlap and footer clearance;
- the representative responsive email was served only from a local loopback preview and inspected at desktop and 375 px widths without horizontal overflow;
- the maximum-length compatibility fixture produced 62,289 HTML bytes and 9,143 plain-text bytes, retained the full saved plan and PDF and disclosed the email-only six-step/two-tip projection;
- live `/plan` and `/plan/print` loaded with no captured console errors or horizontal overflow, and live `/api/health` returned `{"ok":true,"service":"aea-energy"}`;
- no email was sent, no customer, project or other data was mutated, and native print was not invoked; and
- delivered Gmail and Outlook acceptance and independent PDF accessibility conformance remain unverified.

## Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `bc427d295b3106907904a3c0b7bf9f2945561cd1`
- Sites application version: 224
- Sites application deployment: `appgdep_6a6b151c0178819185e4d57c1cbf75c2`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 85
- Immutable audit changes: none
- Working-demo data changed during live verification: none

## Known release risk

`npm audit --omit=dev` reports six existing production-dependency advisories: one low and five high. The current direct dependencies include Next 16.2.10 and `react-server-dom-webpack` 19.2.6; the audit proposes updates to Next 16.2.12 and `react-server-dom-webpack` 19.2.8. This was not introduced by the PDF feature and must be handled as a separate bounded dependency patch with the complete validation and live-release gates.

## Prior released milestone: `CUSTOMER-PLAN-SPACING-10`

The prior release established consistent spacing and rounded surfaces throughout the premium PDF and email. Its exact application commit was `e74c2d95889a381cb3bb434607bc6584e54cf722`, deployed as Sites version 222 through deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28`. Documentation-only child `c2599eb5bedb11b1648da2b4a60e11b242cb2abb` was later published as historical Sites version 223 without changing that executable application. Those visual contracts remain active underneath version 224.

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

1. **Controlled Gmail and Outlook inbox acceptance:** verify the responsive report in dedicated non-customer Gmail and Outlook test inboxes without using a real customer address.
2. **Independent PDF accessibility conformance audit:** test the tagged structure, reading order, links and assistive-technology behavior without claiming PDF/UA until independently verified.
3. **Photo retake, redaction and resumable upload queue:** let customers safely replace, redact and resume guided evidence uploads without weakening private-plan defaults.
4. **Revision labels, notes and selective comparison or export:** make bounded plan history easier to understand and share without broadening restore scope.
5. **Outcome check-ins and before-and-after progress evidence:** help households record completed improvements and observed comfort or usage changes without creating savings promises.
