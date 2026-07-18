# Next task handover

Status: active rolling handover
Prepared: 18 July 2026
Implementation baseline: the current `codex/sites-custom-domain-migration` worktree implements P6-3E accepted quote, deposit and accounting handoff on top of the published P6-3D secure quote-link release. Exact release identity is recorded in `RELEASE_TRUTH.md` after publication.

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

## Next milestone contract

### P6-3F batch: accepted scope to ready-to-run job

Outcome: one deliberate office action converts the immutable accepted scope into an executable job plan without re-entering tasks, materials, forms, crew needs or budget.

### Five linked foundation items

1. Convert the accepted scope once into immutable job phases and customer-visible work descriptions.
2. Reuse originating job-packet tasks, forms, durations, capabilities and crew suggestions when present, with a clear lightweight fallback when the quote was built manually.
3. Materialise material and labour requirements from accepted quote lines without reserving stock or creating supplier orders automatically.
4. Establish the accepted sell, cost and margin budget baseline, then show actual time and material costs against it without changing the accepted customer total.
5. Present one readiness checklist and one `Ready to schedule` action covering scope, forms, people, materials and deposit state.

### In scope

- Existing immutable commercial handoff, accepted quote lines, packet revision references, price-book cost snapshots, tasks, forms, capabilities, team and deposit status.
- One conversion receipt per accepted handoff so retries return the existing plan rather than duplicating phases or requirements.
- Progressive disclosure: default phase and readiness choices first, with detailed work breakdown and budget available when needed.
- Owner-scoped job records and the existing protected-customer boundaries.

### Explicitly out of scope

- Automatic scheduling, dispatch assignment, purchase-order submission, stock reservation, supplier bills or field completion.
- Variations, progress claims, payroll, subcontractor onboarding or customer asset creation.
- Recalculating the accepted sell total, mutating the accepted scope or deriving provider-specific commercial truth.
- Requiring a deposit when the business deliberately chooses to proceed without one.

### Acceptance criteria

- Repeating conversion returns the same phases, requirements and readiness record without duplication.
- Packet-backed quotes reuse the exact packet revision; manually built quotes receive a useful simple plan without technical setup.
- Accepted materials and labour flow into requirements and budget once, while the accepted customer total remains immutable.
- The office can see exactly what blocks `Ready to schedule` and resolve each blocker from that view.
- The primary office flow works at 390 px without document-level horizontal overflow and keeps advanced breakdowns collapsed initially.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- Conversion requires mutating the accepted quote or replacing its stable commercial reference.
- Packet revision data is insufficient to reconstruct quoted tasks or forms accurately.
- The slice expands into automatic supplier ordering, stock allocation, scheduling, dispatch or field execution.
