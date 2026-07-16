# TLink 100,000-record scale, UI and UX audit

Date: 16 July 2026

## Outcome

The installer product marketplace now uses cursor-based navigation instead of deep SQL offsets. The API returns one extra record to determine whether a next page exists, sends a stable cursor for the next request and avoids repeating the filtered total after the current view is established. Compound indexes now support the primary catalogue, account and opportunity access patterns.

The catalogue also keeps the dense desktop list while changing to labelled two-column records on tablets and single-column records on small phones. Loading feedback is immediate, repeated navigation is disabled while a request is active and the dense table text and controls are larger.

## 100,000-record benchmark

The repeatable benchmark seeds 100,000 accounts, 100,000 products, 100,000 opportunities and 100,000 customers into an in-memory SQLite database. This is 400,000 synthetic rows in total.

Latest local result:

| Scenario | p95 |
| --- | ---: |
| Catalogue first page | 0.066 ms |
| Deep OFFSET baseline | 152.278 ms |
| Deep cursor page | 0.191 ms |
| Filtered price page | 0.017 ms |
| Admin accounts | 0.025 ms |
| Admin opportunities | 0.031 ms |
| Installer customers | 0.026 ms |
| Catalogue contains search | 2.400 ms |

The deep cursor query was about 797 times faster than the old deep OFFSET query in this run. The query plan confirms that SQLite seeks through the compound marketplace index using the product name range instead of scanning and discarding all earlier pages.

This is a deterministic local guardrail, not a hosted latency guarantee. Network time, worker startup, authentication and remote database contention still need production telemetry.

## UI and UX findings

### Fixed in this release

1. Deep catalogue pages no longer become progressively slower because of OFFSET scanning.
2. Page navigation has immediate progress feedback and ignores repeat taps until the request finishes.
3. Column definitions and row definitions use the same shared grid so headings stay aligned with values.
4. Product results expose table, row, column header and cell semantics to assistive technology.
5. Mobile product results no longer retain a 1,720-pixel desktop minimum width. Each value now has a visible label.
6. Table text, pagination labels and action controls have been enlarged without removing the single-line desktop layout.
7. Mobile navigation and action controls use a minimum 44-pixel touch target.
8. Search, sort, column and page-size preferences continue to persist for the authenticated installer account.

### Observed pain points

1. The previously deployed live catalogue remained in a loading state more than 1.8 seconds after moving from the first 100 products to the remaining 51. Cursor navigation removes the deep database scan, but production request timing must be captured after deployment to separate database, network and worker startup time.
2. The advanced filter surface is powerful but long. It is appropriate for expert users, while small operators need a short default filter row plus saved views and a clear advanced section.
3. Several operational tables still use very small dense text outside the catalogue and CRM rows hardened in this release. A shared table component would prevent later screens from drifting below the agreed readability baseline.
4. Empty states explain what is missing, but the next action is not always placed beside the message. High-value empty states should include one clear primary action.
5. The external-link audit currently treats some OAuth token endpoints as ordinary web pages. Stripe and Square API endpoints can therefore appear broken even when their API response shape is valid.

## Performance and data findings

### Strong areas

- Catalogue page size is bounded.
- Expensive totals and facets can be skipped after the initial view load.
- Catalogue filters and sorts are server-side.
- Compound indexes cover the primary eligibility, filter and ordering paths.
- The new cursor contains the active sort identity, so an old cursor cannot be reused with a different ordering.
- The benchmark fails when critical indexed p95 queries exceed 75 ms locally.

### Remaining scale risks

1. Admin accounts, admin directory, admin opportunities, admin products, supplier products, purchasing and CRM jobs, customers and schedule endpoints still use OFFSET pagination.
2. Several option lists have fixed 1,000 or 2,000-row limits. These will silently omit choices as the ecosystem grows.
3. Some response shapers repeatedly call `filter` inside `map`. This is manageable for small pages but becomes quadratic for 250 to 500 parent records with related rows.
4. Product contains search uses wildcard matching. The 100,000-record local result is acceptable at 2.4 ms p95, but it cannot use a normal prefix index and will grow more quickly than exact or prefix filters.
5. A few filtered sorts still create a temporary B-tree for final ordering terms. This is currently fast, but the index should be revisited when real filter and sort frequency is known.

## Top meaningful adjustments moving forward

### Priority 1: complete the cursor rollout

Move admin accounts, directory, opportunities and products first, followed by CRM customers, jobs and schedules, then wholesaler products and purchasing. Use one shared cursor contract and shared navigation component so behaviour cannot diverge between dashboards.

### Priority 2: replace hard-capped option lists

Wholesaler, installer, customer and opportunity selectors should use scoped server search with debouncing and a small result window. This avoids downloading thousands of options and prevents records beyond the current hard limit from becoming unreachable.

### Priority 3: add production performance telemetry

Capture API duration, database duration, result count, filter family, cursor presence and error state without recording household contact details. Set dashboard targets for p50, p95 and p99 and separate worker startup from database time.

### Priority 4: standardise the high-volume table system

Create one responsive TLink table component with shared column definitions, keyboard sorting, loading overlays, empty-state actions, saved views, CSV export, 44-pixel mobile controls and labelled mobile records. Apply it across installer, wholesaler and admin workspaces.

### Priority 5: prepare indexed search before the data requires it

Introduce a tokenised search table or SQLite FTS for products, accounts, customers and opportunities when production contains search approaches the latency budget. Keep exact model code, postcode, status, state and category filters on normal indexes.

### Priority 6: replace repeated relationship filtering

Group related rows into maps keyed by parent ID before shaping API responses. Apply this first to opportunities and allocations, purchasing items and events, supplier dependencies and customer project handovers.

## Acceptance guardrails

- Indexed list queries stay under 75 ms p95 in the local 100,000-record benchmark.
- A page action shows feedback within 100 ms and cannot be submitted twice while active.
- Desktop rows remain one line where the information is comparable.
- Mobile rows show a visible label for every value and do not require page-level horizontal scrolling.
- Interactive controls are at least 44 pixels high on mobile.
- No high-volume screen depends on downloading the whole dataset.
- No customer identity, address, phone or email is added to installer or wholesaler telemetry.
