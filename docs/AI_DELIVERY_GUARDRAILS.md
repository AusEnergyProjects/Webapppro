# AI delivery guardrails

Status: required working method for all future repository changes
Last updated: 16 July 2026

## Purpose

Keep TLink and Australian Energy Assessments improving without uncontrolled scope, duplicate implementation, generated-data leakage, fragmented status records or repository bloat. These rules apply to an AI-assisted task and to the human review of its result.

## Required milestone contract

Before editing production code, the active task must state:

1. One outcome written in user terms.
2. The owning workflow and files or modules expected to change.
3. Explicit in-scope and out-of-scope boundaries.
4. Acceptance criteria, including privacy and responsive behaviour where relevant.
5. The smallest meaningful validation set.
6. A stop condition that requires a new task or owner decision.

The current task contract belongs in [HANDOVER_NEXT_TASK.md](./HANDOVER_NEXT_TASK.md). Replace that one rolling handover instead of creating competing status files.

## Scope and change budget

- Work on one domain boundary at a time. Do not combine unrelated dashboard, billing, authentication, mobile and comparison work in one milestone.
- Make the smallest coherent change that achieves the outcome. Reuse existing components, routes, table controls and validation utilities before introducing a new abstraction.
- Add a dependency only when the existing platform cannot safely meet the need. Record the reason in the handover.
- Do not add generated snapshots, benchmark outputs, credentials, sample accounts or bulk data to ordinary production paths.
- Do not create a new document for transient progress. `docs/RELEASE_TRUTH.md` is implementation status, `ROADMAP.md` is future sequencing, and the rolling handover is the next executable task.
- Keep public and persisted contracts stable during refactors unless the milestone explicitly includes a versioned migration and a compatibility plan.

## Cleanup rule

Every code milestone includes relevant local cleanup, but cleanup stays inside the touched domain:

- Remove dead imports, superseded branches, obsolete styles and duplicate local state when the replacement is proven.
- Do not perform opportunistic repository-wide rewrites, dependency churn or formatting-only changes.
- Delete replaced code in the same milestone when no compatibility requirement remains.
- Split a large component or stylesheet by a visible workflow boundary, not by arbitrary file length.
- Preserve a compatibility route or old contract only when release truth names its owner and retirement gate.

## Safety and data rules

- Use additive corrective migrations. Never rewrite migration history that may be shared.
- Keep synthetic populations opt-in fixtures. Production migrations must not create demo accounts, opportunities or products.
- Keep canonical domain values separate from display labels. Australian state storage uses uppercase codes.
- Keep secrets, customer data and commercial configuration out of browser source and generated outputs.
- Maintain the customer privacy boundary. Wholesalers never receive household opportunities, and installer access remains limited to the approved matching and handover flow.

## Evidence gate

Before release, run the validation proportional to the change. Production code, database, API, authentication or billing changes require `npm run validate` on the exact commit. UI changes also require focused responsive and interaction checks before their feature styles are removed or moved.

Do not claim a task is complete without recording:

- What changed and what was deliberately left unchanged.
- The validation actually run and its result.
- Any external dependency or owner action still required.
- The next recommended task, with a defined scope.

## Handover and escalation

Stop and create a new milestone when the work would:

- Cross into a second product domain.
- Change a customer-data, payment, identity or migration contract unexpectedly.
- Require a new paid service, vendor account, store credential or product decision.
- Require a broad visual redesign rather than a feature-local improvement.
- Exceed the agreed acceptance criteria without a clear user benefit.

The next executor must read `AGENTS.md`, `docs/RELEASE_TRUTH.md`, `ROADMAP.md`, this document and the rolling handover before making changes.
