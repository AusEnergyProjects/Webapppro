# AEA Energy

## Goal

Build a trustworthy Australian Energy Assessments site for independent energy-plan comparisons and practical home-upgrade advice.

## Project map

- src/app/compare/route.ts: serves the proven electricity comparator at /compare.
- public/electricity-comparator.html: compatibility source containing the working electricity UI, NEM12 parser, chart, NMI lookup, CDR plan engine, solar and battery tools, filters, lead flow and email links.
- src/app/compare/gas/page.tsx: native Next gas comparison page at /compare/gas.
- src/components/GasComparator.tsx: gas form and result UI.
- src/app/api/gas-plans/route.ts: server-side CDR gas-plan lookup and block-tariff estimator.
- src/app/globals.css and src/components/ComparatorChrome.tsx: shared Tailwind design system for native Next pages.
- ROADMAP.md: current migration and product plan.

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
- After validated changes, commit the approved scope, push it to GitHub, and publish it to Sites without a separate release prompt. Never deploy to Netlify unless the user explicitly requests it.
- No em dashes or en dashes in user-facing copy.
- All `date` and `datetime-local` inputs must use the delegated `SiteDatePicker` pop-out provided by the root layout. Date ranges must share a stable `data-date-range-group` and use `data-date-range-role="start"` and `data-date-range-role="end"` so one calendar can select and apply the range.
- Before finishing code work, run npm run build.
- Use Next.js App Router. Read relevant local Next documentation before unfamiliar APIs.
- Preserve the compatibility comparator until the native electricity migration passes the same interaction audit.
