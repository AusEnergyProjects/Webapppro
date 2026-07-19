# Next task handover

Status: active rolling handover
Prepared: 19 July 2026
Implementation baseline: the current `codex/sites-custom-domain-migration` worktree includes the published guided-dispatch reliability and invoice correction ledger on top of the quick-invoice provider handoff. Exact published release identity is recorded in `RELEASE_TRUTH.md`.

## Completed milestone: guided quick invoice

- User outcome: the create-job buttons work without browser validation overlays, and the guided flow can optionally prepare and send a fixed-fee invoice with the appointment and photo request.
- Owning workflow: `TradeNewJobForm`, installer CRM bootstrap and create action, existing price-book, invoice, accounting, payment and integration contracts, feature-local styles and regression tests.
- In scope: quarter-hour appointment validation, inline error copy, optional sixth Invoice step, reusable fixed-fee price-book selection, a bounded custom invoice line, connected-provider-aware prompts, and one deliberate final action.
- Out of scope: new provider adapters, automatic payment collection, accepted-quote changes, protected AEA customer invoicing, accounting-provider calculations, and broad invoice or price-book redesign.
- Acceptance: no native black validation bubble for a normal quarter-hour time; invoice can be skipped; connected providers are not promoted again; selected invoice values use integer cents and authoritative saved items; the job, appointment, evidence request and optional invoice are owner scoped and idempotent; desktop and phone layouts have no document-level overflow.
- Validation: focused guided-job and invoice contract tests, complete `npm.cmd run validate`, clean migration replay, signed-in desktop and 390 px interaction QA, canonical health and worker-error checks.
- Stop condition: a new provider credential, a new payment or accounting adapter, customer card authorisation, or a second financial source of truth requires a separate milestone.

Release result: Sites version 178 from implementation commit `4968a64d1f947d18da5e4417d6371f84b282082d`, deployment `appgdep_6a5bcee8a55c819187773e30657b9d76`. Full validation passed and signed-in desktop plus 390 px QA reached the enabled final invoice action without creating production work or sending customer email.

## Completed milestone: quick-invoice provider handoff

- User outcome: a quick invoice already saved in TLink can be deliberately handed to one connected accounting provider or paired with one connected payment link without re-entering its customer, lines or totals.
- Owning workflow: `trade_crm_quick_invoices`, existing accounting and payment adapters, provider callbacks, invoice workspace and feature-local tests.
- In scope: one provider-neutral export command, exact integer-cent and GST reconciliation, existing connection reuse, idempotent external references, visible provider status and recoverable retry.
- Out of scope: automatic provider selection, automatic email or approval by an accounting provider, card handling in TLink, recurring billing, protected AEA customer invoicing and new provider credentials.
- Acceptance: TLink remains authoritative; one deliberate action exports one invoice; repeated actions cannot duplicate it; provider totals must match TLink cents; callbacks remain authoritative for payment; provider failure cannot lose or mutate the TLink invoice.
- Validation: accounting, payment-reconciliation and guided-invoice contract tests; TypeScript; ESLint; 29 integration tests; 635 passing full-suite tests with two intentional skips; clean D1 migration replay; production build; signed-in desktop and 390 px inspection; canonical health and worker-error checks.
- Stop condition: missing sandbox access, provider scope expansion, customer payment authorisation or a provider-specific source of truth requires a separate decision.

Release result: Sites version 179 from implementation commit `9200141d521bf3119d7e08fbeb36f82a3de2b05f`, deployment `appgdep_6a5c133b0a908191bd1e5d4b01d88943`. Saved quick invoices can deliberately create one exact draft in Xero, MYOB or QuickBooks, or one full-total Stripe or Square checkout, using the existing provider-neutral ledgers and idempotency boundaries. Provider-reported totals and TLink GST must match before state changes. Signed-in desktop and 390 px QA confirmed the current job and invoice workflows without document-level overflow. No production provider transaction was created because the account has no connected sandbox provider or disposable invoice.

