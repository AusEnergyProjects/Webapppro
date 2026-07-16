# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: pending the validated admin-workspace and operations-SLO release

## Current delivery summary

The platform has one validated release record and a production-safe migration path. Synthetic account, product and opportunity data is opt-in test fixture data, not normal database setup. Active web and worker typechecking, integration testing, fresh D1 migration validation, full automated testing, coverage and production build validation are available. Commercial Stripe links are runtime configuration. Netlify is no longer an active target. GitHub and OpenAI Sites are the release records.

The current release also includes a public certificate-price education guide. It stores six months of validated reported trades for STC, ESC, VEEC, PRC, LGC, ACCU and SMC, refreshes through the scheduled worker and clearly labels the values as indicative reported trades rather than a live exchange quote or guaranteed customer rebate.

The P1 opportunity, catalogue, account and inbox workspaces are feature-owned. Account list state, saved views, moderation, exports and privacy boundaries now live in `AdminAccountWorkspace`; the shared list-view request boundary is used by account, opportunity and catalogue workspaces. The admin performance panel now evaluates explicit 7-day SLOs and shows read-only query plans for the principal keyset lists. The remaining high-value maintainability risk is the still-large admin shell, especially its product-enquiry state. Do not start a general rewrite.

## Recommended next milestone

### P1-D: extract the product-enquiry workspace

Outcome: make product-enquiry review easier to maintain and test without changing administrator data visibility or workflow.

### In scope

- Extract the enquiries tab from `src/components/AdminOperationsPortal.tsx` into an `AdminProductEnquiryWorkspace` feature component.
- Move only enquiry-specific list state, search/filter requests, status summaries and table rendering into that feature boundary.
- Preserve the existing shell, authentication, notification routing, product-enquiry response contract, filters, table presentation and accessible controls.
- Move only enquiry-specific CSS after checking desktop and mobile behaviour.
- Add executable tests at the feature boundary for search, status filtering, aggregate summaries and supplier/installer rendering.

### Explicitly out of scope

- Opportunities, catalogue, accounts, inbox, customers, partners, billing, referrals, field app and consumer dashboard changes.
- API schema changes, database migrations, new dependencies, visual redesign, text rewrites or broad CSS formatting.
- Changing administrator roles, enquiry data shape or privacy policy.

### Existing touchpoints

- `src/components/AdminOperationsPortal.tsx`: enquiry state begins near line 178, loader near line 402 and UI near line 1079.
- `src/app/api/admin/product-enquiries/route.ts`: retain its current search and status-filter response contract.
- `src/components/admin-workspace.ts`: reuse the established shared request and error boundary where it fits.
- `src/app/globals.css`: move only selectors demonstrably owned by the extracted enquiry workspace.

### Implementation sequence

1. Read the guardrails, release truth and this handover. Confirm the current enquiry route and UI behaviour before editing.
2. Extract the enquiry types and data client first, keeping request parameters and result handling identical.
3. Move the enquiry workspace UI behind explicit props from the admin shell.
4. Remove duplicated parent state only after child behaviour is passing.
5. Move feature-owned styles, then verify desktop and mobile layouts, table alignment, focus order, search, filters and CSV export.
6. Update this handover, release truth and the audit register only if implementation state changes.

### Acceptance criteria

- Administrators can search and filter product enquiries exactly as before.
- Notification routing preserves its existing enquiry destination and status feedback.
- Enquiry rows retain their designed data presentation and mobile remains readable without horizontal page overflow.
- Supplier and installer data remains limited to the existing product-enquiry contract.
- No new dependency, migration, endpoint or duplicate business rule is introduced.
- `npm run validate` passes. Focused account-workspace tests and a desktop/mobile feature check pass before release.

### Stop and escalate if

- The extraction needs a response-schema, privacy-policy or database change.
- The CSS selectors cannot be isolated without affecting another admin tab.
- The desired UX needs new product decisions, such as new enquiry states or additional data visibility.
- The work expands into customers, partner management or billing extraction.

## Recommendation after P1-D

Reassess the admin shell after the enquiry extraction. The inbox is already feature-owned and account, opportunity and catalogue list behaviour already uses a shared request boundary; only consolidate further where an additional extraction proves a stable common contract.
