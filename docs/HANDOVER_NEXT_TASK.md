# Next task handover

Status: active rolling handover
Prepared: 18 July 2026
Implementation baseline: `754f59137684b0ed1edf9b9a720fe8cebbaf136b` on `codex/sites-custom-domain-migration`, published as Sites version 150.

## Current delivery summary

The installer Jobs index correction is live on Sites version 150. The dashboard summary and job list use the same owner-scoped active-work boundary, the Jobs API returns HTTP 200, and signed-in visual verification showed the expected single job in the list and detail workspace. A regression assertion protects the corrected SQL boundary.

P6-2K makes customer trade requests useful for quoting before personal contact is released. The guided request now requires structured property context covering storeys, approximate age and floor area, roof, switchboard and normal access timing. Customers can add property photos, take a new photo through a supported phone or tablet camera, or attach PDF supporting documents.

The privacy boundary is explicit and enforced server side. Every active verified installer allocated to the exact enquiry can view every customer-approved photo and document for quoting guidance while identity, contact details, exact location, private notes and usage data remain withheld. Every installer evidence download is authorised against the current match and recorded. Browser MIME claims are checked against the uploaded file signature. Supported phone photos are converted to bounded JPEGs in the browser, and the server strips JPEG, PNG or WebP metadata before storage. Installer downloads use neutral filenames.

Customers must acknowledge the photo-sharing notice before submission. The consent receipt records notice version `2026-07-18-quoting-photos`. Customers can remove future evidence access, with clear notice that this cannot erase information an installer already viewed or saved.

After a shortlisted installer receives a deliberate contact release, the customer can accept that installer for site assessment and scheduling preparation. Acceptance closes other matches and releases and permits only that installer to create a CRM job from the platform lead.

Arrival windows are installer owned. Only the accepted installer can propose one to three non-overlapping future windows, each between 30 minutes and four hours and within 180 days. Future-time validation uses the property state's Australian timezone. The customer can select one current revision or choose a fourth direct-contact option. Direct contact reveals only the installer business name, contact number, email and ABN, snapshots the disclosure and creates an admin-visible audit notification.

P6-2L materialises a customer-selected arrival window as an unassigned CRM appointment only when the exact accepted installer converts the matched lead to a CRM job. Dispatch assignment continues through the existing owner-scoped staff, availability, working-hours, overlap and revision checks. The verified customer can then acknowledge a bounded site-preparation checklist without seeing internal staff or job records.

Migration `0058_trade_contact_arrival_handoff.sql` adds mandatory trade ABN storage, direct-contact disclosure snapshots, CRM job and appointment links and customer preparation acknowledgement state. New and updated trade profiles require a valid ABN, business name, business contact number and account email.

The upgraded AEA Twilio account remains configured, but the `TLink` Australian sender registration still needs the genuine brand evidence that becomes available on Monday. SMS remains disabled until Twilio approves and provisions the sender.

P6-2M adds one revision-bound operational notification event for each customer-arrival appointment creation, first staff assignment, authorised appointment change and customer preparation confirmation. Customer email requires active optional project updates, an active customer-account consent receipt and no channel opt-out. Installer email requires an active consenting trade account with operational email enabled. Customer SMS additionally requires a verified mobile, current channel consent, active provider callbacks and the explicit `TLINK_SMS_SENDER_APPROVED` release flag, which remains false by default.

Each event creates idempotent audience and channel delivery records without storing recipient contact details in the admin payload. Provider sends are atomically claimed, daily-limit checked and capped at three attempts. Authenticated Resend and Twilio callbacks update both service-reminder and appointment delivery ledgers. The existing administrator delivery workspace now shows privacy-safe appointment delivery health and bounded retry controls.

## Recommended next milestone

### P6-2N batch: useful-photo checklist and self-review

Outcome: customers can capture quote-useful project photos with service-specific guidance and complete a private self-review before sharing, without automated image scoring.

### Five linked delivery items

1. Add service-specific photo examples for solar, batteries, switchboards, heating and cooling, hot water, insulation and EV charging.
2. Add accessible capture guidance covering lighting, distance, orientation and avoiding people, documents, street numbers and unrelated belongings.
3. Add a customer self-review checklist for clarity, relevance and accidental private information before upload consent.
4. Record checklist version and customer acknowledgement with the existing evidence event, without storing image scores or inferred property facts.
5. Show verified installers the customer-confirmed checklist categories and limitations beside authorised evidence without changing evidence-access scope.

### In scope

- Reuse the existing customer project evidence upload, phone capture, R2 storage, metadata stripping, consent and installer authorisation boundaries.
- Keep the checklist service-specific, keyboard accessible and readable on phone capture screens.
- Store only the checklist version, selected category and acknowledgement time needed to explain the evidence context.
- Keep the implementation inside the customer-project evidence boundary and its existing installer evidence view.

### Explicitly out of scope

- Automated image scoring, quality ranking, object recognition or AI analysis.
- New evidence recipients, public media links or changes to installer allocation rules.
- Appointment notification, dispatch, live tracking or marketing work.

### Acceptance criteria

- Every supported service category has concise useful and avoid examples.
- The customer must review clarity, relevance and private-information warnings before sharing new evidence.
- Evidence MIME, signature, metadata stripping, size, R2 privacy and allocated-installer authorisation checks remain unchanged.
- Installer evidence context reveals checklist category and limitations but no additional customer identity or contact data.
- Desktop and mobile capture flows remain usable without horizontal overflow.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- A checklist field would require retaining new household identity, documents or inferred private facts.
- The work would weaken current evidence signatures, metadata stripping, consent or installer allocation checks.
- The slice expands into automated image analysis or a broad evidence-workspace redesign.

## Recommendation after P6-2N

Batch the next five linked customer-to-installer arrival follow-through items only after P6-2N live evidence confirms the checklist is understandable on desktop and mobile.