## Completed milestone: guided-dispatch reliability and invoice correction ledger

- User outcome: an office user can correct an unissued invoice, or issue an auditable credit against an issued invoice, without overwriting the original financial record or losing the remaining balance.
- Owning workflow: `trade_crm_quick_invoices`, accounting documents, payment links and verified payment reconciliation, invoice workspace and feature-local tests.
- In scope: immutable issued-invoice revisions, provider-neutral credit snapshots, exact integer-cent and GST balance calculation, bounded payment allocation and a visible invoice history.
- Out of scope: provider-specific credit export, card refunds, automatic collections, recurring billing, new providers, protected AEA customer invoicing and accounting-provider calculation authority.
- Acceptance: an issued invoice is never overwritten; every correction or credit has a stable reference and reason; credits and verified payments cannot exceed the open balance; repeated commands and callbacks are idempotent; invoice subtotal, GST, paid, credited and outstanding cents reconcile exactly.
- Validation: domain and route tests for revision, credit and allocation boundaries; complete release gate; clean migration replay; signed-in desktop and phone-width inspection without creating production credits or refunds.
- Stop condition: external refund authority, a provider-specific credit API, a second currency or a second financial source of truth requires a separate milestone.

This release also closes the immediate guided-flow failures around that ledger. A valid custom fee now participates in the final invoice action without a second Add click. Photo-request delivery results are checked before the guided flow claims that email was sent. Appointment email includes the scheduled window, time selection uses the shared click-select quarter-hour picker, and Schedule supports an explicit week date, previous and next week controls, internal two-axis scrolling and day-plus-time drag placement.

Release result: Sites version 180 from implementation commit `c75d555c669a9fecbf5dd639488675346cb01c23`, deployment `appgdep_6a5c1c06195c8191a2a941766c595420`. Complete validation passed. Signed-in desktop and 390 px QA confirmed the click-select time dialog, valid quarter-hour state, selectable weeks, internal schedule scrolling and the enabled final quick-invoice action from an entered `$100.00` fee without clicking Add. The production Resend email channel was enabled after the delivery health view confirmed credentials and callbacks were ready. The affected job `TLJ-00000804` then recorded an initial photo-request email as `Sent | sent` and the UI reported that the secure link was accepted for delivery. No QA job, appointment, quick invoice, credit, refund or provider transaction was created.

## Completed milestone: customer appointment preparation

- User outcome: a customer can select up to three photos for each requested section, send the whole prepared set once, and add the confirmed appointment to Google Calendar without confusing duplicate actions or failed phone uploads.
- Owning workflow: `JobInformationUpload`, customer photo preparation, the capability-token upload route, R2 evidence storage, photo-request email delivery and feature-local styles and tests.
- In scope: client compression below the deployed request limit, multi-select and staged batch upload, three-file section limits, one final upload-and-finish action, precise partial-failure recovery, an appointment summary, a standard calendar attachment and a one-tap Google Calendar link.
- Out of scope: direct access to a customer Google account, background calendar insertion without customer permission, new storage vendors, unrestricted document types, SMS sender approval, image analysis, or changes to installer calendar mirrors.
- Acceptance: a normal Android camera photo is reduced below the edge request limit before upload; each section accepts no more than three safe images; every staged file is visibly accounted for; completed uploads are not repeated after a partial failure; server signature, metadata removal, owner scope and capability checks remain authoritative; calendar details use the appointment time and do not expose the service address; the phone layout has no document-level overflow.
- Validation: photo-preparation and route contract tests, calendar-link and invitation tests, complete `npm.cmd run validate`, clean migration replay, Android-sized interaction QA, canonical health and worker-error checks.
- Stop condition: larger original documents, video, direct-to-R2 resumable upload, Google account write access or a new customer-data disclosure requires a separate milestone.

