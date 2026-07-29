# AEA Energy and TLink forward roadmap

Status: current

Roadmap owner: product owner

Engineering owner: technical lead

Last reconciled: 29 July 2026

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

All acceptance gates above are met for the released application source. No account or project was created, no working-demo record was saved, no email was sent and no provider delivery path was exercised during live verification.

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

1. **Guided safe photo capture:** place optional, safety-bounded photo guidance beside the relevant home questions without asking anyone to climb, enter a roof space or remove a cover.
2. **Revision comparison and restore:** show exactly what changed between bounded plan revisions and require an explicit customer action to restore an earlier version.
3. **Seasonal private outcome reminders:** let a household schedule private comfort, usage and cost check-ins and view trends without claiming causal savings or measured building performance.
4. **Evidence-library controls:** add bounded bulk retag, delete, sharing-scope and completeness controls while keeping private-plan material owner-only by default.
5. **Advisor-rule scenario QA:** exercise the controlled advisor rules against representative NatHERS learner-guide cases before the deferred household and experienced-assessor pilot, without representing the result as a NatHERS assessment.

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
