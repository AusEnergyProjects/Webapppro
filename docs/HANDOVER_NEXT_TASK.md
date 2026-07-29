# Next task handover

Status: released implementation milestone

Prepared: 29 July 2026

Milestone ID: `CUSTOMER-PLAN-EVIDENCE-04`

Implementation baseline: `1ffc2352638c4dbf27726c531c605aa57085d398`

Released application for this milestone: Sites version 210 from application commit `6540ee671e64dbfdf80592283a1954b2ff482355`

Current source checkpoint: the documentation-only child containing this record; it does not change the executable application identity above

Production URL: `https://compare.ausenergyassessments.com`

The [complete current-state audit](./audit/2026-07-21-complete-current-state/README.md) remains the immutable evidence baseline. [RELEASE_TRUTH.md](./RELEASE_TRUTH.md) owns released implementation status and application deployment identity. [ROADMAP.md](../ROADMAP.md) owns approved forward sequencing. The household and experienced-assessor pilot remains deliberately deferred while the five feature and advisor-rule steps recorded below are completed.

## Current milestone outcome

Make it easy for a household to describe what the home has, understand what is still unknown, correct missing details before sharing, and receive one concise independent plan without learning an internal evidence model.

The public planner and signed-in project builder now use one categorized fourteen-question home-detail taxonomy. The shared report, email dialog and print surface explain household answers in plain language and state that they have not been professionally checked.

## Current user outcomes

- A household can choose several main goals and record owner or renter tenure, approval context, budget and staging separately.
- Home questions are grouped into comfort, insulation, windows and shading, draughts and ventilation, heating and cooling, hot water and cooking, and solar, battery and electric vehicle.
- Roof, wall and underfloor insulation distinguish no known insulation, limited or older insulation, better-performing insulation, applicable dwelling constraints and `Not sure`.
- Window questions distinguish glazing quality, basic roller or Venetian blinds, mixed coverings, and close-fitting honeycomb or thermal blinds or heavy curtains with pelmets.
- A customer can mark every unanswered home question `Not sure` in one action rather than guessing.
- The email dialog reports the exact answered and remaining question counts and takes the customer directly back to the home details.
- The same concise privacy-filtered projection drives email, browser print and Save as PDF.
- Plan steps can be moved by drag, touch or keyboard controls, removed, or supplemented with bounded home-specific steps.
- New files remain private to the plan unless the customer explicitly marks them for installer sharing.
- A customer can review bounded plan revisions and private outcome check-ins without representing an observation as measured savings or professional verification.

## Current in scope

- Share one `HomeFeatureIntake` and one canonical normalizer across public and signed-in planning.
- Keep fourteen question-level readiness states while preserving the wider controlled advisor fact model.
- Treat explicit `Not sure` as authoritative over stale photo or document source labels.
- Keep plan and report generation brand, provider and service agnostic.
- Use one server-derived document projection for the email HTML, plain text, public print and signed-in print actions.
- Keep plan-email ownership, confirmation, idempotency, provider acceptance and rate-limit boundaries from the prior release.
- Add explicit `private-plan` and `allocated-installers` evidence scopes with confirmation-gated installer sharing.
- Strip JPEG, PNG and WebP metadata before any accepted image category is stored.
- Add bounded plan revisions and outcome check-ins through `0083_customer_plan_evidence_history.sql`.
- Use atomic revision numbering and per-project read and retention limits.
- Preserve legacy plan versions and edited-plan compatibility.

## Current out of scope

- The deferred household and experienced-assessor field pilot.
- Professional review, evidence verification, an authenticated assessor identity or remote assessor access.
- A formal NatHERS assessment, NatHERS certificate, energy rating, equipment sizing or legal approval.
- Brands, provider ranking, current market prices, savings promises or finance advice.
- Automated image interpretation or a requirement to photograph an unsafe area.
- Revision comparison or restore, scheduled seasonal reminders and bulk evidence-library actions. These are forward work.
- A server-side browser or binary PDF dependency. A4 print and browser Save as PDF remain the bounded PDF path.
- Real customer, trade, wholesaler or assessor account creation.
- A release-test email or mutation of a working-demo project.
- Changes to the immutable dated audit or a Netlify deployment.

## Current privacy and safety boundaries

- Household answers and linked files are not represented as assessor-authored, reviewed or verified.
- `Not sure` is a valid answer and never requires unsafe inspection.
- No question tells a person to climb a roof, enter a roof space, disturb insulation, remove an electrical cover or block required ventilation.
- New files use `private-plan` scope by default. Only files explicitly moved to `allocated-installers` with current consent can reach an allocated verified installer.
- Fact-link edits do not silently renew withdrawn installer-sharing consent.
- Installer matching excludes private files, and the installer preview counts only files marked for quoting.
- Email and print exclude exact location, account identity, project labels, filenames, private notes, room names and routines, review text and custom plan wording.
- The report is independent general guidance, not a site assessment, quote, permission decision or savings promise.

