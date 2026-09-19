# Creditex onboarding and activity training implementation

Implementation validated in `C:/Webproject/aea-energy-creditex-onboarding`, branch `codex/creditex-activity-onboarding`, against base `a0194a5fb1da1746635581f0dbf2e6889eea8123`. Initial implementation was committed as `ddd315547b29597a4c227aca545282fdd9ce4656`. On 19 September 2026 the user authorised publishing the complete training, online learning and compliance feature. The source identity for this follow-up is the Git commit containing this report; publication success is verified separately against the hosted revision. No application submissions or external messages are part of this release.

## Guided answers and editable questionnaires, 19 September 2026

This follow-up starts from live Sites 581 source `0db8ca5f301f96c1c1af234688dacdae3a2d7710`. Both Admin and Creditex portals now have Compliance questions: edit question text, answer choices, correct answer, explanations, lessons and resources; save a private draft; publish a version; or create an additional activity questionnaire scoped to a service and served states. A published version takes effect automatically. Additional forms require training without inventing a government calculation pathway.

Learners check each answer immediately. A wrong answer explains the correct choice and blocks the next question until corrected. Checked answers persist on the authenticated personal attempt; final completion requires every question correct. The result retains both final 100% and first-answer percentage. Final submission is replay-safe, and all web authentication, request and JSON-reading stages have a 25-second bound with retryable errors. A saved result is shown even if the subsequent status refresh fails.

Migration 0179 stores immutable published versions and exact completed question/answer/correction/source snapshots. Authorised portal staff can browse these under Trade compliance profiles; each learner can see their own saved forms. Current version, service/state, withdrawal, expiry, individual identity and genuine external credential checks remain enforced. Publishing a changed form requires the new version; earlier submissions remain intact. Shared question wording is simplified, and the generated activity-specific questions now have one valid requirement and clearly different wrong actions.

Validation includes guided learner and editor UI tests, real SQLite authoring/eligibility/privacy/race/retry tests, all 179 migrations, project typecheck/lint, 251 mobile tests and Android/iOS exports. The full 4,720-test run found outdated migration fixtures, one missing fixture dependency and excessive inline lead-query complexity; those are corrected and rerun in the affected suites. The existing unrelated visible-brand-name failure remains outside scope. Browser fixtures verified edit/save/publish and wrong-answer/correction/submission. Production build and exact GitHub/Sites/Android publication evidence are recorded by the coordinating release task after commit.

## Self-service assessment and onboarding follow-up, 19 September 2026

The current follow-up removes routine manual curriculum activation. Source-complete courses can start after all lessons are marked read, and a server-scored 100% pass automatically supplies the individual training requirement. The last lesson has a clear readiness cue. Percentage results, unlimited retakes, exact content version/hash, personal references, expiry and explicit revocation remain enforced. The internal source-review notebook is excluded from learner resources and assessment feedback.

Business served states are now editable independently from postcode/radius coverage. Explicit canonical served states determine relevant state courses and current programme lead/booking eligibility; address state is a fallback only for legacy accounts without valid selections. A VIC-only business receives relevant Victorian and national courses. A multi-state business receives each relevant jurisdiction's courses. Existing saved choices are not silently changed.

Business intake has one Complete business setup action, which saves pending changes before validation. A complete submission creates its own revision-bound completion receipt without inventing a reviewer decision. Private signed-agreement evidence, current insurance, required identity/licence documents and an explicit compliance declaration remain required. Evidence byte/hash and owner checks establish supplied files, not the authenticity of identity or signatures. Changing business identity, revising the application, missing required evidence, expiry or an explicit suspension prevents the stale receipt from granting eligibility.

The user will supply the actual Creditex agreement and registry/e-sign service details later. The agreement step therefore includes a clearly labelled placeholder; it never counts as a signed agreement. Details can be saved and training completed now. The existing authoritative ABN access review and actual external Activity 48 credential checks remain unchanged pending real verification integrations. Full autonomous identity or legal signature verification is not claimed.

Forward migrations 0177 and 0178 replace the affected live eligibility projections and add business completion receipts while preserving deployed 0176 and existing evidence. The curriculum version is 2026-09-19.1; learning wording now reflects automatic completion rather than a manual approval promise.

