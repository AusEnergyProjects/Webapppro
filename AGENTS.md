# AEA Energy

## Goal

Build a trustworthy Australian Energy Assessments site for independent energy-plan comparisons and practical home-upgrade advice.

## Project map

- src/app/compare/page.tsx: serves the native electricity comparator at /compare.
- src/app/compare/electricity-legacy/route.ts: preserves the compatibility comparator as the noindex rollback route.
- public/electricity-comparator.html: compatibility source containing the working electricity UI, NEM12 parser, chart, NMI lookup, CDR plan engine, solar and battery tools, filters, lead flow and email links.
- src/app/compare/gas/page.tsx: native Next gas comparison page at /compare/gas.
- src/components/GasComparator.tsx: gas form and result UI.
- src/app/api/gas-plans/route.ts: server-side CDR gas-plan lookup and block-tariff estimator.
- src/app/globals.css and src/components/ComparatorChrome.tsx: shared Tailwind design system for native Next pages.
- ROADMAP.md: current migration and product plan.
- docs/audit/2026-07-21-complete-current-state/: immutable dated evidence baseline; never rewrite it as current status.
- docs/RELEASE_TRUTH.md: single current source and deployment status.
- docs/HANDOVER_NEXT_TASK.md: one executable current milestone.

## Rules

- Answer the question the user is actually trying to solve, using relevant context already provided.
- Be direct, clear and concise. Give the answer or next steps first. Do not add pep talks, praise, filler, repeated summaries or unnecessary explanations.
- Do not use rhetorical comparison phrases such as "you do not want X, you want Y." State the conclusion plainly.
- For instructions or troubleshooting, give simple steps in order, handle one logical stage at a time, do not assume earlier steps were completed, do not skip ahead, and refer directly to the evidence, screenshot, file, error or result being discussed.
- Before making a recommendation, identify the user's actual objective and constraints, consider relevant alternatives, check for contradictions with recent messages, screenshots and files, verify current or changeable facts using reliable primary sources, distinguish confirmed facts from assumptions or uncertainty, and recommend the best fit with a brief reason.
- Do not agree with the user's premise merely to be agreeable. Correct it when the evidence points elsewhere.
- Never claim something is implemented, confirmed, tested or completed without evidence. Clearly separate what is done, proposed, assumed and still unknown.
- Avoid repeating information the user already knows or work already completed. Ask for clarification only when missing information genuinely prevents a correct answer.
- Keep costs, savings and payback clearly indicative and explain material assumptions.
- Keep gas and electricity pricing engines separate.
- Prefer server routes for retailer-data requests.
- Do not deploy, submit leads, or change external services without explicit approval.
- No em dashes or en dashes in user-facing copy.
- All `date` and `datetime-local` inputs must use the delegated `SiteDatePicker` pop-out provided by the root layout. Date ranges must share a stable `data-date-range-group` and use `data-date-range-role="start"` and `data-date-range-role="end"` so one calendar can select and apply the range.
- Use Next.js App Router. Read relevant local Next documentation before unfamiliar APIs.
- Preserve the compatibility comparator until the native electricity migration passes the same interaction audit.
- Keep TLink trade software free. Do not add a commercial access, seat, lead, job or quote gate.
- Require a checksum-valid ABN and an authorised authoritative business review before granting any trade workspace or API access.
- Treat the dated audit as immutable history. Update current truth in RELEASE_TRUTH.md, forward sequence in ROADMAP.md and the active contract in HANDOVER_NEXT_TASK.md.

## Default fast live workflow

- Default every implementation request and follow-up adjustment for this project to `FAST LIVE` mode unless the user explicitly says it is read-only, local-only, or must not be committed, pushed or published. Questions, explanations, reviews and read-only audits do not mutate or release anything.
- In `FAST LIVE` mode, begin implementation immediately after confirming the repository, branch, dirty state and applicable instructions. Do not produce a plan unless a genuine blocker prevents implementation.
- Inspect only the requested feature, its direct dependencies and directly relevant tests. Do not perform broad repository exploration, historical research, unrelated audits or speculative investigation.
- Lock scope to the requested outcome. Do not add unrelated cleanup, refactors, dependencies, abstractions, features, migrations, roadmap work or documentation changes.
- Do not use subagents, web research, plugins or external services unless the requested result genuinely requires them.
- Make reasonable low-risk assumptions and proceed. Ask the user only when a decision materially changes visible behaviour, destructive action is required, credentials or external authority are missing, or the requirement conflicts with repository evidence.
- Implement the smallest complete production-quality change using existing patterns. Prefer one cohesive edit-and-validation pass over repeated discussion of minor decisions.
- Validate proportionately before every live release. Always inspect the scoped diff and run `git diff --check`. For low-risk copy, styling and isolated UI changes, run existing focused tests plus the build required for publication. For logic and API changes, run focused unit or integration tests, typecheck and the publication build. Run the full release suite only for authentication, permissions, billing, database migrations, privacy, security, shared production contracts, or when a focused failure indicates wider risk.
- Separate pre-existing failures from failures caused by the task. Do not widen scope to repair unrelated failures.
- After two failed attempts using the same approach, stop repeating it, preserve completed work and report the exact blocker and smallest action needed.
- After proportionate validation passes, stage and commit only the files owned by the current task, push the exact commit to the current approved GitHub branch, verify the remote commit, build or package Sites from that committed state, publish the matching Sites version, verify source and deployment provenance, and perform focused live checks of only the affected desktop and mobile flow.
- Never stage or publish unrelated existing worktree changes. If a clean artifact cannot be produced from the exact scoped commit, stop and report the conflicting files or release dependency rather than deploying a mixed state.
- Do not update `docs/RELEASE_TRUTH.md`, `docs/HANDOVER_NEXT_TASK.md`, `ROADMAP.md`, release assertions or next-five recommendations for routine adjustments. Update them only when the user requests it, a material milestone or migration changes canonical product state, or an existing automated release gate requires it.
- Keep progress updates brief and factual. Report only the outcome, exact files changed, checks and results, GitHub commit and remote verification, Sites version and live verification, and genuine blockers or unverified areas.
- Never deploy to Netlify unless the user explicitly requests it.
