# Next task handover

Status: active rolling handover
Prepared: 18 July 2026
Implementation baseline: `17c82f062ef83f6c2be52012b87d4752a6619f89` on `codex/sites-custom-domain-migration`, published as Sites version 155 before the P6-2P batch.

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

## Completed milestones

P6-2O adds an owner-scoped photo-template library with draft, published and archived states. Owners, managers and coordinators can create, duplicate, revise and publish requirements with useful and avoid examples. Published versions are insert-only, archived templates cannot seed new requests, and the safe service defaults remain available.

P6-2P adds deliberate direct-customer photo-request delivery. The job workspace previews a masked email or verified mobile before sending, requires an explicit current-request confirmation and keeps manual copy and share available. A manual CRM customer can receive an operational email after the office user confirms the customer asked for it. SMS additionally requires the matching active customer account, current project-update consent, verified primary mobile, active provider callbacks and the approved Australian sender flag.

Current link secrets are encrypted at rest with the existing protected credential key while their hashes remain the capability verifier. Each replacement increments a token issue and invalidates unfinished deliveries for older issues. Initial sends, two resends and one final-seven-day expiry reminder are independently idempotent by request revision, token issue, intent and channel. Failed sends are atomically claimed and capped at three attempts.

Authenticated Resend and Twilio callbacks now update the photo-request delivery ledger and propagate customer opt-outs. The administrator delivery workspace exposes only channel, intent, status, provider result, attempt count and timestamps. It contains no customer contact, secure link, capability token or image data. Existing links issued before this migration remain valid for manual sharing but must be replaced once before protected provider delivery because their plaintext secret was deliberately never retained.

Live-trade wording validation remains deferred until trades are onboarded, as authorised on 18 July 2026. This does not block implementation or signed-in responsive release inspection.

## Next milestone contract

### P6-2Q batch: customer completion, proof review and targeted retake

Outcome: a customer can clearly finish a photo request, and the installer can review each requirement, accept useful proof or request a bounded retake without losing the original evidence or sending a new broad request.

### Five linked review items

1. Add a customer completion action that checks every required requirement has at least one current upload and records the request revision and checklist acknowledgement.
2. Add installer review states for each requested requirement: pending, accepted, retake requested or not needed, while preserving every original upload and audit event.
3. Add bounded reason codes and safe prewritten guidance for retakes, with no image analysis and no unrestricted customer or administrator notes.
4. Reopen only the affected requirement through the current secure link and reuse P6-2P for one targeted follow-up per review revision.
5. Add job-level proof readiness and privacy-safe aggregate review outcomes to the field record and template reporting without exposing image content or customer identity.

### In scope

- The exact direct job, current P6-2N request, P6-2O requirement snapshot and P6-2P delivery controls.
- Owner, manager and coordinator review, plus read-only field visibility of review state.
- Additive review and completion records with immutable events.
- Existing private R2 evidence and signature, metadata and authorisation controls.

### Explicitly out of scope

- AI or automated image scoring, OCR, face detection or photo-content classification.
- Customer free-text messaging, marketing campaigns or recurring reminders.
- Deleting rejected evidence, editing original uploads or changing published templates from a job review.
- Marketplace evidence, quoting, scheduling, dispatch, invoicing or live tracking.

### Acceptance criteria

- Customer completion fails with a clear requirement list until every required item has an upload.
- Only the current active capability can complete or answer a targeted retake.
- Only an owner, manager or coordinator can accept, waive or request a retake.
- Review history is immutable and original evidence remains available to authorised job users.
- A targeted follow-up is idempotent for the request revision, review revision and current token issue.
- Field and administrator payloads expose no customer contact, capability token or image-derived content.
- Desktop and 390 px customer completion and installer review have no document-level horizontal overflow.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- Review would require image analysis, customer free text or a new provider.
- A retake flow would rotate the current link unexpectedly or remove original evidence.
- The slice expands into quoting, appointment messaging, protected marketplace evidence or general chat.
