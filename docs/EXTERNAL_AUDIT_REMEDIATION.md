# External audit remediation register

Audit received: 16 July 2026

The audit is accepted as a release-quality input. Changes must preserve consumer, installer, wholesaler, admin and field-app capabilities while improving safety, clarity, maintainability and scale.

| Finding | Current treatment | Status |
|---|---|---|
| Synthetic population in ordinary migrations | Payloads moved to opt-in fixtures. Historical migration names remain no-op for compatibility. A test prevents demo population returning to production migrations. | Completed |
| Generated credential output not ignored | `/synthetic-test-output/` is ignored and release tests enforce it. | Completed |
| No exact current-head typecheck | Active web and worker TypeScript now passes through `npm run typecheck`. | Completed |
| Missing migration and aggregate validation | `npm run db:check`, integration, coverage and `npm run validate` added. | Completed |
| Duplicate `Opportunity.isSynthetic` | Duplicate field removed and caught by the active typecheck. | Completed |
| Mixed Australian state codes | Canonical uppercase domain values, validation and corrective migration added. | Completed |
| Hard-coded Stripe commercial settings | Checkout URLs, billing portal and payment-link mapping moved to validated runtime environment variables. | Completed |
| Confusing deployment targets | Netlify target removed, default Vercel instructions removed, Sites plus GitHub documented as current truth. | Completed |
| Fragmented project status | Canonical release truth added. Historical architecture document clearly marked. Roadmap now owns the remediation sequence. | Completed |
| Pattern-heavy tests | Runtime integration target and fresh D1 migration application added. Existing pattern tests remain guardrails. | In progress |
| Monolithic admin component | Split by opportunity, catalogue, account and inbox feature boundaries with typed clients and reducer-backed state. | Planned P1 |
| Monolithic global CSS | Extract feature styles incrementally and remove obsolete selectors after visual regression checks. | Planned P1 |
| High-volume pagination and search | Cursor pagination, server search, FTS5, shared tables and 400,000-row benchmarking are implemented. | Foundation completed |
| Production telemetry | Route and database timing samples are implemented. Define operating SLOs from real traffic. | Foundation completed |
| Legacy comparator retirement | Keep rollback implementation until the native stability gate passes. | Controlled P3 |
| Native field release | Offline and sync foundation exists. Physical device, signing and app-store acceptance remain. | P3 external dependency |

## Required working method

1. Change one domain boundary at a time and preserve public contracts during extraction.
2. Add executable tests for behavioural changes. Do not rely only on source-string assertions.
3. Apply corrective migrations instead of editing history on shared databases.
4. Run the aggregate validation command on the exact release commit.
5. Update release truth and this register when a finding changes state.
