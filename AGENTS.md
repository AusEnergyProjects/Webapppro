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

- Keep costs, savings and payback clearly indicative and explain material assumptions.
- Keep gas and electricity pricing engines separate.
- Prefer server routes for retailer-data requests.
- Do not deploy, submit leads, or change external services without explicit approval.
- No em dashes or en dashes in user-facing copy.
- Before finishing code work, run npm run build.
- Use Next.js App Router. Read relevant local Next documentation before unfamiliar APIs.
- Preserve the compatibility comparator until the native electricity migration passes the same interaction audit.
