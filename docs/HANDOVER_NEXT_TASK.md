# Next task handover

Status: active rolling handover
Prepared: 18 July 2026
Implementation baseline: pending validated P6-2L release on `codex/sites-custom-domain-migration`.

## Current delivery summary

P6-2K makes customer trade requests useful for quoting before personal contact is released. The guided request now requires structured property context covering storeys, approximate age and floor area, roof, switchboard and normal access timing. Customers can add property photos, take a new photo through a supported phone or tablet camera, or attach PDF supporting documents.

The privacy boundary is explicit and enforced server side. Every active verified installer allocated to the exact enquiry can view every customer-approved photo and document for quoting guidance while identity, contact details, exact location, private notes and usage data remain withheld. Every installer evidence download is authorised against the current match and recorded. Browser MIME claims are checked against the uploaded file signature. Supported phone photos are converted to bounded JPEGs in the browser, and the server strips JPEG, PNG or WebP metadata before storage. Installer downloads use neutral filenames.

Customers must acknowledge the photo-sharing notice before submission. The consent receipt records notice version `2026-07-18-quoting-photos`. Customers can remove future evidence access, with clear notice that this cannot erase information an installer already viewed or saved.

After a shortlisted installer receives a deliberate contact release, the customer can accept that installer for site assessment and scheduling preparation. Acceptance closes other matches and releases and permits only that installer to create a CRM job from the platform lead.

Arrival windows are installer owned. Only the accepted installer can propose one to three non-overlapping future windows, each between 30 minutes and four hours and within 180 days. Future-time validation uses the property state's Australian timezone. The customer can select one current revision or choose a fourth direct-contact option. Direct contact reveals only the installer business name, contact number, email and ABN, snapshots the disclosure and creates an admin-visible audit notification.

P6-2L materialises a customer-selected arrival window as an unassigned CRM appointment only when the exact accepted installer converts the matched lead to a CRM job. Dispatch assignment continues through the existing owner-scoped staff, availability, working-hours, overlap and revision checks. The verified customer can then acknowledge a bounded site-preparation checklist without seeing internal staff or job records.

Migration `0058_trade_contact_arrival_handoff.sql` adds mandatory trade ABN storage, direct-contact disclosure snapshots, CRM job and appointment links and customer preparation acknowledgement state. New and updated trade profiles require a valid ABN, business name, business contact number and account email.

The upgraded AEA Twilio account remains configured, but the `TLink` Australian sender registration still needs the genuine brand evidence that becomes available on Monday. SMS remains disabled until Twilio approves and provisions the sender.

## Recommended next milestone

### P6-2M: consent-aware appointment notifications

Outcome: notify the customer and installer about reviewed appointment and preparation milestones through the existing consent, opt-out, delivery and callback boundaries.

### In scope

- Prepare customer and installer appointment-created, staff-assigned, changed and preparation-confirmed notification events.
- Reuse the existing email and SMS consent, verified-contact, opt-out, idempotency and authenticated callback sources.
- Keep SMS disabled until the `TLink` Australian sender is approved and provisioned.
- Add administrator delivery health and retry visibility for the new appointment events.

### Explicitly out of scope

- Live location, route optimisation, automated arrival estimates or third-party calendar writes.
- Marketing campaigns or unrelated service reminders.
- The future useful-photo checklist, photo scoring or automated image analysis.

### Acceptance criteria

- Every outbound event is consent and opt-out checked and idempotently recorded.
- SMS remains disabled until provider approval is confirmed.
- Provider callbacks authenticate before changing delivery state.
- Notification payloads exclude private notes, staff capacity and unrelated customer records.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- A notification cannot be tied to the authoritative appointment, verified contact and active consent record.
- The sender approval remains unavailable and implementation would require enabling unapproved SMS traffic.
- The slice expands into marketing automation, live tracking or dispatch optimisation.

## Recommendation after P6-2M

Build P6-2N as the customer useful-photo checklist requested for a later stage, with service-specific examples, accessibility guidance and no automated image scoring in the first slice.
