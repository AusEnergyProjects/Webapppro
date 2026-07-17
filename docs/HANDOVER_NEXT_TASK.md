# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: `e5ddc94` on `codex/sites-custom-domain-migration`, Sites version 123

## Current delivery summary

P6-2B adds the unified installer enquiry inbox and generic import contract on top of the P6-2A customer, contact and service-site foundation.

Migration `0048_unified_enquiry_inbox.sql` adds owner-scoped enquiries, conversation records, attachment metadata and audit events. Existing and future marketplace allocations enter the same inbox as protected reference-only records. The migration and runtime synchronisation retain only the protected reference, project scope and broad service region. They do not copy a household identity, phone, email, postcode or street address into installer CRM.

Direct enquiries support the states `New`, `contacted`, `site visit`, `quote required`, `quoted`, `booked`, `won` and `lost`. Conversion requires an explicit choice between a new customer and a visible duplicate candidate matched by email, phone, business number or service address. A new conversion creates one P6-2A customer, primary contact, primary service site and site-contact assignment in one database batch. The enquiry remains the authoritative source and conversation record after conversion.

The guided importer now accepts generic CSV and `.xlsx` files. Installers map source columns to the AEA contract before creating a durable preview. Preview and validation do not write live CRM entities. Confirmed enquiry and customer imports use the same owner-scoped batch totals, issue export, row decisions and seven-day rollback as historical jobs and wholesaler products. Customer imports now create the P6-2A contact and service-site structure, while historical jobs link to the customer's primary service site when available.

## Recommended next milestone

### P6-2C: build the installed-asset and customer timeline foundation

Outcome: create one service-history view across customer, site, job and installed equipment without extending aggregate job fields.

### In scope

- Add owner-scoped installed assets linked to the authoritative P6-2A customer and service site.
- Record product identity, model, serial number, installation date, warranty dates and commissioning references.
- Build a chronological customer and site timeline from enquiry, job, appointment, note, handover and asset events.
- Reuse published handover product data where it exists, with an explicit installer review before creating an asset.
- Add asset search, status and warranty filters plus focused ownership and history tests.
- Keep protected marketplace records reference-only until an existing consent path authorises customer-owned identity data.

### Explicitly out of scope

- Automated service reminders or outbound communications.
- Stock, purchasing, accounting, payments or quote redesign.
- AI recommendations, public write APIs or competitor-specific migrations.
- Replacing the existing handover, warranty-claim or field-work workflows.

### Acceptance criteria

- Every installed asset belongs to one owner-scoped customer and service site.
- Asset creation never duplicates or bypasses the P6-2A customer and site entities.
- The timeline preserves source references and orders mixed event types deterministically.
- Handover-derived assets require an explicit installer review and remain traceable to the handover source.
- Protected marketplace identity and address fields remain excluded without existing consent.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- The asset model would duplicate customer, site, product or handover sources of truth.
- A timeline entry requires exposing protected marketplace identity or address data.
- The work expands into outbound messaging, finance, purchasing or quote redesign.

## Recommendation after P6-2C

Build P6-2D as the quote line-item and customer acceptance foundation, using the P6-2A customer/site and P6-2C asset history as authoritative context.