Follow-up verification: the full suite with four concurrent test processes ran 4,684 tests: 4,672 passed, 11 skipped and the unchanged visible-brand-name assertion failed. All onboarding, assessment, state, booking, lead and migration regressions passed. Project typecheck and lint passed, as did the validation pipeline's source/education/quality/community/continuity audits and 37 integration tests. Native tests passed 250/250, with Android/iOS Hermes exports and native typecheck/lint verified. Fresh D1 replay covered all 178 migrations; the PDF audit passed. Publication build, remote source and live assessment-start verification are checked by the coordinating release task, after this record is committed. Logs are retained under `C:/Webproject/tmp/creditex-autonomous-*`.

## Team to-do and service selection follow-up

Business and Team now use the same 25-service catalogue. Canonical unique selections determine the displayed count, including supported legacy mappings; the separate AEA-only lead-routing restrictions remain enforced. Member details display training to-dos directly below Services and refresh after a successful save. Managers can view a named, active member's tasks within their business, including roster-only members, but cannot submit assessments for them. Personal service selection assigns learning even before the business offers that service; programme booking and lead checks still require the business service and approvals. The main menu is **To do & training**, with unfinished tasks shown first and completed references available under Passed.

Follow-up checks include real SQLite scope/identity tests, business service round-trip and protected-routing tests, Team save/refresh UI tests, typecheck, lint and all 176 fresh D1 migrations. Desktop/mobile day/night fixtures verified that saving a member's changed services refreshes their tasks once, preserves individual assessment identity, and displays passed references. Final release checks and hosted verification are recorded in `C:/Webproject/tmp/creditex-todo-*` logs. The unchanged brand-copy assertion documented below remains outside this feature's scope.

The final follow-up full suite ran 4,637 tests: 4,625 passed, 11 skipped and the one unchanged brand-copy failure. Whole-project typecheck and lint passed. Focused backend checks passed 46 tests, including actual member service saves before business enablement, legacy alias study scope, individual assessment identity and continued booking denial. Final UI integration review found no release blocker.

Live verification of Sites version 579 confirmed training tasks, Activity 6 learning material, member to-dos and the 25-service list. It identified an initial sign-in reset that replaced a direct training URL with Work. The follow-up preserves the validated requested workspace after initial private-state clearing; account switches and sign-out still reset and scrub protected navigation. All 37 focused dashboard/calculator/privacy tests, typecheck and scoped lint passed for this correction. The Android preview update was published from `d0dd32b37c0ab9bce1f38c4d9f7aacfb24aaaf5c` on runtime `1.0.1`; the subsequent navigation correction changes web code only.

## Outcome and acceptance boundary

The software now includes Creditex business onboarding, individual activity training, a reviewer workspace, mandatory programme evidence and server-enforced booking/lead eligibility. Every one of the **217 defined catalogue activities** has a distinct module with **25 questions**, giving **5,425 questions** across **33 programmes with activity definitions**. The catalogue has 35 programme records; HEUF and SHEPI are funding/umbrella records without standalone installer activity definitions. No artificial activity codes were invented for them. The full programme/activity inventory is in `creditex-training-source-review.md`.

Every module gives a percentage result after submission, requires **100% correct**, and permits **unlimited immediate retakes**. Intended study and assessment time is 20-30 minutes, not a forced timer. A pass has a unique internal training reference, exact content digest and expiry. It does not assert government accreditation, practical competency, job eligibility or certificate creation.

**Assessment availability:** 209 modules have source facts transcribed and are available without manual curriculum approval. Eight contain unresolved conflicts in official material and cannot be activated: ACT EEIS 1.9, 2.4, 4.1, 5.4 and 5.6; SA REPS TOU1 and VPP1; WA Battery Rewards. Closed/future programme states remain blocked regardless of a quiz result. Software coverage of the catalogue is not a claim that every Australian government scheme has been independently certified as complete.

## Implemented behaviour

