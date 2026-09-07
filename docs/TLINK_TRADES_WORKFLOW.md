# TLink trades workflow

Implementation brief agreed on 7 September 2026. Build on the existing TLink field app, trade portal and Creditex work-pack engine. The workflow diagram and supplied forms are examples, not regulatory authority. No customer details, signatures or private report tokens from those examples belong in source control.

The owner confirmed that existing jobs and portal records are test data and commercial launch is still ahead. Do not interpret those records as active customer work or delete audit/source history without a specific cleanup request.

## Daily workflow

1. Capture or select the customer and property once. Choose the work and any certificate activities, then schedule and assign within the worker's Team permissions.
2. Open the job to Call, Get directions and a short list of forms. Each activity/form has its own persistent identifier, progress, answers, evidence and final document. Open one form at a time. Keep Previous, Next and a return to the job available without losing saved work.
3. Prefill only authoritative customer, property, job and provider values. Use grouped questions, explicit yes/no answers, constrained choices and capture buttons beside the evidence requirement. Missing answers, unsynchronised files and validation failures must remain visible.
4. Retain original evidence bytes, their digest, capture/upload times and separate location provenance. Never manufacture GPS, time or signatures. When a scheme requires GPS in original photo metadata, a caption or separately recorded device location is not sufficient.
5. Show the exact declaration and signer capacity before customer/technician signature. Bind each signature to the form version and answered content. Changes to signed content require new signing. Required disclosures may be due before agreement or work; completion-time delivery is not an adequate substitute.
6. Complete each form only after its required answers, evidence, declarations and signatures are present and the server has confirmed saved state. Complete the parent job only after every required form, task, evidence item and issue passes the existing server checks. Travel/start buttons are unnecessary for this workflow; do not fabricate travel/start timestamps.
7. Provide quoting, invoices and price-book access in the field only where Team grants permit them. Use the existing commercial APIs and authoritative money calculations. Sending is a deliberate user action with a named recipient and a reviewed saved document. An accepted-quote invoice must not be duplicated as a quick invoice.
8. Store reports and PDFs under the customer, property and job. Use existing revocable, expiring report capabilities and public-data projections. Internal notes and unrestricted original evidence must not leak through a report link.

## Master forms

AEA admin and authorised Creditex accounts control the shared master library. Creditex has no pre-existing templates to supply. Build from the relevant regulator's current source material. Save makes a valid master the default available to trades; editing replaces that default. Preserve immutable versions on existing jobs and signed reports. Do not rewrite completed job records when the default changes.

Trades may add business-specific questions. Extensions cannot remove or weaken mandatory compliance questions, evidence, declarations, signature requirements or product checks. Capture optional marketing consent separately from statutory consent and assignment.

Form completeness, regulatory eligibility, compliance review, certificate submission and regulator acceptance are distinct states. Saving a template or completing a questionnaire does not issue a certificate. No automated legal approval, invented accreditation, guessed product eligibility or fabricated review records.

## Regulatory currency

Use effective-dated requirements for the activity, scenario, installation date and jurisdiction. The supplied Activity 45 form and consumer factsheet are historical examples. Scorecard closed on 23 June 2026. NSW ESS and PDRS amendments take effect on 7 September 2026; the existing July catalogue is not sufficient authority for those amended methods. Record verified sources and unresolved activity-specific gaps before enabling affected certificate workflows.

## Acceptance and release evidence

Verify native creation and assignment, multiple form isolation, durable drafts, evidence custody, signatures, final documents, permission denial and job completion boundaries. Run focused tests, root/mobile typechecks, the required release validation and native exports. Commit only task-owned source, publish the matching Sites artifact and publish a compatible mobile update when native release tooling is available. Report platform/device tests and regulatory activities that remain unverified without claiming universal compliance.

## Current implementation boundary

The field workflow uses server-scoped job options and Team grants, future appointment dates, one selected form, Call/Directions, guarded form exits, business-specific additional forms, and the existing quote/invoice APIs. Native quote totals include default option groups. Save/send requests carry revision checks, and invoice dispatch verifies the reviewed recipient. Parent completion retains evidence, form, issue and signature checks without inventing travel/start events.

Authorised master Save activates a valid version directly. Global forms and business forms have separate scope. Later drafts cannot hide a published default; withdrawal cannot revive an older default. The source library in both master portals retains six VEU source variants and fourteen national activity maps, exact statutory fragments, document conditions, hashes and verified Creditex contact/accreditation details. This is authoring evidence, not automatic certificate activation.

The remaining statutory implementation is substantial: before-work scope signatures must remain independently valid while installation/final-assignment answers change; generated PDFs must preserve all required sections, repeated equipment and evidence; business signatories need a supported authority record; every deployed activity still needs its exact evidence-policy/source/output composition. The current single-response signing engine does not yet implement that two-phase execution. The supplied historical Scorecard form is not a current pathway.

Creditex's public VEU registration is A001107; seven NSW accreditation records are retained in the provider data. Its public REC registered-person result (25749) differs from the website STC number (47056); neither is silently treated as a confirmed agent-account number. The retained hot-water guide's ten-year assignment wording conflicts with the current five-year framework, and the BESS2 life-support declaration has a branch-specific discrepancy. Those affected signing paths remain blocked pending authoritative reconciliation.

Validation for this workflow candidate: root/mobile typechecks and serial ESLint pass; Android/iOS exports pass; fresh D1 migrations through 0169 pass; current master/runtime, scoped forms, withdrawal/concurrency, NSW effective-date, statutory-text and invoice checks pass. The full root run reports 3,909 passed, two failed and eleven skipped; both failures also reproduce unchanged at the starting revision (comparator review-step source assertion and JSON-LD source assertion). Existing release audit components and customer-PDF audit pass. A physical device signature/camera/GPS and end-to-end statutory-document launch acceptance are still required.
