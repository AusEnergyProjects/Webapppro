# Next task handover

Status: released milestone with the next recommendation recorded below

Prepared: 29 July 2026

Milestone ID: `CUSTOMER-HOME-ADVISOR-01`

Implementation baseline: `01a8d09022b086c771c938960efa8d9a333542d3`

Deployed application before this milestone: Sites version 203 from `01a8d09022b086c771c938960efa8d9a333542d3`

Released application: `53e6cf96aff6f48e9e393a23c4eedbeba997eb39`, live as Sites version 204

The [complete current-state audit](./audit/2026-07-21-complete-current-state/README.md) remains the immutable baseline. [RELEASE_TRUTH.md](./RELEASE_TRUTH.md) owns current status and deployment identity. [ROADMAP.md](../ROADMAP.md) owns the approved sequence.

## Milestone outcome

Replace the overcomplicated household-project intake with a clear, private and evidence-led home-energy planning flow. The customer can state several goals, identify what they know, review and edit an independent starting plan, and prepare a safe quote scope without being pushed toward a product, brand or installer.

The dedicated customer Home records tab and ownership-centre page are retired. Durable completed-project handovers, warranties, corrections, consent events and administrator governance remain because they protect historical work integrity; they are no longer presented as a separate empty customer workspace.

## User outcomes

- A customer begins with whether they own or rent, then records strata or common-property approval separately because tenure and approval authority are independent.
- A customer can choose every relevant goal instead of being forced to name one main goal.
- Detailed but optional home facts cover comfort, glazing, window coverings, insulation, draughts, ventilation, heating, cooling, hot water, cooking, solar, storage and transport.
- `Not sure` is a valid answer and help text explains unfamiliar property questions without requiring unsafe inspection.
- A broad budget band affects sequencing without promising that an upgrade fits a fixed market price.
- The starting plan is independent guidance, not a NatHERS certificate, quote, product endorsement or savings promise.
- Every plan step can be reviewed through its link, removed, reordered by drag or accessible arrow controls, or supplemented with a private custom item.
- Quote preparation separates draught-proofing, insulation, glazing, and blinds, shutters or external shading.
- One upload control explains which safe, privacy-conscious photos and documents can improve remote quoting.
- Private notes are visibly editable and never shared with trades.
- Validation guidance appears beside the action the customer selected.

## In scope

- Retire `/account/assets`, its dedicated component, customer navigation entry and obsolete route references.
- Keep the five project stages directly selectable so customers can preview what will be needed.
- Persist multiple goals while preserving the singular legacy goal projection for older rows and consumers.
- Add owner/renter tenure and separate strata/common-property approval guidance using neutral descriptions.
- Add ten goal choices, twenty-one home-condition inputs and four budget states.
- Generate a staged plan from controlled goals and home facts.
- Persist an ordered, removable and sanitized customer plan snapshot with bounded custom items.
- Keep touch, keyboard and screen-reader plan ordering available alongside drag and drop.
- Remove the household access-routine question from quote preparation and installer summaries.
- Split building-fabric work into first-class draught-proofing, insulation, glazing and window-covering categories across installer capability matching and accepted-work handoff.
- Consolidate property evidence into one upload area for JPEG, PNG, WebP and PDF files.
- Persist explicit installer-evidence sharing consent, withhold unconsented files and replace customer-authored filenames with generic evidence names before installer delivery.
- Provide safe-photo and privacy guidance for switchboards, hot water, equipment, windows, shading, draughts, vents, roof access, satellite imagery and redacted energy-use evidence.
- Add forward migration `0081_customer_project_advisor.sql` to backfill goals, retire demo budget bands and the combined fabric category across operational records, preserve all matched categories through CRM and work orders, separate legacy strata approval from tenure, force ambiguous legacy tenure back to an unanswered choice, remove occupancy and anonymise stored evidence filenames.
- Update current tests, roadmap, handover and release truth.

## Out of scope

- Issuing or representing a NatHERS assessment, certificate or formal NatHERS evidence workflow.
- Giving legal advice about tenancy, owners-corporation or heritage rules.
- Quoting market prices, guaranteeing savings or recommending a brand, product or installer.
- Asking a customer to enter a roof space, climb a roof, remove an electrical cover or block a required combustion or ventilation opening.
- Deleting durable completed-project handovers, warranties, corrections, ownership history or administrator audit records.
- Changing trade-account approval, ABN review, invoicing or provider controls.
- Changing the immutable dated audit.
- Deploying before exact source, GitHub and Sites provenance are reconciled.

## Advisor boundaries

- Use the supplied learner guide as training context, not as the controlling formal NatHERS standard.
- Say `independent home energy plan`, not `NatHERS assessment` or `NatHERS certificate`.
- Keep every recommendation product-, service- and brand-agnostic.
- Treat self-uploaded files as optional customer quote evidence, not formal NatHERS evidence.
- Separate renter-controlled portable actions from permission-dependent and fixed works.
- Never recommend sealing a vent until gas-combustion, moisture and ventilation safety are understood.
- Use the budget band only to sequence investigation and quotes. State that current quotes are required.
- Preserve `Not sure` instead of inferring unsupported property facts.
- Recommend qualified trades for insulation, glazing, electrical, gas, solar, structural and roof work.

## Data and compatibility requirements

