# Next task handover

Status: active rolling handover
Prepared: 18 July 2026
Implementation baseline: `76bdbebdef353d0c53dfa1530935568cd99ab2ed` on `codex/sites-custom-domain-migration`, published as Sites version 151.

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

P6-2N completes the direct-customer photo request loop. An authorised installer office user can open a direct job, start from service-specific photo guidance, edit the exact requirements, issue or replace a 30-day secure link and revoke it when no longer needed. Only the link secret leaves the server; the database stores its hash.

The customer link exposes no name, address or contact details. It guides phone capture through clarity, relevance and private-information checks before every upload. Accepted JPEG, PNG and WebP files keep the existing signature checks, metadata stripping, size limits and private R2 storage, and appear in the exact job's field proof with the requirement, request revision, checklist version and acknowledgement time. The customer can remove a mistaken upload while the request remains active.

## Active milestone contract

### P6-2O batch: reusable business photo-request templates

Outcome: an installer business can maintain reusable upgrade-specific photo guidance based on trade feedback, while every job continues to receive an independent editable snapshot.

### Five linked delivery items

1. Add owner-scoped template records grouped by upgrade or service category, with draft, published and archived states.
2. Let authorised owner and coordinator users create, duplicate and revise template requirements with useful and avoid examples.
3. Snapshot the selected published template into each new job request so later template edits never rewrite an issued customer request.
4. Keep every job snapshot independently editable and record the template version that seeded it.
5. Add privacy-safe usage and feedback counts so trade interviews can identify unclear or unused requirements without analysing customer images.

### In scope

- Reuse the existing trade account, team roles, service categories and P6-2N job-request editor.
- Store templates within one installer business only. No cross-business sharing.
- Publish immutable template versions and copy their requirement payload into the job request.
- Count template selection, job-level edits, requested requirements and customer completion without inspecting image content.
- Keep the P6-2N defaults as the safe fallback when a business has no published template.

### Explicitly out of scope

- Automatic image scoring, object recognition or image-content analytics.
- Global AEA-authored template distribution or cross-business template sharing.
- Automatic provider email or SMS delivery of request links.
- Marketplace customer evidence, appointment, dispatch or live-tracking changes.
- Rewriting historical job requests when a template is revised or archived.

### Acceptance criteria

- Templates are owner scoped, role protected, versioned and migration safe.
- Published versions are immutable and archived versions cannot seed a new request.
- Creating a job request records a complete independent snapshot and its source template version.
- Editing a template does not alter an existing request or its customer link.
- Reporting contains no customer identity, address, contact details or image-derived content.
- Template library and job selection remain usable at desktop and 390 px without document-level horizontal overflow.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- Trade feedback requires image-content inspection or storing new household facts.
- A proposed template edit would mutate a previously issued job request.
- Cross-business or AEA-wide distribution is required without an explicit governance and approval model.
- The slice expands into automatic link delivery or the protected marketplace evidence domain.

## Recommendation after P6-2O

Batch consent-aware email and SMS delivery of photo-request links, delivery receipts, resend and expiry reminders, customer channel opt-outs and administrator delivery health only after the P6-2N share flow and P6-2O templates have been tested with live trades.