Release result: Sites version 182 from implementation commits `1f96c09feb8f988dc9aabf2a40a125f7293086b3` and `e5934780a77151b5fcd53b23a9eaa42badb5faac`, deployment `appgdep_6a5c29873ce08191b009b5676db7d869`. Production logs confirmed the reported Android upload failed at the edge with HTTP 413 after the phone prepared requests of about 1.4 MB and 1.7 MB. Customer images are now prepared below 640 KB, staged visibly, limited to three per section and uploaded together through one final action with partial-failure recovery. The affected customer Gmail inbox received the corrected message and displayed a real 11:00 am to 1:00 pm invitation with Yes, Maybe and No controls, View on Google Calendar and the calendar attachment. Google required one first-time-sender trust action before it would add this and future invitations automatically; TLink does not bypass that private-account consent. Signed-in and 390 px live QA confirmed the customer page, Google handoff and no document-level horizontal overflow. No QA photo was uploaded. Complete validation, fresh D1 replay, production build, canonical health and worker-error checks passed.

## Active milestone contract: one job communication timeline

- User outcome: an office user can see appointment, evidence-request and invoice email state in one job timeline, understand whether each message is pending, accepted, delivered or failed, and deliberately retry an eligible failure without searching separate workspaces.
- Owning workflow: existing appointment, photo-request and invoice delivery ledgers; job workspace; administrator delivery health; feature-local tests.
- In scope: one privacy-safe owner-scoped read model, consistent status language, last attempt and failure reason, provider-ready warning before the final action, and bounded retry through existing delivery commands.
- Out of scope: a new provider, SMS sender approval, message editing, marketing campaigns, provider-specific financial documents, customer contact disclosure, or automatic retry without an office action.
- Acceptance: a final action never says sent unless the provider accepted the message; delivered is shown only after an authenticated callback; the job timeline stores no recipient address or secure-link secret; repeated retry cannot duplicate a successful intent; desktop and phone layouts remain usable without document-level overflow.
- Validation: focused delivery-ledger and retry tests, complete release gate, signed-in failure and accepted-send QA using non-sensitive status data, canonical health and worker-error checks.
- Stop condition: a new outbound provider, unapproved SMS sender, direct mailbox access, or a second communication source of truth requires a separate decision.

## Current delivery summary

The installer Jobs API returns the expected owner-scoped job, and the signed-in list and detail workspace show that job. The remaining client race was corrected in `aa771460b190c7e744caca216bb4c8dde3087c77`: superseded Jobs and Customers index requests are aborted and cannot replace current filter results. A regression assertion protects the cancellation boundary.

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

P6-2Q closes the direct-customer photo-proof review loop. Customers can explicitly finish a complete current request, while owners, managers and coordinators can accept, waive or request a bounded retake for each requirement. Completion and review revisions are append-only, reviewed originals cannot be removed, and a retake reopens only the affected requirement through the current secure link.

Retake guidance uses fixed reason codes and one revision-bound targeted follow-up through the existing consent-aware delivery controls. Field work receives read-only proof readiness, and photo-template reporting receives only aggregate review outcomes. No customer contact, capability token, image analysis or image-derived content is added to those payloads.

P6-3A establishes the authoritative owner-scoped price book. Owners, managers and coordinators receive a top-level workspace with quick-start labour, material and call-out presets; the default form requires only a name, type and sell price while cost, duration, capability and supplier detail remain optional. Active items support search, edit and archive without exposing internal commercial data to customer-facing quote payloads.

Migration `0064_trade_price_book.sql` stores integer-cent supplier cost and sell price, deterministic basis-point markup and margin, immutable price-change revisions and optional references to existing business capabilities and approved supplier catalogue products. Direct-job quote drafts can select an active item and the server snapshots its current authoritative commercial fields into the immutable quote version. Existing issued versions remain unchanged.

P6-3B adds a two-choice Items and Job packets library inside the existing Price book workspace, avoiding another navigation area for installers to learn. The first-run path sends an empty workspace back to add a reusable item, then asks only for packet name, service and saved items. Checklist, forms and suggested crew stay behind optional progressive disclosure.

