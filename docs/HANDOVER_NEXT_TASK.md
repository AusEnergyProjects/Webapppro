# Next task handover

Status: released implementation milestone

Prepared: 30 July 2026

Milestone ID: `CUSTOMER-PLAN-SPACING-10`

Implementation baseline: `6fe4d9e92aba20e576376a4fef4e296bb8bc3dc1`

Released application for this milestone: Sites version 222 from application commit `e74c2d95889a381cb3bb434607bc6584e54cf722`

Current source checkpoint: the documentation-only child containing this record; it does not change the executable application identity above

Production URL: `https://compare.ausenergyassessments.com`

The [complete current-state audit](./audit/2026-07-21-complete-current-state/README.md) remains the immutable evidence baseline. [RELEASE_TRUTH.md](./RELEASE_TRUTH.md) owns released implementation status and application deployment identity. [ROADMAP.md](../ROADMAP.md) owns approved forward sequencing. The household and experienced-assessor pilot remains deliberately deferred while the five feature and advisor-rule steps recorded below are completed.

## Current milestone outcome

Give a household or self-declared accredited adviser one distinctive, high-end technical home energy presentation in PDF and email, with the exact AEA mark, easy-to-scan priorities, truthful completion status, readable plain language, deliberate spacing and soft brand-consistent corners.

The release keeps the proven browser-native, non-mutating PDF attachment path and the shared privacy-filtered report projection. It retains the exact AEA navigation mark and technical hierarchy while applying one measured spacing scale to every repeated card, clipping PDF gradients to rounded paths, separating email comfort advice into individual rounded tiles and retaining the exact household or self-declared professional evidence boundary once.

## Current user outcomes

- A customer can continue to prepare the plan as household-supplied information with no professional claim.
- A person preparing the plan can self-declare one of the two controlled adviser roles and record a name, accreditation scheme or body, reference and bounded professional notes.
- The preparer must explicitly confirm a current self-declaration before the report identifies the home answers as reviewed by the named self-declared adviser.
- Changing a goal, home answer, room profile, plan input or adviser detail removes the declaration and requires a fresh confirmation.
- The customer report identifies the self-declared adviser while stating that Australian Energy Assessments did not independently verify the person, accreditation, reference or observations.
- Public and signed-in plans show a separate `Helpful things you can try now` section rather than mixing behavioural advice into the ordered upgrade roadmap.
- Controlled helpful actions cover appliance controls and timers, moisture and ventilation, personal warmth such as layers, slippers and electric throws, safe seasonal airflow, window coverings and landscaping, and renter-friendly or bounded do-it-yourself options.
- Positive-only triggers prevent cold-weather, cooling or renter-specific advice from appearing when the recorded facts do not support it.
- Email, public PDF and signed-in PDF use the same privacy-filtered document projection, customer wording and section order.
- Public and signed-in PDF actions use one browser-native attachment request with a short duplicate-click guard and no account mutation.
- PDF and email use the site's deep navy, electric blue, teal, aqua, green, mint and warm warning palette with readable technical hierarchy and customer-scale body copy.
- PDF information, priority, roadmap, snapshot and comfort cards use one measured spacing scale with rounded clipped backgrounds, inset accents and soft number badges.
- Email sections use consistent desktop and mobile breathing room, rounded outer and feature panels, 16 px tile gaps and separate nested comfort-advice tiles.
- Mobile snapshot cells retain a visible 12 px gap instead of touching when stacked.
- The exact 96 by 96 AEA navigation mark is embedded directly in the PDF and served to email from `https://compare.ausenergyassessments.com/api/aea-brandmark`.
- The report leads with a stronger branded cover, plan signals and one lead home fact, then separates the remaining snapshot, first unfinished actions, later work, everyday ideas, climate context, plan confidence, professional attribution, trade checks and privacy.
- Allowlisted guide labels are real same-origin PDF annotations; raw URLs are not drawn into the report.
- Long adviser names, references and notes wrap safely, and a fully completed plan reports every current step complete and zero left to plan instead of inventing a next action.
- The exact household-supplied or self-declared professional evidence boundary appears once in the PDF and is not weakened or duplicated.
- The PDF format version is `2026-07-30-tech-presentation-pdf-v2`, the shared design version is `2026-07-30-tech-presentation-design-v2`, and the report version remains `2026-07-29-premium-report-v3`. The plan remains `2026-07-29-adviser-print-comfort-v3`, the adviser profile remains `2026-07-29-advisor-profile-v4`, the declaration remains `2026-07-29-self-declared-adviser-v1`, and the document remains `2026-07-29-plan-document-v2`.

