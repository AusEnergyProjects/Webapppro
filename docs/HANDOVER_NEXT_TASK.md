# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: `5fb6511` on `codex/sites-custom-domain-migration`, Sites version 127

## Current delivery summary

P6-2D replaces manual aggregate quote entry with a durable direct-customer quote boundary linked to the authoritative P6-2A customer, service site and job.

Migration `0050_versioned_trade_quotes.sql` adds one owner-scoped quote header per direct job, immutable issued versions, version-owned product, labour and adjustment lines, and authenticated customer decision evidence. Quantities use thousandths and all prices, subtotals, GST and totals use deterministic integer-cent calculations. Drafts may be edited; changing an issued quote supersedes that version and creates the next draft rather than rewriting history.

Installers select an acceptance email from the direct customer's authorised primary or additional contacts. Issuing a quote records the exact version, calculated total, terms, expiry date and generated consent statement. A customer can review and accept or decline only after signing into an active AEA customer account with that verified email. Acceptance retains the customer Firebase identity, verified email, authentication time, sign-in provider, exact consent statement and decision timestamp. Protected marketplace jobs remain in the existing platform quote workflow and cannot enter this direct acceptance path.

The installer finance workspace now treats the versioned quote as authoritative for quoted totals and status while retaining estimate, invoice and payment progress. The customer account includes a direct-quotes workspace with line-level price, GST, terms, expiry and immutable decision history.

## Recommended next milestone

### P6-2E: build team scheduling and capacity planning

Outcome: coordinate appointments and job assignments across the existing team without replacing job, appointment or field-work sources of truth.

### In scope

- Add owner-scoped team availability and working-hour records linked to existing active team members.
- Build a week-based schedule from existing CRM appointments and assigned jobs.
- Show unassigned work, staff capacity, overlapping appointments and unavailable periods.
- Allow dispatch or owner roles to assign and reschedule appointments with optimistic conflict checks.
- Preserve authoritative customer, service-site, job and appointment links in every schedule action.
- Add staff, job, service, site and status filters plus focused assignment and conflict tests.

### Explicitly out of scope

- Route optimisation, GPS tracking or automated travel-time promises.
- Payroll, timesheets, leave approval or workforce performance scoring.
- Customer email, SMS or push notifications.
- Replacing field-work sync, job numbering, appointment records or team permissions.

### Acceptance criteria

- Every schedule item resolves to one owner-scoped job, service site and existing appointment.
- Only authorised owner or dispatch roles can change another staff member's assignment.
- Overlaps and unavailable periods are identified server-side before a schedule write succeeds.
- Rescheduling preserves appointment identity and writes a durable job event.
- Protected customer jobs expose only their existing reference-safe schedule information.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- Scheduling would require duplicating jobs, appointments, service sites or team membership.
- Conflict detection needs live location tracking, payroll data or customer identity disclosure.
- The implementation expands into outbound notifications or route optimisation.

## Recommendation after P6-2E

Build P6-2F as consent-aware service follow-up and reminder preparation using the P6-2C asset history and P6-2E schedule, with outbound delivery remaining a separately approved capability.
