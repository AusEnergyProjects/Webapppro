# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: `d3b69fb` on `codex/sites-custom-domain-migration`, Sites version 122

## Current delivery summary

Phase 6 Build step 1 opened the core trade workspace to verified businesses without a paid membership. P6-2A now establishes the customer and service-site foundation for verified installers.

The existing `trade_crm_customers` record remains the authoritative customer account. Additive contact, service-site and site-contact entities support multiple people and locations without duplicating existing customer accounts. New customer creation writes a primary contact and primary site in one database batch.

Migration `0047_customer_service_site_foundation.sql` backfills one primary contact and service site for every active direct CRM customer, assigns the contact to that site and links existing direct jobs. Protected marketplace jobs remain unlinked and continue to expose only their protected reference and broad service region.

The customer workspace now creates and edits contacts and sites, records access, parking and hazard instructions, assigns service contacts and selects the authoritative site for a direct job. All reads and writes remain same-origin, authenticated, installer-only, verification-gated and owner-scoped.

## Recommended next milestone

### P6-2B: build the unified enquiry inbox and generic import contract

Outcome: capture every direct and marketplace enquiry in one owner-scoped inbox and convert it into the P6-2A customer and site model without losing source or conversation history.

### In scope

- Add a durable owner-scoped enquiry, source, conversation and attachment-metadata contract.
- Add the inbox states `New`, `contacted`, `site visit`, `quote required`, `quoted`, `booked`, `won` and `lost`.
- Convert an enquiry into an existing or new customer account and service site with duplicate review by email, phone, business number and address.
- Accept generic CSV and Excel files with column mapping, preview, validation, duplicate handling, reconciliation totals, error export and rollback.
- Preserve external record IDs, source attribution and protected marketplace boundaries.
- Add focused executable tests for conversion, duplicate handling, import rollback, ownership and protected fields.

### Explicitly out of scope

- Competitor-specific import formats or migration logic.
- Sending email or SMS, telephony integration or a public write API.
- Quote line items, online acceptance, deposits or invoices.
- Scheduling redesign, stock, purchasing, accounting, AI or mobile-field changes.
- Releasing protected marketplace identity, contact or street-address fields.

### Acceptance criteria

- An enquiry converts without losing source, conversation or supplied fields.
- Conversion targets only the P6-2A customer, contact and service-site entities.
- Import preview and validation do not mutate live CRM records.
- Confirmed import can be reconciled and rolled back as one owner-scoped batch.
- Duplicate candidates require an explicit owner-visible choice rather than silent merging.
- Protected marketplace fields remain excluded unless existing consent rules authorise them.
- npm run validate passes on the exact release commit.

### Stop and escalate if

- The import requires competitor-specific assumptions or silent field loss.
- Duplicate resolution cannot remain an owner-visible decision.
- The change requires releasing protected marketplace identity, contact or service-address data.
- The work expands into outbound communications, quote redesign, finance or field workflow.

## Recommendation after P6-2B

Build P6-2C as the installed-asset and customer timeline foundation. Reuse the customer and service-site entities rather than extending aggregate job fields.