Migration `0065_trade_job_packets.sql` adds owner-scoped packet composition and quote-line packet revision references. Current price-book values drive deterministic cost, sell, margin, duration and required-capability summaries. Existing job-template tasks, published forms and active team members remain authoritative. A packet with an archived item is visibly blocked from quote application. Applying the same ready packet again replaces its previous draft lines rather than duplicating them, while issued quote revisions remain immutable.

P6-3C adds one-action standard or Essential, Recommended and Complete quote creation from a ready job packet. The unchanged simple itemised path remains available. Office users can add customer-facing sections, optional extras and choose-one groups without enabling a feature flag or changing a document template.

Migration `0066_optioned_trade_quotes.sql` adds immutable choice definitions, option-line associations and exact customer selection evidence. Customer subtotal, GST and total update immediately and are recalculated on the server before acceptance. The verified acceptance records chosen option IDs, selection summary, integer totals and the exact consent statement. Internal cost and margin are limited to owners, managers and coordinators and are omitted from customer payloads.

P6-3D adds one secure no-account quote link per issued revision, immediate manual copy, deliberate email, replacement, revocation, automatic expiry, a branded phone-first review and print view, bounded customer questions, typed signature and one office activity timeline. The same server calculation validates customer choices and exact totals at acceptance, and every terminal decision clears the stored hash and encrypted recoverable secret.

Migration `0067_secure_quote_sharing.sql` adds quote links, privacy-safe events, questions and consent-aware delivery records plus exact signer, link issue, AUD commercial reference and actor evidence. The provider-neutral acceptance record uses stable references and integer cents for future Xero, MYOB, QuickBooks, Stripe and Square adapters. QuickBooks OAuth connection compatibility is present; its invoice export remains gated until the next adapter milestone.

P6-3E materialises every accepted quote as one immutable commercial handoff containing the selected scope, recorded terms, stable commercial reference and exact AUD subtotal, GST and total. Existing accepted quotes are materialised safely on first office access. The simple default is a 10 percent deposit, which can be changed to a percentage or fixed amount until a payment request exists.

Stripe and Square create at most one provider-hosted deposit request for the handoff using a deterministic idempotency key. TLink never handles card data, browser return is not payment evidence and only the existing authenticated provider callbacks can mark the deposit paid. Xero, MYOB and QuickBooks reuse the same accepted total and scope. QuickBooks now lists the connected company products and services, creates an unsent invoice through Accounting API minor version 75 and verifies that the provider total still equals the accepted TLink cents. No adapter approves or emails an invoice automatically.

Migration `0068_accepted_quote_handoff.sql` adds the immutable commercial handoff and binds deposit and accounting records to it. The office sees one progressive acceptance, deposit and accounting timeline with direct reconnect actions. Manual financial tracking remains available behind disclosure for work that does not use the accepted quote flow.

P6-3F foundation converts an accepted direct-customer scope once into owner-scoped job phases and requirements, preserves the accepted sell and known cost baseline, and exposes one readiness checklist for scope, forms, technician, materials and deposit. The office can preassign an invited technician while access remains blocked until invitation acceptance. The job does not schedule, reserve stock or order materials automatically.

Installer catalogue usability now includes obvious horizontal navigation, a pinned first column and header dropdowns with searchable include and exclude choices for wholesaler, brand and model code. Clicking a wholesaler opens a verified TLink profile with trade contacts, dispatch and warehouse locations, coverage and the approved product catalogue. Verified wholesalers maintain those locations from their existing overview.

The scheduling follow-up removes the empty-owner trap. The signed-in installer owner is materialised once as the active Me resource, while any added person becomes assignable immediately without an account or invitation confirmation. Login access is optional and can be created later through a separate expiring secure link. The Schedule workspace defaults unassigned work to Me, presents one labelled dispatch row, collapses working-hours administration and uses a compact empty-week strip instead of seven tall blank columns.

