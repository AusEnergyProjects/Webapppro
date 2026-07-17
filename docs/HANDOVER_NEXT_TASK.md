# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: `61e0a1b837d0762bce250f9bc41db8c16986a5e4` on `codex/sites-custom-domain-migration`, published as Sites version 137.

## Current delivery summary

P6-2H adds privacy-safe aggregate reporting to the service follow-up and delivery boundary. Owners and administrators can filter a maximum 366-day window by delivery channel, review daily due, ready, sent, delivered, failed, bounced and opted-out totals, inspect workload by due state, asset category and service type, and page through assigned open workload.

Migration `0054_service_follow_up_reporting.sql` adds only the date-first indexes needed by the bounded aggregate queries. Existing follow-ups, service plans, installed assets, team members, delivery records and opt-outs remain authoritative.

The reporting payload excludes customer names, account emails, mobile numbers, addresses, message content and customer identifiers. Assigned workload is alphabetical and contains no staff delivery outcomes or performance scoring. CSV export uses only the aggregate rows visible under the current server filters and staff page.

The AEA Resend account, sending-only API key, authenticated webhook and dedicated reminder subdomain are configured, and the domain is verified. The AEA Twilio account, protected credentials, Messaging Service, delivery callback and Advanced Opt-Out are configured. Twilio still requires an upgraded account, an approved Australian sender and a Verify Service. Both production delivery channels remain disabled until the deployed environment reports ready and an owner deliberately enables each channel.

## Recommended next milestone

### P6-2I: customer self-service rescheduling requests

Outcome: let a verified customer request a change to an existing future appointment while keeping every calendar change under installer review.

### In scope

- Let customers select an eligible future appointment and propose one or more preferred date windows.
- Capture a bounded reason and access notes without exposing internal CRM notes.
- Create one immutable rescheduling request plus an owner-scoped CRM task and audit history.
- Let authorised dispatch staff accept, reject or propose an alternative with revision protection.
- Change the appointment only after a deliberate staff decision and preserve the prior schedule revision.
- Use the delegated date picker contract and add customer, dispatch, conflict and responsive tests.

### Explicitly out of scope

- Automatic appointment changes when a customer submits a request.
- Customer access to internal notes, other customers, team capacity or private staff details.
- Deposits, cancellation fees, route optimisation or third-party calendar writes.

### Acceptance criteria

- Only the verified appointment customer can create or view the request.
- Duplicate active requests for one appointment are prevented.
- Every decision is revision protected, owner scoped and audited.
- Schedule conflict checks run again immediately before an accepted change.
- The previous and accepted appointment times remain reconstructable from revisions.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- The appointment cannot be tied to an authoritative customer ownership record.
- A requested path would change the calendar before staff review.
- The slice expands into billing penalties, external calendar providers or dispatch optimisation.

## Recommendation after P6-2I

Build P6-2J as customer-visible appointment preparation checklists and arrival windows sourced from the reviewed CRM appointment.
