# Next task handover

Status: active rolling handover
Prepared: 18 July 2026
Implementation baseline: `93bc34c1d24e093610a3018a212fe89bd58b99e3` on `codex/sites-custom-domain-migration`.

## Current delivery summary

P6-2K makes customer trade requests useful for quoting before personal contact is released. The guided request now requires structured property context covering storeys, approximate age and floor area, roof, switchboard and normal access timing. Customers can add property photos, take a new photo through a supported phone or tablet camera, or attach PDF supporting documents.

The privacy boundary is explicit and enforced server side. Every active verified installer allocated to the exact enquiry can view its customer-approved quoting photos while identity, contact details, exact location, private notes and usage data remain withheld. Supporting documents remain restricted until the household accepts one connected verified installer. Every installer evidence download is authorised against the current match and recorded. Browser MIME claims are checked against the uploaded file signature. Supported phone photos are converted to bounded JPEGs in the browser, and the server strips JPEG, PNG or WebP metadata before storage. Shared quoting-photo downloads use a neutral filename.

Customers must acknowledge the photo-sharing notice before submission. The consent receipt records notice version `2026-07-18-quoting-photos`. Customers can remove future evidence access, with clear notice that this cannot erase information an installer already viewed or saved.

After a shortlisted installer receives a deliberate contact release, the customer can accept that installer for site assessment and scheduling preparation. Acceptance closes other matches and releases, unlocks restricted supporting documents and permits only that installer to create a CRM job from the platform lead.

Arrival windows are installer owned. Only the accepted installer can propose one to three non-overlapping future windows, each between 30 minutes and four hours and within 180 days. Future-time validation uses the property state's Australian timezone. The customer can select one current revision. A proposal or selection does not create or change a CRM appointment.

Migration `0057_customer_property_arrivals.sql` adds structured property context, R2-backed evidence metadata and immutable evidence events, plus revisioned installer arrival proposals and immutable proposal and selection events.

The upgraded AEA Twilio account remains configured, but the `TLink` Australian sender registration still needs the genuine brand evidence that becomes available on Monday. SMS remains disabled until Twilio approves and provisions the sender.

## Recommended next milestone

### P6-2L: reviewed appointment creation and customer preparation

Outcome: turn the customer-selected installer arrival window into a reviewed CRM appointment, then give the verified appointment customer a bounded preparation checklist without exposing internal job or staff records.

### In scope

- Let the accepted installer create a CRM appointment from the current customer-selected arrival window.
- Reuse the existing owner-scoped scheduling and conflict checks before any appointment is saved.
- Preserve the source proposal and selected-window revision on the job and appointment audit trail.
- Let authorised staff publish a bounded customer preparation checklist for that appointment.
- Let only the verified appointment customer view and acknowledge published preparation items.
- Invalidate or explicitly reconfirm preparation state after an accepted appointment change.
- Add customer, installer, dispatch, conflict, revision, privacy and responsive contract tests.

### Explicitly out of scope

- Live staff location, GPS tracking, route optimisation or automatic arrival estimates.
- Customer access to internal CRM notes, hazards, staff rosters, capacity or other customer records.
- Compliance sign-off, job-form completion, cancellation fees or third-party calendar writes.
- Automatic email or SMS delivery while the required sender remains disabled.
- The future useful-photo checklist, photo scoring or automated image analysis.

### Acceptance criteria

- A platform appointment can be created only by the accepted installer from the current selected arrival-window revision.
- Existing team availability and overlap rules are rerun before appointment creation.
- Proposal selection alone still does not create or modify an appointment.
- Only the verified appointment customer can view or acknowledge a published preparation checklist.
- Draft and superseded checklist content is never customer visible.
- Appointment changes invalidate or explicitly reconfirm customer-visible preparation state.
- No checklist payload contains internal notes, hazards, staff availability or another customer record.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- Appointment ownership cannot be tied to the same accepted marketplace match, job and verified-customer boundary.
- A checklist item requires exposing an internal note, private hazard record or another customer record.
- The slice expands into live tracking, automated outbound delivery, regulated compliance certification or dispatch optimisation.

## Recommendation after P6-2L

Build P6-2M as consent-aware appointment reminders and reviewed status notifications through the existing provider, opt-out and callback boundary. Complete the `TLink` Australian sender registration when the genuine evidence becomes available, then keep SMS disabled until Twilio approval is confirmed.
