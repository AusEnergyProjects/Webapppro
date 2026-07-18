# Next task handover

Status: active rolling handover
Prepared: 18 July 2026
Implementation baseline: `0fbdd62d05acf54a8e284e051b47a3c2e79ed06b` on `codex/sites-custom-domain-migration`, published as Sites version 154 before the P6-2O batch.

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

## Completed milestone

P6-2O adds an owner-scoped photo-template library with draft, published and archived states. Owners, managers and coordinators can create, duplicate, revise and publish requirements with useful and avoid examples. Published versions are insert-only, archived templates cannot seed new requests, and the safe service defaults remain available.

Each direct-job request stores its complete editable requirements plus source template and immutable version. Later template publication or archival does not rewrite the job snapshot or customer link. The business library reports selections, job edits, requested and completed requirements and controlled useful, unclear, unnecessary or missing feedback. Queries contain no customer identity, address, contact details or image-derived content.

## Live-trade gate before the next implementation batch

Use P6-2N and P6-2O with participating trades to confirm the requested photo wording, useful and avoid examples, typical requirement count and whether customers understand the existing manual share flow. Record changes through the versioned template library rather than altering issued requests. Do not add image analysis or customer free-text feedback.

## Next milestone contract

### P6-2P batch: consent-aware photo-request link delivery

Outcome: an authorised installer office user can send, monitor and safely resend a job photo-request link through the customer's permitted channel without exposing the capability token in administrator reporting.

### Five linked delivery items

1. Add an explicit email or SMS channel choice and recipient preview before sending the current active photo-request link.
2. Create idempotent, privacy-safe delivery records with provider message references, timestamps and authenticated receipt updates.
3. Add bounded resend and expiring-link reminder controls that always use the current token and stop after revocation, replacement, completion or opt-out.
4. Apply the existing customer channel consent, verified-mobile, channel opt-out, provider availability, daily-limit and SMS sender-approval checks.
5. Extend administrator delivery health with aggregate photo-request delivery outcomes and bounded retry controls without showing customer contact details or link secrets.

### In scope

- Reuse the existing Resend, Twilio, consent, opt-out, callback, delivery-claim and administrator health boundaries.
- Require a current active P6-2N request and direct customer owned by the installer business.
- Keep manual copy and share available when a provider channel is unavailable.
- Keep SMS suppressed while the `TLink` Australian sender remains unapproved.

### Explicitly out of scope

- Marketing messages, recurring campaigns or unbounded automated reminders.
- New customer contact fields, consent models or provider accounts.
- Template editing, image scoring or photo-content analysis.
- Marketplace customer evidence, appointment delivery, dispatch or live tracking.

### Acceptance criteria

- Only an owner, manager or coordinator can send or retry a photo-request link.
- Delivery is suppressed unless the exact customer and channel pass existing consent and provider checks.
- Idempotency prevents duplicate sends for the same request revision, token issue and delivery intent.
- Revoked, expired or replaced links cannot be sent or retried from stale delivery records.
- Provider callbacks update delivery health without accepting unauthenticated events.
- Administrator payloads contain no contact details, capability tokens or customer images.
- Desktop and 390 px send and delivery-history controls have no document-level horizontal overflow.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- Live-trade testing shows the request or template workflow must change before delivery automation.
- A provider requires a new paid service, credential or unapproved Australian sender.
- The work would create a second consent source of truth or expose link secrets in logs, events or admin payloads.
- The slice expands into marketing automation or protected marketplace evidence.
