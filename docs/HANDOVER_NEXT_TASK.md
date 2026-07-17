# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: `83007b3` on `codex/sites-custom-domain-migration`, Sites version 129

## Current delivery summary

P6-2E adds team scheduling and capacity planning to the existing installer team, job, appointment and service-site sources of truth. It does not create a competing job or calendar model.

Migration `0051_team_scheduling_capacity.sql` adds recurring team working hours, bounded unavailable periods, appointment team-member assignments and appointment revisions. Existing jobs, appointments, team members and service sites remain authoritative. New schedule actions either reschedule an existing appointment or create one existing-CRM appointment for an unassigned job.

The installer dashboard and manager or coordinator staff portal now include a week schedule, capacity summaries, overlapping-appointment flags, an unassigned work queue and staff, service, site and conflict filters. Owner and dispatch roles can assign or reschedule work only after server-side revision, working-hours, overlap and unavailability checks. Every successful schedule change writes a durable job event and advances field sync for the assigned audience.

The account authority defect reported with P6-2E is also corrected. The admin portal and signed-in trade profile now pass the stored verification status into the shared entitlement resolver. An account saved as active and approved receives its role-appropriate core features, and active administrator grants unlock the selected specialist features. The admin account record remains the audited source of truth.

## Recommended next milestone

### P6-2F: build consent-aware service follow-up preparation

Outcome: turn installed-asset lifecycle dates into an actionable service follow-up queue while keeping outbound delivery separately controlled.

### In scope

- Derive due, upcoming and overdue service follow-up records from the existing installed-asset register, service plans and completed service events.
- Apply the customer's existing lifecycle communication preferences and consent receipts before a follow-up can become ready.
- Add owner-scoped follow-up status, assigned staff, due date, suppression reason and internal preparation notes.
- Show the queue in the installer workspace with customer, site, asset category, due-state, assignee and consent filters.
- Prepare customer-safe reminder content for review without sending email, SMS or push messages.
- Preserve asset, customer, service-site and job links and write durable audit events for readiness, suppression and completion changes.
- Add focused due-date, consent, ownership, privacy and status-transition tests.

### Explicitly out of scope

- Sending email, SMS, push notifications or automated campaigns.
- Marketing lead scoring, AI-written sales copy or autonomous outreach.
- Route optimisation, appointment auto-booking, payroll or technician performance scoring.
- Payments, subscription changes or accounting mutations.

### Acceptance criteria

- Every follow-up resolves to one owner-scoped installed asset, customer and service site.
- A follow-up cannot become ready when lifecycle communication consent is absent or withdrawn.
- Completed service events deterministically advance the next due date without duplicating reminders.
- Protected marketplace identity remains excluded unless an authorised customer ownership path already exists.
- Status changes are server-authorised, auditable and safe under repeated requests.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- The implementation would duplicate installed assets, service plans, customer preferences or appointment records.
- Follow-up preparation requires outbound provider credentials or customer contact disclosure outside existing consent.
- The slice expands into marketing automation, auto-booking, payments or route optimisation.

## Recommendation after P6-2F

Build P6-2G as an explicitly approved outbound service-reminder delivery boundary with provider credentials, deduplication, delivery receipts, opt-out handling and administrator monitoring.
