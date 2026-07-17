# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: `5863f04` on `codex/sites-custom-domain-migration`, Sites version 124

## Current delivery summary

P6-2C extends the existing installed-asset source of truth with authoritative P6-2A customer and service-site links. It does not create a competing asset table or bypass the handover, warranty or field-work workflows.

Migration `0049_customer_asset_timeline.sql` adds owner-scoped customer, site, provenance, review, lifecycle, label and commissioning fields to `trade_installed_assets`. Existing active handover assets retain their handover-pack reference and enter `pending_review`; they do not receive a customer or site link until an installer explicitly confirms the proposed direct job relationship. New handover assets use the same register, and direct manual asset creation requires an owned customer and one of that customer's active service sites.

The installer CRM now includes a searchable asset register with lifecycle, category and warranty filters. Each direct customer account includes its installed assets, manual asset creation and a site-filtered timeline of enquiry, job, appointment, note, handover, asset and service events. Mixed events use one deterministic descending order with source and record tie-breakers. All reads and writes remain owner-scoped and exclude protected marketplace identity and address sources.

## Recommended next milestone

### P6-2D: build quote line items and customer acceptance

Outcome: replace aggregate-only quote tracking with a durable, versioned quote that a direct customer can review and accept, while keeping payments and accounting out of this slice.

### In scope

- Add owner-scoped quote headers and versioned line items linked to the authoritative customer, service site and job.
- Support product, labour and adjustment lines with quantity, unit price, tax treatment, subtotal and total calculations.
- Preserve quote versions and record which version was issued, accepted, declined or superseded.
- Add a direct-customer review and acceptance record with consent wording, timestamp and authenticated actor evidence.
- Show quote status and accepted totals in the existing job finance workspace without duplicating customer, site, job or asset records.
- Add executable calculation, ownership, versioning and acceptance tests.

### Explicitly out of scope

- Sending quote emails, SMS messages or automated reminders.
- Deposits, card payments, payment schedules, invoicing or accounting export redesign.
- Product purchasing, stock allocation or supplier-order automation.
- AI pricing, public write APIs or protected marketplace identity disclosure.

### Acceptance criteria

- Every quote belongs to one owner-scoped direct job, customer and service site.
- Quote totals derive only from versioned line items using deterministic integer-cent calculations.
- Issuing a changed quote creates a new immutable version instead of rewriting the accepted source.
- Acceptance records the exact quote version, consent statement, actor and timestamp.
- Protected marketplace jobs cannot create or expose direct-customer acceptance records without an existing authorised customer path.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- The quote model would duplicate the P6-2A customer/site or existing job source of truth.
- The implementation needs outbound messaging, payment collection, accounting mutation or supplier purchasing.
- Acceptance cannot be tied to one immutable quote version and authenticated actor.

## Recommendation after P6-2D

Build P6-2E as team scheduling and capacity planning across jobs and appointments, preserving the existing job and appointment contracts.