- Business setup and settings contain the Creditex application based on the supplied Jotform: business/director/guarantor/witness information, conditional NSW licensing, insurance and private evidence uploads. A real signed partnership agreement and the required declarations/evidence are recorded in the automatic completion receipt. Existing explicit governance suspensions remain enforceable.
- Web owner/team portals and the native PIN/device-bound mobile app include activity learning, official resource links, assessment, percentage, retry and completion references. Owners/managers can inspect relevant team status. A member switching between web and PIN sessions can replace an unfinished attempt without inheriting the other session's answer tokens.
- Creditex's **Onboarding & training** workspace supports business review, exact-version curriculum approval, withdrawal, completion revocation and verified Activity 48 external credentials. It requires the existing verified governance identity and authorised role.
- A service checkbox declares scope. It does not grant programme authority. The business owner, booking actor and assigned installer require current applicable quiz passes; business identity, current signed-agreement evidence, insurance, programme state, jurisdiction, capabilities, course version and revocation are rechecked at server mutation time.
- Activity 48 also verifies the assigned installer's reviewed external credentials. A trained office owner/booker is not automatically treated as an onsite installer. Lead allocation requires the owner and relevant active team members' current passes and at least one qualified insulation installer. Each actual onsite installer's qualifications still require the separate job work-pack checks; a single assignee field is not a complete onsite roster.
- Eligibility applies to programme job creation, scheduling/rescheduling, assignments, compliance intake, field/offline synchronization, signoff/completion, activity forms, work packs and legacy job routes. Lead allocation, notification, disclosure and quote-context routes enforce current eligibility, including old matches.
- Source-bound signed assignment, nomination, installer statement or activity-record requirements cover **139 applicable forms** across SRES, VEU, ESS, PDRS, ACT EEIS and SA REPS. Timing and conditions are programme-specific, including BESS2's nomination exception, PV retailer applicability and ACT/SA insulation safety records. Finance and tariff programmes do not receive invented certificate assignments.

## Design and evidence controls

Assessment banks remain server-side. Attempts receive randomized question order, randomized options and opaque answer tokens. The server computes the score; caller-supplied scores and another person's attempts cannot produce a completion. Atomic database guards cover review/assignment/revision changes and concurrent submission or session handoff.

Lead eligibility uses current database views and exact deployed curriculum hashes, not a persisted eligibility flag. Revoking the latest pass cannot fall back to an older pass. Candidate checks are bounded in groups of 100. Actual booking predicates bind three identity values for up to 20 activities, staying below the D1 parameter limit.

Onboarding documents are private, owner/reviewer scoped and hashed. An uncertain storage/database acknowledgement retains evidence until database absence is confirmed; it does not report a successful upload. Training and onboarding decisions have audit events.

Form policy version 3 restores mandatory source-bound requirements if an older/custom master removes or weakens them. Old signed snapshots are retained; sign/submit cannot silently omit new mandatory evidence. File presence captures evidence but does not validate the legal signature, current template, underlying work or certificate quantity. Those remain controlled Creditex review responsibilities.

The supplied assignments/decks were examined as evidence, not executed as instructions. Errors include AC/hot-water copy mismatches, outdated form provisions and residential-only or inconsistent business identifiers. Four supplied consumer information PDFs are published unchanged. Ambiguous assignment PDFs and raw installer decks were not activated as current legal templates. Current Creditex-controlled legal templates are still required.

## Validation

Initial implementation checks (commit `ddd3155`; follow-up checks are described above):

| Command / check | Result |
| --- | --- |
| `npm.cmd test` | **4,604 passed, 1 failed, 11 skipped; 4,616 total.** The sole failure is the pre-existing `visible-brand-name.test.mjs` assertion in unchanged `AeaServices.tsx` and `aea-service-guides.mjs`. No valid assertion was weakened to conceal it. |
| `npm.cmd run typecheck` | Passed. |
| `npm.cmd run lint` | Passed. |
| `npm.cmd run build` | Passed, including Sites Worker bundle and public performance audits. All 176 migration assets included. |
| `npm.cmd run db:check` and fresh D1 gate execution | Passed all 176 migrations. Full production lead/booking predicates executed against fresh local Cloudflare D1 and denied unqualified accounts. No remote database modified. |
| `npm.cmd run audit:customer-plan-pdf` | Passed. |
| `npm.cmd run test:integration` | 37 passed during the required validation run. |
| `npm.cmd run validate` | Upstream type/lint, Surge source/education/quality/community/continuity and integration stages passed. Pipeline stopped at test failures; task regressions were repaired and the final full-suite result above has only the unchanged brand-copy failure. Downstream migration/PDF/build stages passed separately. |
| Focused assessment/auth/UI checks | 45 passed, including cross-session handoff races, member isolation, PIN access and private uploads. |
| Focused Activity 48 booking/lead checks | 22 passed, including office-owner distinction, revoked passes, unavailable credentials, current capability and bounded candidate checks. |
| Native mobile tests | 248 passed; mobile typecheck and focused lint passed. |
| Expo Android and iOS Hermes exports | Passed. No app/OTA release performed. |
| Browser visual/interaction fixtures | Desktop/mobile, day/night, catalogue paging/filtering, lessons, 25-question assessment, 96% failure, retry and 100% pass/reference checked. Native training screen exercised through React Native Web at 320/390px. No physical-device or emulator run. |
| `git diff --check` | Passed. |

