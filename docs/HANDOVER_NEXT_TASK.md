# Next task handover

Status: active rolling handover
Prepared: 16 July 2026
Baseline commit: `0dc159e0fa4c505035932086d36f2687d2c3bcf6`

## Current delivery summary

The platform now has one validated release record and a production-safe migration path. Synthetic account, product and opportunity data is opt-in test fixture data, not normal database setup. Active web and worker typechecking, integration testing, fresh D1 migration validation, full automated testing, coverage and production build validation are available. Commercial Stripe links are runtime configuration. Netlify is no longer an active target. GitHub and OpenAI Sites are the release records.

TLink currently provides protected household opportunities, installer and wholesaler membership, verification, supplier catalogue, installer product selection and purchasing, a trade CRM, accounting pathways, teams, assets, handover and field-sync foundations. The AEA consumer platform retains electricity and gas comparison, planning, guides, rebates and always-free customer accounts. The privacy boundary remains a release-critical contract.

The remaining high-value technical risk is maintainability: `AdminOperationsPortal.tsx` is about 3,095 lines and `globals.css` is about 4,335 lines. The prior audit and roadmap correctly identify feature-boundary extraction as P1. Do not start a general rewrite.

## Recommended next milestone

### P1-A: extract the admin opportunity workspace

Outcome: make the admin lead and opportunity workflow easier to maintain and test without changing what an administrator can see or do.

### In scope

- Extract the `opportunities` tab from `src/components/AdminOperationsPortal.tsx` into an `AdminOpportunityWorkspace` feature component.
- Move only opportunity-specific types, list state, request functions, saved-view behaviour, create form and allocation actions into that feature boundary.
- Preserve the existing admin shell, authentication, notification routing, API endpoints, filters, table/list presentation, pagination, CSV export and privacy copy.
- Move only opportunity-specific CSS from `src/app/globals.css` into a feature-owned stylesheet or scoped module after checking desktop and mobile behaviour.
- Add executable tests at the route or feature boundary for filters, cursor pagination, creation, allocation and protected-data rendering.

### Explicitly out of scope

- Catalogue, accounts, inbox, billing, referrals, field app, installer CRM and consumer dashboard changes.
- API schema changes, database migrations, new dependencies, visual redesign, text rewrites or broad CSS formatting.
- Removing the current admin shell or changing administrator roles.

### Existing touchpoints

- `src/components/AdminOperationsPortal.tsx`: opportunity state begins near line 317, loader near line 455, action handlers near line 1074, and UI near line 2263.
- `src/app/api/admin/opportunities/route.ts`: retain its current response and cursor contract.
- `src/app/api/admin/opportunities/allocate/route.ts` and `src/app/api/admin/opportunities/matches/route.ts`: retain allocation and assignment contracts.
- `src/components/WorkspaceListControls.tsx`, `src/components/SearchableLookup.tsx` and `src/components/WorkspaceTableTools.tsx`: reuse these existing shared controls.
- `src/app/globals.css`: opportunity styles are currently concentrated around lines 2548 to 2567 and 2688 to 2691. Move only selectors demonstrably owned by the extracted workspace.

### Implementation sequence

1. Read the guardrails, release truth and this handover. Confirm the current admin opportunity route and UI behaviour before editing.
2. Extract domain types and the data client first, keeping request parameters and cursor behaviour identical.
3. Move the visual opportunity workspace and pass only explicit props from the admin shell.
4. Remove duplicated parent state only after the child behaviour is passing.
5. Move feature-owned styles, then verify desktop and mobile layouts, table alignment, focus order, saved views and notification navigation.
6. Update this handover, release truth and the audit register only if an implementation state changes.

### Acceptance criteria

- Administrators can search, filter, sort, page, save and reset opportunity views exactly as before.
- Creating, pausing, closing, allocating and assigning opportunities still use the existing server routes and produce the existing status feedback.
- Opportunity rows retain one-line, filterable data presentation where designed, and mobile remains readable without horizontal page overflow.
- Household names, street addresses, phone numbers and emails remain absent from opportunity and allocation views.
- No new dependency, migration, endpoint or duplicate business rule is introduced.
- `npm run validate` passes. Focused admin opportunity tests and a desktop/mobile feature check pass before release.

### Stop and escalate if

- The extraction needs a response-schema or database change.
- The CSS selectors cannot be isolated without affecting another admin tab.
- The desired UX needs new product decisions, such as new status stages or household data visibility.
- The work expands into catalogue or account-directory extraction.

## Recommendation after P1-A

Extract the admin catalogue review workspace next using the same pattern, then consolidate shared admin request and list-view helpers only after the two feature modules prove the common boundary. This avoids a premature framework while reducing the largest component and stylesheet safely.
