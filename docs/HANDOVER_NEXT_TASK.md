# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: pending Phase 6 Build step 1 validation and release

## Current delivery summary

Phase 6 Build step 1 removes subscription and seat entitlements from core trade operations. A verified installer or wholesaler receives the role-appropriate operating tools at A$0, regardless of current or historical Stripe billing state. Verification, account status, role permissions and customer privacy remain the access controls.

The trade dashboard no longer presents new paid plans or paid referral rewards. The historical membership route now explains free verified access and retains only the Stripe portal path required by businesses with an existing subscription. Marketplace allocation and approved wholesaler product visibility no longer depend on billing or feature-grant rows.

Installer opportunity cards now expose Create quote, Create job and Book site visit actions. Job and visit conversion preserves the owner-scoped opportunity match identifier as the CRM source reference. The CRM continues to show a protected customer and broad service region rather than household contact or street-address data.

The previous P1 referral-workspace extraction is deferred. Phase 6 now owns the product sequence because the roadmap explicitly supersedes the subscription-led operating model.

## Recommended next milestone

### P6-2A: establish the customer and service-site foundation

Outcome: let a verified trade keep one customer account with multiple contacts, service sites and installed assets without extending the current aggregate CRM job record.

### In scope

- Add explicit owner-scoped customer-account, customer-contact, service-site and site-contact entities.
- Link current direct-trade CRM customers to the new account and site boundary without changing protected marketplace privacy.
- Support multiple sites and contacts per customer account.
- Add service-site access instructions, parking, hazards and service contacts with explicit privacy and role checks.
- Add focused APIs and CRM views for creating, editing and selecting the authoritative customer and site.
- Add additive D1 migrations, executable route/domain tests and responsive desktop/mobile checks.

### Explicitly out of scope

- Marketplace, email, SMS, telephony or public API enquiry ingestion.
- CSV or Excel import.
- Quote line items, online acceptance, deposits or invoices.
- Scheduling redesign, stock, purchasing, accounting, AI or mobile-field changes.
- Releasing protected marketplace contact or street-address fields.

### Acceptance criteria

- One trade-owned customer account can have multiple contacts and multiple service sites.
- Each service site can have its own contacts, access instructions, parking and hazard notes.
- Existing direct-customer CRM records remain accessible and are linked without duplicate entry.
- Protected marketplace jobs remain region-only until existing consent and assignment rules authorise an address.
- Every read and write is same-origin, authenticated, owner-scoped and role-checked.
- Desktop and mobile CRM layouts remain readable without horizontal page overflow.
- npm run validate passes on the exact release commit.

### Stop and escalate if

- The migration would require rewriting shared migration history.
- Existing direct-customer records cannot be linked without an owner-visible reconciliation decision.
- The change requires releasing protected marketplace identity, contact or service-address data.
- The work expands into enquiry-channel ingestion, quote redesign, finance or field workflow.

## Recommendation after P6-2A

Build P6-2B as the unified enquiry inbox and generic CSV or Excel import contract. Use the customer and service-site entities from P6-2A as the only conversion targets.