Logs are retained outside the worktree in `C:/Webproject/tmp/`: `creditex-release-full-test.log`, `creditex-release-checks.log`, `creditex-release-build.log`, `creditex-final-d1-query-v2.log`, `creditex-final-pdf-audit.log`, `creditex-training-final-focused.log`, `creditex-installer-scope-tests.log`, `creditex-mobile-tests.log` and `creditex-mobile-export.log`. Browser screenshots are in `creditex-ui-qa/` and `creditex-mobile-ui-qa/` there.

## Cleanup and remaining work

Removed inappropriate battery-specific evidence from STC hot-water forms and deduplicated equivalent source-bound document uploads while preserving existing field keys. Reused current auth, private storage, forms, migration and UI patterns; no new production dependency or alternate authentication framework was added. Test harnesses now provide actual reviewed qualification records instead of bypassing the gate. Temporary scripts, source captures, logs and browser fixtures remain outside the worktree.

Remaining external inputs are the actual Creditex agreement and authoritative verification/signing integrations, corrected controlled job templates, and resolution of the eight source conflicts. Routine course or intake approval is no longer required. Publication is authorised; its outcome is verified separately against this source revision. Physical-device verification remains outstanding. The unchanged brand-copy test failure also prevents reporting a fully green repository validation suite.

## Exact changed-file inventory

The inventory includes task-owned implementation, schema/migrations, learner and reviewer UI, source facts/resources, tests and this report, relative to the base above.

