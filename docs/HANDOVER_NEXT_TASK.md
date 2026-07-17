# Next task handover

Status: active rolling handover
Prepared: 18 July 2026
Implementation baseline: `46a70048c2d07091a538e1a622319603ab25dadb` on `codex/sites-custom-domain-migration`.

## Current delivery summary

P6-2J adds a customer-controlled handover from an anonymised AEA marketplace lead to one real, contactable installer relationship. Planning accounts remain usable without a phone or street address. A customer must complete a private phone number and full service address matching the project postcode and state before requesting trades.

The marketplace opportunity remains anonymised during allocation, interest and quote review. A customer can release their account name, verified account email, phone and service address only after shortlisting a structured quote and separately confirming the named verified installer. The exact released values are snapshotted for that installer match. Every other matched installer remains anonymised.

The installer opportunity API joins contact data only through the same owner-scoped match and only while its release is active. A customer can remove future portal visibility, with clear notice that information already viewed or saved cannot be erased. Withdrawing or completing the project also removes active portal visibility.

Migration `0056_customer_contact_release.sql` adds optional private customer contact defaults, one release snapshot per opportunity match and immutable release event history. Consent notice version, disclosed fields, customer actor, installer recipient and timestamps are retained. Real contact data never enters `trade_opportunities` or its anonymised summary.

The upgraded AEA Twilio account and supporting delivery services remain configured, but the `TLink` Australian sender registration is still a draft pending genuine brand-ownership and identity evidence. SMS remains disabled until Twilio approves and provisions the sender.

## Recommended next milestone

### P6-2K: customer-visible appointment preparation and reviewed arrival windows

Outcome: show the verified appointment customer exactly how to prepare for a reviewed future visit without exposing internal job notes, staff capacity or other protected records.

### In scope

- Let authorised dispatch staff publish a bounded preparation checklist for a future appointment.
- Source the customer-visible arrival window from the reviewed CRM appointment and its current revision.
- Let the verified appointment customer view the checklist and record readiness acknowledgements.
- Preserve published checklist revisions and immutable customer acknowledgement history.
- Create owner-scoped CRM follow-up tasks when required preparation remains incomplete near the visit.
- Invalidate or explicitly reconfirm preparation state after an accepted appointment change.
- Use the delegated date picker contract and add customer, dispatch, revision, privacy and responsive tests.

### Explicitly out of scope

- Live staff location, GPS tracking, route optimisation or automatic arrival estimates.
- Customer access to internal CRM notes, hazards, staff rosters, capacity or other customer records.
- Compliance sign-off, job-form completion, cancellation fees or third-party calendar writes.
- Automatic email or SMS delivery while production channels remain disabled.
- Expanding the new marketplace contact release into general trade access to the customer account, asset library or private project notes.

### Acceptance criteria

- Only the verified CRM appointment customer can view or acknowledge a published checklist.
- Draft and superseded checklist content is never customer visible.
- Arrival windows cannot fall outside the current reviewed appointment.
- Staff publication and customer acknowledgements are owner scoped, revision protected and audited.
- Appointment changes invalidate or explicitly reconfirm customer-visible preparation state.
- No checklist payload contains internal notes, hazards, staff availability or another customer record.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- A checklist item requires exposing an internal note, private hazard record or another customer record.
- The appointment cannot be tied to the same authoritative verified-customer ownership boundary used by P6-2I.
- The slice expands into live tracking, automated outbound delivery, regulated compliance certification or dispatch optimisation.

## Recommendation after P6-2K

Build P6-2L as customer appointment reminders and reviewed status notifications using the existing consent, provider and opt-out delivery boundary after the required channels are deliberately enabled. Complete the `TLink` Australian sender registration when the genuine evidence becomes available, then keep SMS disabled until Twilio approval is confirmed.