- Add `customer_projects.goals` as JSON text and backfill it from the existing singular `goal`.
- Continue writing the singular `goal` projection for compatibility.
- Normalize and allowlist goals, home facts, budget bands and work categories at the server boundary.
- Bound plan snapshots to versioned, ordered items with controlled links and sanitized custom text.
- Never persist raw markup or arbitrary destinations from a custom plan item.
- Keep precise customer work categories in summaries.
- Preserve draught-proofing, insulation, glazing and window coverings as exact categories through opportunity allocation, installer capability review and work-order creation.
- Keep `insulation-draughts` only as a bounded legacy input that the forward migration and server normalizer split into draught-proofing and insulation.
- Require an active, versioned evidence-sharing receipt before an allocated installer can list or download any attached file.
- Do not require or expose a household access routine in submission readiness or installer summaries.

## Acceptance criteria

- No customer Home records navigation item, `/account/assets` page or dedicated ownership-centre component remains.
- All five project stages are accessible buttons and can be previewed without completing preceding stages.
- More than one goal can be selected and saved.
- Tenure and budget are collected before the plan is generated.
- Glazing, insulation, draughts, window coverings and relevant fixed systems have explicit customer inputs.
- Renter guidance includes portable or removable actions and clearly distinguishes permission-dependent work.
- Plan steps support drag ordering, accessible up and down controls, removal and a bounded custom item.
- The plan contains no redundant `create project` step and does not collapse draught-proofing and insulation into one customer item.
- Quote preparation contains no usual access-timing question.
- Draught-proofing, insulation, glazing and blinds, shutters or external shading are separate work categories.
- Exactly one file input is used for optional quote evidence.
- Stored or newly selected evidence always exposes the same explicit sharing control, and no original customer filename enters the installer payload.
- The photo checklist includes switchboard, hot-water location and clearance, heating and cooling, windows and shading, draught or vent details, safe access-hatch context, cropped satellite imagery and redacted energy-use evidence.
- Private notes are visible at desktop and mobile widths.
- A failed Continue action shows the reason inside the same action footer.
- Focused tests, database replay, `npm.cmd run validate` and the production build pass.
- The exact commit is pushed to GitHub and the Sites source repository before a saved version is created and deployed.

## Validation commands

```powershell
node --experimental-strip-types --test test/customer-project-advisor-ui.test.mjs test/customer-project-advisor.test.mjs test/customer-property-arrivals.test.mjs test/direct-trade-enquiry.test.mjs test/asset-ownership-corrections.test.mjs test/installer-crm.test.mjs test/release-integrity.test.mjs test/installer-crm-templates.test.mjs test/photo-request-templates.test.mjs test/trade-crm-assets-timeline.test.mjs test/trade-data-imports.test.mjs test/trade-form-governance.test.mjs test/trade-forms-recurring.test.mjs test/trade-handover.test.mjs test/trade-job-packets.test.mjs test/customer-photo-requests.test.mjs test/lead-validation.test.js test/direct-trade-handoff.test.mjs test/direct-trade-matching.test.mjs
npm.cmd run db:check
npm.cmd run audit:links
npm.cmd run validate
git diff --check
```

The test runner may execute a wider set than named by an npm wrapper. Report observed totals rather than assuming filtering behavior.

## Released implementation state

The customer redesign was released from exact application commit `53e6cf96aff6f48e9e393a23c4eedbeba997eb39`, based on `01a8d09022b086c771c938960efa8d9a333542d3`. Integrated focused validation passes 174 of 174 tests. The complete `npm.cmd run validate` gate passes on the exact clean release commit: type checking, warning-free lint, 32 integration tests, the full 755-test suite with 753 passed and 2 intentionally skipped, all 82 migrations against a fresh local D1 database, and the production build. Desktop and 375-pixel browser checks confirm clickable stages, multiple initially-unselected goals, renter and budget context, accurate completed-step progress, explicit Keep or Refresh handling for edited plans, one capped upload area, visible notes, split work categories, removal of access timing and validation beside Continue. The preparation guide opens without creating another project, all five deep links resolve, and the customer flow has no horizontal overflow at the checked mobile width.

GitHub and the Sites managed source branch both resolve to the exact application commit. Sites version 204 records that source provenance and is deployed publicly. Live checks return `200` for health, the new preparation guide and the signed-out project entry, `404` for the retired `/account/assets` route, and zero recent worker-error events. No real account was created or used for release verification.

## Release and stop conditions

Stop if:

- complete validation fails;
- customer-created text or links can escape the server allowlist;
- advice is represented as a formal NatHERS assessment or unsupported legal, price or savings claim;
- renter advice could encourage unauthorised fixed work;
- draught advice could conceal a combustion or ventilation safety issue;
- durable completed-project or consent evidence would be deleted;
- the release commit, GitHub branch, Sites source, archive and saved version do not reconcile;
- live inspection would require creating a real customer, trade or wholesaler account;
- the change would alter the immutable audit snapshot.

## Next five logical product steps

1. **Evidence confidence and provenance:** mark each important home fact as customer-reported, photo-supported, document-supported or unknown and show how that confidence affects advice.
2. **Postcode and climate-aware sequencing:** use a bounded Australian climate mapping to adjust the order of shading, airflow, draught, insulation and system investigations without creating a formal NatHERS claim.
3. **Room-by-room comfort profile:** capture seasonal hot, cold, draught, condensation and usage patterns only where they materially change the plan.
4. **Renter and strata permission pack:** generate a neutral, exportable list separating portable actions, requested permissions and owner or owners-corporation works.
5. **Household and assessor usability pilot:** test the full flow with representative householders and experienced assessors, then repair the highest-friction accessibility and comprehension findings.
