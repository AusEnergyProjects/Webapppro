# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Implementation baseline: `17c21503924e3b1fb567cbec04d46a5b6fa5484b` on `codex/sites-custom-domain-migration`, published as Sites version 140.

## Current delivery summary

P6-2I adds verified-customer appointment change requests without allowing customer submissions to move the installer calendar. The customer account now has an Appointments workspace where the authoritative CRM customer email controls access to eligible future appointments and a customer can submit one to three bounded preferred windows, a reason and customer-visible access notes.

Each request creates an owner-scoped CRM task, immutable request event and appointment revision snapshot. Duplicate active requests are prevented at the database boundary. Customer request content remains unchanged while staff decisions, proposed alternatives and accepted appointment revisions are recorded separately.

Owners, managers and coordinators review requests in the existing team schedule. Rejecting or proposing an alternative leaves the appointment unchanged. Acceptance reruns team overlap, unavailability and working-hours checks immediately before the atomic update. Request and appointment revisions protect every decision, including competing dispatch actions, and the prior and accepted schedule remain reconstructable.

Migration `0055_appointment_rescheduling.sql` adds only the request, immutable event and appointment revision records required by this workflow. Existing CRM customers, contacts, jobs, appointments, tasks, team members, working hours and unavailable periods remain authoritative.

The AEA Resend account, sending-only API key, authenticated webhook and dedicated reminder subdomain are configured, and the domain is verified. The upgraded AEA Twilio account, protected credentials, Messaging Service, delivery callback, Advanced Opt-Out and SMS Verify Service with Fraud Guard are configured in deployed Sites environment revision 14. The `TLink` Australian sender registration remains a draft until genuine brand-ownership and identity evidence is available. Both production delivery channels remain disabled until an owner deliberately enables each channel, and SMS must remain disabled until Twilio approves and provisions the sender.

## Recommended next milestone

### P6-2J: customer-visible appointment preparation and arrival windows

Outcome: show the verified appointment customer exactly how to prepare for a reviewed future visit without exposing internal job notes, staff capacity or protected customer data.

### In scope

- Let authorised dispatch staff publish a bounded preparation checklist for a future appointment.
- Source the customer-visible arrival window from the reviewed CRM appointment and its current revision.
- Let the verified appointment customer view the checklist and record readiness acknowledgements.
- Preserve published checklist revisions and immutable customer acknowledgement history.
- Create owner-scoped CRM follow-up tasks when required preparation remains incomplete near the visit.
- Use the delegated date picker contract and add customer, dispatch, revision, privacy and responsive tests.

### Explicitly out of scope

- Live staff location, GPS tracking, route optimisation or automatic arrival estimates.
- Customer access to internal CRM notes, hazards, staff rosters, capacity or other customer records.
- Compliance sign-off, job-form completion, cancellation fees or third-party calendar writes.
- Automatic email or SMS delivery while production channels remain disabled.

### Acceptance criteria

- Only the verified CRM appointment customer can view or acknowledge a published checklist.
- Draft and superseded checklist content is never customer visible.
- Arrival windows cannot fall outside the current reviewed appointment.
- Staff publication and customer acknowledgements are owner scoped, revision protected and audited.
- Appointment changes invalidate or explicitly reconfirm customer-visible preparation state.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- A checklist item requires exposing an internal note, private hazard record or another customer record.
- The appointment cannot be tied to the same authoritative verified-customer ownership boundary used by P6-2I.
- The slice expands into live tracking, automated outbound delivery, regulated compliance certification or dispatch optimisation.

## Recommendation after P6-2J

Build P6-2K as customer appointment reminders and reviewed status notifications using the existing consent, provider and opt-out delivery boundary after the required channels are deliberately enabled.
