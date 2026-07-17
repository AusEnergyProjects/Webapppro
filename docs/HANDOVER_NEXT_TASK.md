# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: `5bff61906e490d8bcd6f60402fb16cb0011b70c1` on `codex/sites-custom-domain-migration`, published as Sites version 135

## Current delivery summary

P6-2G adds the outbound service reminder boundary to the existing P6-2F preparation queue. Resend email and Twilio SMS remain disabled until protected Sites credentials, verified senders and authenticated callbacks are ready.

Migration `0053_service_reminder_delivery.sql` adds global channel settings, one idempotent delivery per follow-up, channel and content revision, immutable provider events, verified mobile contacts and customer channel opt-outs. Existing customer accounts, asset preferences, follow-ups and service plans remain authoritative.

Owners, managers and coordinators must review the exact prepared content before a send control becomes available. Current consent, channel preference, customer ownership, provider readiness and daily limits are rechecked on the server. Resend and Twilio callbacks are authenticated and replay safe. Bounce, complaint and STOP events suppress pending delivery and future eligibility for that channel.

Customers explicitly select email and SMS per asset. Email uses the verified private account address. SMS remains unavailable until Twilio Verify confirms the customer's Australian mobile number. Contact details stay server-side and are released only to the selected provider at the authorised send boundary.

## Recommended next milestone

### P6-2H: service follow-up performance and workload reporting

Outcome: give owners and operations staff consent-safe aggregate reporting for follow-up workload and delivery health without customer ranking or staff performance scoring.

### In scope

- Add due, ready, sent, delivered, failed, bounced and opted-out trends.
- Add workload by due-state, asset category, service type and assigned team member.
- Keep customer and contact identifiers out of aggregate reporting payloads.
- Add date and channel filters using the delegated date picker contract.
- Add CSV export for visible aggregate rows only.
- Add focused aggregation, privacy, pagination and responsive tests.

### Explicitly out of scope

- Customer scoring, staff ranking, commission metrics or productivity surveillance.
- Marketing attribution, campaign automation or sales lead nurturing.
- Replacing the P6-2G provider delivery ledger.

### Acceptance criteria

- Every metric resolves to existing follow-up or delivery records.
- Aggregate payloads exclude customer names, account emails, mobile numbers and street addresses.
- Filters and exports use identical server-side boundaries.
- Large result sets remain bounded and indexed.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- A requested metric requires exposing customer contact details.
- Reporting would create customer or worker ranking.
- The slice expands into campaign automation or external analytics tracking.

## Recommendation after P6-2H

Build P6-2I as customer self-service rescheduling requests that create reviewed CRM tasks without automatic appointment changes.
