# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: pending the validated product-enquiry workspace and release-audit record

## Current delivery summary

The platform has one validated release record and a production-safe migration path. Synthetic account, product and opportunity data is opt-in test fixture data, not normal database setup. Active web and worker typechecking, integration testing, fresh D1 migration validation, full automated testing, coverage and production build validation are available. Commercial Stripe links are runtime configuration. Netlify is no longer an active target. GitHub and OpenAI Sites are the release records.

The current release also includes a public certificate-price education guide. It stores six months of validated reported trades for STC, ESC, VEEC, PRC, LGC, ACCU and SMC, refreshes through the scheduled worker and clearly labels the values as indicative reported trades rather than a live exchange quote or guaranteed customer rebate.

The P1 opportunity, catalogue, account, inbox and product-enquiry workspaces are feature-owned. Account list state, saved views, moderation, exports and privacy boundaries now live in `AdminAccountWorkspace`; product-enquiry filtering and summaries now live in `AdminProductEnquiryWorkspace`. The shared list-view request boundary is used by account, opportunity and catalogue workspaces. The admin performance panel now evaluates explicit 7-day SLOs and shows read-only query plans for the principal keyset lists. The remaining high-value maintainability risk is the still-large admin shell, especially its referral state. Do not start a general rewrite.

## Recommended next milestone

### P1-E: extract the referral workspace

Outcome: make referral-reward review easier to maintain and test without changing eligibility, Stripe actions or administrator workflow.

### In scope

- Extract the referrals tab from `src/components/AdminOperationsPortal.tsx` into an `AdminReferralWorkspace` feature component.
- Move only referral list state, moderation actions, status summaries and table rendering into that feature boundary.
- Preserve the existing shell, authentication, notification routing, referral API contract, eligibility rules, Stripe retry action and accessible controls.
- Move only referral-specific CSS after checking desktop and mobile behaviour.
- Add executable tests at the feature boundary for approval, rejection, retry, eligibility and privacy-safe rendering.

### Explicitly out of scope

- Opportunities, catalogue, accounts, inbox, customers, partners, billing, product enquiries, field app and consumer dashboard changes.
- API schema changes, database migrations, new dependencies, visual redesign, text rewrites or broad CSS formatting.
- Changing administrator roles, referral eligibility, Stripe terms or privacy policy.

### Existing touchpoints

- `src/components/AdminOperationsPortal.tsx`: referral state begins near line 177, loader near line 225, moderation near line 418 and UI near line 1036.
- `src/app/api/admin/referrals/route.ts`: retain its current eligibility, moderation and audit contract.
- `src/lib/stripe-referral-server.ts`: retain the existing idempotent reward boundary.
- `src/app/globals.css`: move only selectors demonstrably owned by the extracted referral workspace.

### Implementation sequence

1. Read the guardrails, release truth and this handover. Confirm the current referral route and UI behaviour before editing.
2. Extract the referral types and data client first, keeping request parameters and result handling identical.
3. Move the referral workspace UI behind explicit props from the admin shell.
4. Remove duplicated parent state only after child behaviour is passing.
5. Move feature-owned styles, then verify desktop and mobile layouts, table alignment, focus order, search, filters and CSV export.
6. Update this handover, release truth and the audit register only if implementation state changes.

### Acceptance criteria

- Administrators can review, approve, reject and retry referral actions exactly as before.
- Notification routing preserves its existing referral destination and status feedback.
- Referral rows retain their designed data presentation and mobile remains readable without horizontal page overflow.
- Referral data remains limited to the existing business-account contract.
- No new dependency, migration, endpoint or duplicate business rule is introduced.
- `npm run validate` passes. Focused account-workspace tests and a desktop/mobile feature check pass before release.

### Stop and escalate if

- The extraction needs a response-schema, Stripe contract, privacy-policy or database change.
- The CSS selectors cannot be isolated without affecting another admin tab.
- The desired UX needs new product decisions, such as revised referral rewards or eligibility criteria.
- The work expands into customers, partner management, billing or product-enquiry extraction.

## Recommendation after P1-E

Reassess the admin shell after the referral extraction. The inbox, account, opportunity, catalogue and enquiry boundaries are feature-owned; only consolidate further where an additional extraction proves a stable common contract.