## Current acceptance criteria

- Public `/plan` and the signed-in builder render and normalize the same home-detail categories and options.
- Multiple goals, tenure, approval, budget and home details survive the public-to-account handoff.
- Answered, `Not sure` and unanswered counts are derived from the same fourteen-question contract.
- The report contains no `customer-selected source` wording and does not put evidence readiness into the ordered recommendation list.
- Email and print use the same concise projection and the email dialog exposes a direct `Review home details` correction path.
- Private-plan files cannot enter installer responses, and installer-visible copy never says that every upload is shared.
- Concurrent plan revisions cannot claim the same revision number; history responses and retention are bounded.
- Every accepted image type is metadata-stripped regardless of evidence category.
- Type checking, lint, focused tests, the full validation gate, all migrations, the production build, diff hygiene, GitHub provenance and Sites provenance pass.
- Desktop, signed-in and 390 by 844 live checks show no horizontal overflow or unreadable report content.

## Current stop conditions

Stop the affected path when:

- a private file, note, room routine or exact location could enter shared or installer output;
- a fact-link edit could silently grant or renew sharing consent;
- a household answer would be represented as professional verification;
- a question would require unsafe inspection or encourage blocking required ventilation;
- an email would be sent or a working-demo project would be saved during release verification;
- legacy edited plan state or plan-version provenance would be lost;
- the release commit, GitHub branch, Sites source, archive, saved version and deployment do not reconcile;
- the immutable audit would change; or
- a legal, privacy, regulated-service or account-ownership decision requires an authorised human.

## Current release evidence

The exact application source passed:

```powershell
node --experimental-strip-types --test test/customer-advisor-contract.test.mjs test/direct-trade-enquiry.test.mjs test/customer-plan-evidence-history.test.mjs test/customer-plan-sharing.test.mjs
npm.cmd run validate
git diff --check
```

Observed results:

- final focused privacy and report set: 27 of 27 passed;
- integration suite: 31 of 31 passed;
- complete suite: 803 tests, 801 passed, 2 intentionally skipped and 0 failed;
- type checking and warning-free lint: passed;
- migration verification: all 84 migrations passed against fresh SQLite and Cloudflare D1 paths;
- Vinext production build and `git diff --check`: passed;
- GitHub and Sites managed source branch: exact application SHA `6540ee671e64dbfdf80592283a1954b2ff482355`;
- Sites application version: 210, deployment `appgdep_6a695ca742d081918d73196751713f98`, public, environment revision 19;
- local desktop and 390 px public-plan checks passed without horizontal overflow;
- a three-page, 137,415-byte representative A4 PDF was rendered and visually inspected without clipped content;
- live public `/plan`, `/plan/print` and the signed-in five-step builder were inspected after deployment;
- the signed-in email dialog displayed `12 questions still need an answer`, `2 answered, 0 marked Not sure` and a working `Review home details` path;
- the signed-in privacy preview labelled only installer-scoped files as `Files shared for quoting`;
- no real account or project was created, no working-demo record was saved, no email was sent and no provider delivery path was exercised.

## Released implementation state

- GitHub branch: `codex/sites-custom-domain-migration`
- Application commit: `6540ee671e64dbfdf80592283a1954b2ff482355`
- Sites application version: 210
- Sites application deployment: `appgdep_6a695ca742d081918d73196751713f98`
- Production URL: `https://compare.ausenergyassessments.com`
- Sites environment revision: 19
- D1 migration count: 84
- Immutable audit changes: none
- Working-demo data changed during live verification: none

## Prior released milestone: `CUSTOMER-PLAN-DECISION-03`

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

1. **Guided safe photo capture:** place optional, safety-bounded photo guidance beside the relevant home questions without asking anyone to climb, enter a roof space or remove a cover.
2. **Revision comparison and restore:** show exactly what changed between bounded plan revisions and require an explicit customer action to restore an earlier version.
3. **Seasonal private outcome reminders:** let a household schedule private comfort, usage and cost check-ins and view trends without claiming causal savings or measured building performance.
4. **Evidence-library controls:** add bounded bulk retag, delete, sharing-scope and completeness controls while keeping private-plan material owner-only by default.
5. **Advisor-rule scenario QA:** exercise the controlled advisor rules against representative NatHERS learner-guide cases before the deferred household and experienced-assessor pilot, without representing the result as a NatHERS assessment.