## Current in scope

- Share one exact AEA brandmark source between live navigation, the PDF and the immutable public PNG endpoint used by email.
- Apply one technical visual system to the PDF and responsive email without changing the normalized report facts.
- Centralise PDF and email spacing, padding and radius tokens instead of allowing local one-off geometry to drift.
- Clip gradient-backed PDF panels to curved cubic-Bezier paths and use the same rounded primitive for opaque panels and badges.
- Keep email presentation-table compatibility while rounding the shell, feature panels, normal tiles and adviser inset.
- Remove transport-only HTML whitespace so the richer maximum-content email stays below the existing 60,000-byte guard.
- Give the cover stronger brand lockup, plan signals and completion-aware counts.
- Lead the home snapshot with one readable primary fact and keep the remaining facts compact.
- Highlight the first three unfinished actions before the remaining ordered roadmap, or show all steps complete with zero left to plan.
- Keep recommendation cards together across A4 page breaks and give every content page a section header plus page count.
- Use standard built-in PDF fonts and the in-source PNG so the edge response avoids browser font, image-fetch or worker dependencies.
- Render guide text as customer-friendly labels with real same-origin annotations and no raw visible URL.
- Keep email table based, inline styled, 640 px wide on desktop and stacked at narrow widths.
- Preserve the exact self-declared or household evidence boundary once instead of repeating it in multiple sections.
- Preserve the bounded same-origin PDF route, response limits, no-store headers and synchronous native form download.
- Keep project saving, pending-photo preparation and evidence upload entirely outside the PDF action.
- Preserve existing email ownership, confirmation, idempotency, provider acceptance and rate-limit controls.
- Preserve legacy edited plan ordering, removals, custom steps and earlier plan versions through the existing conflict boundary.
- Make no schema or migration change for this milestone.

## Current out of scope

- The deferred household and experienced-assessor field pilot.
- Independent credential or accreditation verification, an authenticated assessor identity, remote assessor access or evidence verification by AEA.
- A formal NatHERS assessment, NatHERS certificate, energy rating, equipment sizing or legal approval.
- Brands, provider ranking, current market prices, savings promises or finance advice.
- Automated image interpretation or a requirement to photograph an unsafe area.
- The legacy on-page `/plan/print` preview redesign, dedicated Gmail and Outlook inbox testing, tagged-PDF accessibility, guided photo capture and revision restore. These are forward work.
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
- New files use `private-plan` scope by default. Only files explicitly moved to `allocated-installers` with current consent can reach an allocated verified installer.
- Fact-link edits do not silently renew withdrawn installer-sharing consent.
- Installer matching excludes private files, and the installer preview counts only files marked for quoting.
- Email and print exclude exact location, account identity, project labels, filenames, private customer notes, room names and routines, customer-review text and custom plan wording.
- The optional self-declared adviser details and professional notes are the only review attribution intentionally projected into the customer report.
- The report is independent general guidance, not a site assessment, quote, permission decision or savings promise.

## Current acceptance criteria

- Household-only reports retain household-supplied wording and make no professional claim.
- A complete current adviser declaration changes only the intended attribution and professional-note sections.
- Missing, stale or incomplete declarations fail at the server boundary, and advice-affecting changes require renewed confirmation.
- Professional report copy names the self-declared adviser and clearly disclaims AEA credential and evidence verification.
- Everyday actions are deterministic, bounded, product-neutral and separate from the ordered upgrade plan.
- Cold, hot, tenure and equipment triggers do not produce contradictory advice.
- Email HTML, plain text, public PDF and signed-in PDF use the same normalized report projection and content hierarchy.
- Customer-plan delivery has no native print, iframe, `afterprint`, client worker, Blob URL or synthetic-link path and performs no project or evidence mutation.
- Account and project HTML is excluded from shared caching and returns `private, no-store, max-age=0`.
- Representative maximum-content, long-professional-note and Unicode A4 reports wrap safely, keep cards together and retain readable contrast.
- Every repeated PDF panel measures the same internal gaps it draws, clips gradient corners and preserves footer clearance across page breaks.
- Email uses 40 px desktop and 32 px mobile section spacing, 16 px tile gaps, rounded presentation-table surfaces and a visible mobile snapshot gap.
- Maximum-content email remains below 60,000 bytes without dropping content or weakening inline client-safe styles.
- PDF annotations are same-origin, raw URLs remain hidden, and fully completed plans have no empty priority section.
- The PDF contains the exact AEA mark without a runtime image fetch, and email references only the exact first-party HTTPS mark endpoint.
- The household or professional evidence boundary appears exactly once in the PDF.
- A completed report states every current step is complete and reports zero left to plan without inventing a next step.
- Automated email HTML retains the same hierarchy at narrow widths; delivered Gmail and Outlook rendering remains a controlled follow-up rather than a release claim.
- Type checking, lint, focused tests, the full validation gate, all migrations, the production build, diff hygiene, GitHub provenance and Sites provenance pass.
- The live plan and brandmark routes return valid public responses and are visually inspected without using a signed-in customer project.

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
- an email would be sent or a working-demo project would be saved during release verification;
- legacy edited plan state or plan-version provenance would be lost;
- the release commit, GitHub branch, Sites source, archive, saved version and deployment do not reconcile;
- the immutable audit would change; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