P6-3G snapshots exact packet tasks, form keys and versions, duration, required capabilities and crew size at quote issue. Accepted jobs use only that immutable execution metadata, while legacy manual quotes retain their lightweight fallback. Trades record normal labour and material results with one action, open detailed actuals only when work differs, see forecast cost and margin variance, follow phase progress and cannot complete until scope, forms, materials and requested proof are clear. Completion prepares invoice and handover work without changing the accepted customer scope or total.

P6-3H removes premature installer purchasing from primary navigation and search while preserving the existing records, APIs and supplier-side fulfilment for later validation. Installer-facing Job packets are now Common jobs, with stored identifiers and immutable quote snapshots unchanged. The separate Invoice tab previews the exact accepted lines, subtotal, GST and total beside one progressive accounting-system action. The seven-day schedule blocks past starts on both trust boundaries, treats normal working hours as advice, preserves hard overlap and recorded-time-off checks and lets an office user drag an appointment to another visible day with immediate response-driven regrouping.

P6-3I gives Invoices its own main destination over the existing accepted-scope and accounting sources, and opens invoice rows directly into the focused live job invoice. Job rows and timetable blocks support deliberate double-click and keyboard opening while keeping visible touch actions. Appointments now use one start plus a server-bounded 15-minute to eight-hour duration. Schedule is a time and team grid with stable person colours, drag-to-day movement and response-driven updates. Optional Google Calendar and Outlook connections mirror the authoritative TLink week through revision-mapped events; external failure never rolls back a local save, and protected appointments never disclose customer identity, contact or exact address.

P6-3J replaces the two-step customer matcher with one accessible search and creates a direct customer, primary contact, structured service site and linked job in one D1 batch when no match exists. Duplicate checks reuse email, phone, business-number and exact service-address evidence. Existing customer sites remain authoritative. The initial form keeps only customer, site, editable title presets, work type, building type and priority; dates and value remain owned by Schedule and commercial records. Address suggestions are authenticated and provider neutral, with truthful manual fallback until an approved endpoint and credential are configured.

The same batch moves next action, description and tags into one Notes owner; replaces custom New and More disclosures with one listener-safe accessible menu; and adds an audited, ordered and idempotent Start travel, Arrive, Start work and Finish flow to web and native field surfaces. Direct-customer Call and directions use the selected service-site contact boundary, while protected and internal work remains redacted. Finish reuses tasks, forms, requested proof, issues, accepted work-plan requirements and sync receipts as blockers, then exposes the existing invoice and handover paths. Migration `0073_phone_first_field_job.sql` adds building type and appointment transition timestamps and actor evidence.

## Next milestone contract

### P6-3K: audited correction of an active field state

Outcome: an owner or dispatch coordinator can correct one accidental active field transition without database intervention, hiding the recovery control from the technician's normal one-action flow and preserving the original audit evidence.

### In scope

- One office-only correction action for `en_route`, `arrived` or `in_progress` appointments.
- A required plain-language reason, expected appointment revision, authorised actor and immutable work-order event.
- Clearing only the timestamp made invalid by the one-step correction while retaining prior transition evidence in the event history.
- Immediate job-sync publication so assigned field devices receive the corrected authoritative state.

### Explicitly out of scope

- Reopening a successfully finished job, reversing invoice or handover preparation, or editing historical transition timestamps.
- General appointment history editing, GPS tracking, route optimisation or a replacement state model.
- Technician self-approval of corrections.

### Acceptance criteria

- Only an owner, manager or coordinator can correct the immediately previous active transition.
- A stale revision, invalid target or repeated correction is rejected without changing the appointment or job.
- The correction reason and actor are visible in the existing job history, and field sync receives the corrected revision.
- The phone-first technician surface still presents one primary forward action and no competing recovery button.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- Correction would require mutating or deleting historical event evidence.
- Reopening a completed job would invalidate an invoice, handover or customer-facing record.
- The slice expands beyond one-step active-state recovery or creates a second appointment state source.
