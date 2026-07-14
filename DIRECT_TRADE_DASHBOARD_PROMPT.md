# Direct Trade dashboard implementation prompt

Continue the Australian Energy Assessments Direct Trade product from the existing Firebase-authenticated trade account and Sites D1 business profile.

## Product goal

Build a trustworthy subscription membership platform for Australian installers and wholesalers. It must connect suitable household projects with verified businesses without selling individual leads, auctioning placement or promising a volume of work.

## Non-negotiable product rules

- Never describe an opportunity as a free lead, paid lead or lead purchase.
- Matching must be based on verified capability, service coverage, project fit and availability.
- A paid subscription must not buy ranking, exclusivity or guaranteed project volume.
- A Direct Trade membership does not replace a trade licence, government accreditation, scheme approval, insurance, product compliance or customer obligations.
- Keep indicative pricing and commercial terms transparent. All displayed prices include GST.
- Do not collect licence files, identity records, confidential wholesale files or payment details through ordinary public forms.
- Business street address, suburb, state or territory and postcode are required for every business profile. Keep the address private unless the business separately consents to publication or sharing.
- Keep installer and wholesaler experiences role-specific while using one consistent visual system.
- Preserve keyboard, mobile, loading, empty, error and signed-out states.
- Do not use em dashes or en dashes in user-facing copy.

## Commercial model to prepare

### Trades and installers

- Annual membership: $99 per month including GST, billed as $1,188 once per year.
- Month-to-month membership: $199 per month including GST.

### Suppliers and wholesalers

- Annual membership: $199 per month including GST, billed as $2,388 once per year.
- Month-to-month membership: $399 per month including GST.

### Referral reward

- Give each paying business a unique referral code.
- When a new eligible business uses the code, starts a paid membership and its first payment clears, give both businesses one month of membership credit.
- Apply credits to membership invoices only. Do not offer cash withdrawal.
- Reject self-referrals, duplicate businesses, reversed payments and misuse.
- Show referral status and earned credits in the dashboard.
- Define how annual-plan credits are calculated before launch and test every billing edge case.

## Stripe phase

Do not activate payments until Australian Energy Assessments supplies and approves its Stripe account connection. When authorised:

1. Use Stripe Checkout for new subscriptions and Stripe Billing Portal for plan management.
2. Create separate recurring prices for installer annual, installer monthly, wholesaler annual and wholesaler monthly membership.
3. Store Stripe customer, subscription and price identifiers server-side only.
4. Verify webhook signatures server-side and make webhook processing idempotent.
5. Treat the webhook-confirmed subscription state as authoritative. Never trust a client redirect alone.
6. Handle active, trialing if later approved, past due, unpaid, cancelled and payment-reversed states.
7. Generate tax invoices through Stripe with correct Australian GST treatment and business details.
8. Keep referral credits as auditable ledger entries and apply them only after the qualifying first payment clears.
9. Add terms, cancellation, refund, privacy and referral conditions before taking payment.
10. Test Stripe sandbox flows before requesting production activation.

## Dashboard roadmap

### Release 1: account foundation

- Signed-in dashboard shell with role-aware installer or wholesaler language.
- Business profile and private business address.
- Profile, verification, membership and opportunity status cards.
- Honest empty opportunity inbox with no invented metrics.
- Service coverage, capabilities or product categories summary.
- Verification readiness checklist.
- Membership pricing preview with disabled billing controls.
- Referral program preview with safeguards.

### Release 2: verification workspace

- Secure, access-controlled document upload area outside ordinary public forms.
- Installer licence, insurance and scheme-specific evidence workflow.
- Wholesaler product compliance, warranty and Australian support evidence workflow.
- Expiry dates, review status, reviewer notes and renewal reminders.
- Clear approved, action required, under review, expired and suspended states.

### Release 3: subscriptions and referrals

- Stripe Checkout, Billing Portal and verified webhook processing.
- Role-specific subscription choices and annual billing savings.
- Referral code creation, redemption, eligibility checks and credit ledger.
- Invoice and membership history.
- Subscription cancellation and reactivation without deleting the business profile.

### Release 4: opportunity operations

- Availability controls and service-area preferences.
- Suitable opportunity inbox with new, reviewing, accepted, declined, quoted and closed states.
- Privacy-safe household brief until a controlled connection is approved.
- Clear quote evidence checklist based on the project category.
- No per-lead fee, no bidding and no paid ranking.
- Response-time and outcome reporting that does not pressure households or fabricate performance claims.

### Release 5: wholesaler workspace

- Product catalogue and supported model records.
- Warranty, compliance and technical-support fields.
- Approved installer relationships and supported service areas.
- Product suitability notes connected to real household scopes without revealing confidential trade pricing.

## Definition of done for each release

- Extend the current Firebase identity and Sites D1 ownership checks rather than replacing them.
- Generate and inspect a migration for every schema change.
- Add focused tests for authorisation, validation, role differences, pricing copy, referral rules and prohibited lead-fee language.
- Run the complete build.
- Review desktop and mobile layouts in the live browser.
- Publish only after explicit approval for external payment activation. Normal ChatGPT Sites and Google app updates remain authorised; GitHub and Netlify require separate approval.
