# TLink platform scale hardening audit

Audit date: July 16, 2026

## Outcome

The five requested scale tasks are implemented across administrator, installer and wholesaler workspaces. Large result sets now use cursor pagination, broad selectors use bounded server lookups, dense records share one responsive table foundation, indexed full-text search covers the main platform entities, and the operations overview can monitor privacy-safe API and database timings.

## Completed work

| Workstream | Implementation | User impact |
| --- | --- | --- |
| API and database telemetry | Sampled route, database, status, result-count and cursor timings with an owner and administrator performance panel | Slow routes can be found before they become a customer complaint. No household details, search text, contact details or request URLs are recorded. |
| Cursor pagination | Accounts, directories, opportunities, products, CRM jobs, CRM customers, schedules, wholesaler catalogues and purchasing use stable keyset cursors | Next-page navigation no longer becomes progressively slower as datasets grow. A short navigation lock prevents accidental double requests. |
| Server lookups | Installer allocation, opportunity selection and product dependency controls query at most 25 relevant records | Large accounts do not preload 1,000 or 2,000 options into the browser. |
| Responsive tables | Admin, CRM, catalogue, marketplace, purchasing and performance lists share the TLink header, row, hover, overflow and truncation system | Headings stay aligned, rows stay scan-friendly and narrow screens scroll inside the result area instead of breaking the page. |
| Full-text search | D1 FTS5 indexes and sync triggers cover products, accounts, platform customers, opportunities and installer-owned CRM customers | Search remains indexed across names, model codes, locations, contact fields and service text as records grow. |

## Scale evidence

The repeatable benchmark generated 100,000 accounts, 100,000 products, 100,000 opportunities and 100,000 customers, for 400,000 synthetic rows in total.

| Query | p95 |
| --- | ---: |
| Catalogue first page | 0.066 ms |
| Catalogue deep page with cursor | 0.100 ms |
| Catalogue deep page with old offset baseline | 147.858 ms |
| Filtered catalogue price and stock | 0.017 ms |
| Admin accounts first page | 0.026 ms |
| Admin accounts deep cursor | 28.512 ms |
| Admin opportunities deep cursor | 8.323 ms |
| Installer customers deep cursor | 0.059 ms |

The deep catalogue cursor is approximately 1,479 times faster than the old deep offset query in this benchmark. Every guarded query stayed below the 75 ms p95 target.

The full migration chain, including all five FTS5 tables and their sync triggers, was applied successfully in a local Cloudflare D1 runtime. Test searches returned indexed product and account matches.

## UI and UX audit findings

### Working well

- List-first layouts expose more useful fields per screen than the previous tile-first catalogue.
- Sticky headers, single-line truncation and horizontal result-area scrolling keep dense records readable.
- Search and filters stay above the result list and no longer compete with detail panels.
- The server returns a clear `hasNext` state, and controls visually lock while navigation is in progress.
- Typeahead controls preserve the selected record while searching and include keyboard and screen-reader semantics.

### Remaining friction

- The broad administrator account view has the slowest measured deep cursor because its sort crosses verification and update fields. It remains well inside the target, but a production query sample will identify the best final composite index.
- Very wide CRM tables require horizontal scrolling on phones. This is intentional for full data access, but the native field app should use task-focused summaries rather than reproduce every desktop column.
- Table column preferences are workspace specific. A future saved-view manager should let larger teams name, share and lock standard views.
- Full-text search is currently prefix based. Typo tolerance and synonyms should only be added after real search telemetry shows which missed terms matter.
- Production telemetry needs enough real traffic to establish route-specific targets rather than using one platform-wide threshold.

## Verification

- Production build passed.
- ESLint passed.
- 424 automated tests passed, with 2 intentional skips.
- The 400,000-row scale benchmark passed.
- Full Cloudflare D1 migration chain and FTS queries passed locally.
- Public and unauthenticated dashboard boundaries were visually inspected in the in-app browser.

## Next recommended action

Collect seven days of production timing samples, then add the single highest-value composite index for the slowest real administrator query. Use the same evidence to set per-route p95 warning thresholds before adding fuzzy search or more table configuration.
