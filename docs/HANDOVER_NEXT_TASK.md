# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: pending the validated certificate-price release

## Current delivery summary

The platform has one validated release record and a production-safe migration path. Synthetic account, product and opportunity data is opt-in test fixture data, not normal database setup. Active web and worker typechecking, integration testing, fresh D1 migration validation, full automated testing, coverage and production build validation are available. Commercial Stripe links are runtime configuration. Netlify is no longer an active target. GitHub and OpenAI Sites are the release records.

The current release also includes a public certificate-price education guide. It stores six months of validated reported trades for STC, ESC, VEEC, PRC, LGC, ACCU and SMC, refreshes through the scheduled worker and clearly labels the values as indicative reported trades rather than a live exchange quote or guaranteed customer rebate.

The P1 opportunity and catalogue workspaces have been extracted from `AdminOperationsPortal.tsx` with their feature-owned styles. The remaining high-value maintainability risk is the still-large admin shell, especially its account directory and inbox state. Do not start a general rewrite.

## Recommended next milestone

### P1-C: extract the admin account directory workspace

Outcome: make partner and wholesaler account review easier to maintain and test without changing what an administrator can see or do.

### In scope

- Extract the accounts tab from `src/components/AdminOperationsPortal.tsx` into an `AdminAccountWorkspace` feature component.
- Move only account-specific types, list state, search and filter requests, CSV export and account-detail navigation into that feature boundary.
- Preserve the existing admin shell, authentication, notification routing, account API response contract, filters, table presentation, privacy copy and accessible controls.
- Move only account-specific CSS from `src/app/globals.css` into a feature-owned stylesheet or scoped module after checking desktop and mobile behaviour.
- Add executable tests at the feature boundary for filters, search, CSV export and protected-data rendering.

### Explicitly out of scope

- Inbox, opportunities, catalogue, customers, partners, billing, referrals, field app and consumer dashboard changes.
- API schema changes, database migrations, new dependencies, visual redesign, text rewrites or broad CSS formatting.
- Changing administrator roles or revealing household contact or address data.

### Existing touchpoints

- `src/components/AdminOperationsPortal.tsx`: account state begins near line 235, account loader near line 306, account detail navigation near line 593 and account UI near line 1362.
- `src/app/api/admin/accounts/route.ts`: retain its current filter and response contract.
- `src/components/WorkspaceListControls.tsx`, `src/components/SearchableLookup.tsx` and `src/components/WorkspaceTableTools.tsx`: reuse existing shared controls where they already fit.
- `src/app/globals.css`: move only selectors demonstrably owned by the extracted account workspace.

### Implementation sequence

1. Read the guardrails, release truth and this handover. Confirm the current account route and UI behaviour before editing.
2. Extract the account types and data client first, keeping request parameters and result handling identical.
3. Move the account workspace UI behind explicit props from the admin shell.
4. Remove duplicated parent state only after child behaviour is passing.
5. Move feature-owned styles, then verify desktop and mobile layouts, table alignment, focus order, search, filters and CSV export.
6. Update this handover, release truth and the audit register only if implementation state changes.

### Acceptance criteria

- Administrators can search, filter, page and export account views exactly as before.
- Opening account detail preserves the existing routing and status feedback.
- Account rows retain their designed one-line data presentation and mobile remains readable without horizontal page overflow.
- Household names, street addresses, phone numbers and emails remain absent from account and account-detail views.
- No new dependency, migration, endpoint or duplicate business rule is introduced.
- `npm run validate` passes. Focused account-workspace tests and a desktop/mobile feature check pass before release.

### Stop and escalate if

- The extraction needs a response-schema or database change.
- The CSS selectors cannot be isolated without affecting another admin tab.
- The desired UX needs new product decisions, such as new account states or additional data visibility.
- The work expands into inbox, customers or partner-management extraction.

## Recommendation after P1-C

Extract the admin inbox next using the same pattern, then consolidate shared admin request and list-view helpers only after the three feature modules prove the common boundary. This avoids a premature framework while reducing the largest component and stylesheet safely.