```text
db/schema.ts
docs/creditex-onboarding-implementation.md
docs/creditex-training-source-review.md
drizzle/0176_creditex_onboarding_training.sql
mobile/src/app/(tabs)/_layout.tsx
mobile/src/app/(tabs)/training.tsx
mobile/src/lib/training.ts
mobile/test/activity-training.test.mjs
public/creditex-resources/creditex-source-review.md
public/creditex-resources/creditex-training-operating-policy.md
public/creditex-resources/veu-consumer-rights-april-2024.pdf
public/creditex-resources/veu-space-heating-consumer-factsheet-v1.pdf
public/creditex-resources/veu-statement-of-rights.pdf
public/creditex-resources/veu-water-heating-consumer-factsheet-v1.pdf
scripts/validate-creditex-certificate-activation.mjs
src/app/api/admin/opportunities/matches/route.ts
src/app/api/creditex-onboarding/route.ts
src/app/api/creditex-training-governance/route.ts
src/app/api/customer-project-evidence/route.ts
src/app/api/field/job-activities/route.ts
src/app/api/public-plan-quote-preparation/route.ts
src/app/api/trade-activity-forms/route.ts
src/app/api/trade-compliance/route.ts
src/app/api/trade-crm/route.ts
src/app/api/trade-enquiries/route.ts
src/app/api/trade-field-work/route.ts
src/app/api/trade-job-notifications/route.ts
src/app/api/trade-opportunities/route.ts
src/app/api/trade-opportunity-plan/route.ts
src/app/api/trade-profile/route.ts
src/app/api/trade-schedule/route.ts
src/app/api/trade-team/route.ts
src/app/api/trade-team/sync/route.ts
src/app/api/trade-training/route.ts
src/app/api/trade-work-orders/route.ts
src/components/CreditexCompliancePortal.tsx
src/components/CreditexOnboardingReviewWorkspace.tsx
src/components/DirectTradeDashboard.tsx
src/components/DirectTradePartnerForm.tsx
src/components/TeamTrainingTodos.module.css
src/components/TeamTrainingTodos.tsx
src/components/TradeBusinessSettingsWorkspace.tsx
src/components/TradeTeamPortal.tsx
src/components/TradeTeamSettings.module.css
src/components/TradeTeamSettings.tsx
src/components/TradeTrainingWorkspace.module.css
src/components/TradeTrainingWorkspace.tsx
src/data/creditex-current-work-pack-content.ts
src/data/creditex-non-certificate-work-pack-content.ts
src/data/creditex-training-act-facts.ts
src/data/creditex-training-activity-profiles.ts
src/data/creditex-training-administrative-facts.ts
src/data/creditex-training-curriculum.ts
src/data/creditex-training-national-facts.ts
src/data/creditex-training-nsw-boundary-facts.ts
src/data/creditex-training-nsw-technical-facts.ts
src/data/creditex-training-supplemental-facts.ts
src/lib/australian-government-program-catalogue.ts
src/lib/creditex-activity-work-pack-server.ts
src/lib/creditex-onboarding-api.ts
src/lib/creditex-onboarding-server.ts
src/lib/energy-service-catalogue.mjs
src/lib/opportunity-notification-server.ts
src/lib/opportunity-server.ts
src/lib/public-lead-quote-workflow-server.ts
src/lib/trade-activity-forms-library.ts
src/lib/trade-activity-forms-server.ts
src/lib/trade-certificate-eligibility.ts
src/lib/trade-certificate-leads.ts
src/lib/trade-schedule-server.ts
src/lib/trade-training-server.ts
test/aea-trade-routing.test.mjs
test/appointment-rescheduling.test.mjs
test/creditex-activity-work-pack-runtime.test.mjs
test/creditex-calculation-coverage.test.mjs
test/creditex-certificate-activation-gate.test.mjs
test/creditex-current-work-pack-content.test.mjs
test/creditex-intake-assignment-race.test.mjs
test/creditex-manual-evidence-lab.test.mjs
test/creditex-non-certificate-work-pack-content.test.mjs
test/creditex-onboarding-training.test.mjs
test/creditex-onboarding-upload.test.mjs
test/creditex-readiness-api.test.mjs
test/creditex-sourced-work-pack-drafts.test.mjs
test/creditex-training-curriculum.test.mjs
test/creditex-veu-pilot.test.mjs
test/creditex-work-pack-governance-readiness.test.mjs
test/direct-trade-dashboard.test.mjs
test/field-job-activities.test.mjs
test/helpers/creditex-training-fixture.mjs
test/helpers/creditex-training-sql.mjs
test/opportunity-notification-delivery.test.mjs
test/public-lead-accepted-disclosure.test.mjs
test/public-plan-quote-preparation.test.mjs
test/public-trade-lead-contact-release.test.mjs
test/team-training-todos.test.mjs
test/trade-accepted-lead-field-context.test.mjs
test/trade-activity-assignment-evidence.test.mjs
test/trade-activity-forms-security-review.test.mjs
test/trade-activity-master-publication.test.mjs
test/trade-activity-report-route.test.mjs
test/trade-business-profile-settings.test.mjs
test/trade-business-service-selection.test.mjs
test/trade-dashboard-training-deep-link.test.mjs
test/trade-certificate-leads.test.mjs
test/trade-creditex-job-intent.test.mjs
test/trade-crm-appointment-assignment.test.mjs
test/trade-crm-quick-commercial.test.mjs
test/trade-field-job-creation-mobile.test.mjs
test/trade-field-work-compliance-completion.test.mjs
test/trade-guided-job-setup.test.mjs
test/trade-job-review-ux.test.mjs
test/trade-leads-read-resilience.test.mjs
test/trade-mobile-sync-integrity.test.mjs
test/trade-online-terminal-guards.test.mjs
test/trade-opportunities-interest-notification-route.test.mjs
test/trade-phone-first-field-job.test.mjs
test/trade-schedule-batch-mutations.test.mjs
test/trade-scheduled-activity-customer-documents.test.mjs
test/trade-team-lifecycle-route.test.mjs
test/trade-team-simplification-route.test.mjs
test/trade-training-workspace.test.mjs
```