## Current release evidence

The exact application source passed:

```powershell
node --experimental-strip-types --test test/customer-plan-sharing.test.mjs test/customer-plan-pdf.test.mjs test/site-navigation.test.mjs test/customer-project-advisor-ui.test.mjs
npm.cmd run validate
git diff --check
```

Observed results:

- focused final report, PDF, email, brand, navigation and customer-project set: 56 of 56 passed;
- integration suite: 31 of 31 passed;
- complete suite: 826 tests, 824 passed, 2 intentionally skipped and 0 failed;
- type checking and warning-free lint: passed;
- migration verification: all 84 migrations passed against fresh SQLite and Cloudflare D1 paths;
- Vinext production build and `git diff --check`: passed;
- GitHub and Sites managed source branch: exact application SHA `e74c2d95889a381cb3bb434607bc6584e54cf722`;
- Sites application version: 222, deployment `appgdep_6a6a8887a0048191b7eb1706e742ad28`, public, environment revision 19;
- one synthetic representative report produced a 47,059-byte seven-page A4 PDF; all seven pages were rendered and visually inspected for card spacing, rounded clipping, section transitions and footer clearance;
- the matching 42,249-byte email was served only from a local loopback preview and inspected through its priority, roadmap, comfort, climate, confidence, trade and privacy sections;
- automated regressions confirm the narrow-width mobile snapshot gap, reduced mobile section spacing, rounded shell and tiles, and the maximum-content 60,000-byte cap;
- live `GET /api/aea-brandmark` returned `200`, `image/png`, `Cache-Control: public, max-age=31536000, immutable`, 3,595 bytes and a valid PNG signature, and the browser showed the exact 96 by 96 mark;
- live `/plan` returned `200`, 54,406 bytes and was visually inspected;
- the post-deployment Sites error-only query returned zero events;
- no email was sent, no customer, project or other data was mutated, and native print was not invoked; and
- delivered Gmail and Outlook acceptance remains unverified and is retained as the second next step.

## Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `e74c2d95889a381cb3bb434607bc6584e54cf722`
- Sites application version: 222
- Sites application deployment: `appgdep_6a6a8887a0048191b7eb1706e742ad28`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 84
- Immutable audit changes: none
- Working-demo data changed during live verification: none

## Known release risk

`npm audit --omit=dev` reports six existing production-dependency advisories: one low and five high. The current direct dependencies include Next 16.2.10 and `react-server-dom-webpack` 19.2.6; the audit proposes updates to Next 16.2.12 and `react-server-dom-webpack` 19.2.8. This was not introduced by the PDF feature and must be handled as a separate bounded dependency patch with the complete validation and live-release gates.

## Prior released milestone: `CUSTOMER-PLAN-TECH-PRESENTATION-09`

The prior release established the exact-brand technical presentation, truthful completed-plan signals and single household or professional evidence boundary. Its exact application commit was `f401575a5bf463b85c7688424db0b99dddd220c5`, first deployed as Sites version 220 through deployment `appgdep_6a6a265a51108191bdc8ae6a4eefbf8f`. Those contracts remain active underneath the version 222 spacing and rounded-surface refinement.

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

1. **Premium on-page report preview:** align the legacy `/plan/print` preview with the shared premium PDF and email hierarchy without changing the native download path.
2. **Controlled Gmail/Outlook acceptance:** verify the responsive report in dedicated Gmail and Outlook test inboxes, add honest provider acceptance visibility and never use a real customer address.
3. **Accessible/tagged PDF structure:** add document landmarks, reading order and assistive-technology checks while preserving the lightweight edge renderer.
4. **Guided safe photo capture:** place optional, safety-bounded photo guidance beside the relevant home questions without asking anyone to climb, enter a roof space or remove a cover.
5. **Revision comparison and restore:** show exactly what changed between bounded plan revisions and require an explicit customer action to restore an earlier version.
