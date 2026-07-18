# TLink and AEA release truth

Last verified: 18 July 2026

This is the canonical implementation-status document. README, roadmap, runbooks and historical architecture notes must link here instead of defining competing release states.

Future AI-assisted changes follow [AI delivery guardrails](./AI_DELIVERY_GUARDRAILS.md). The executable next milestone is maintained in the single rolling [handover](./HANDOVER_NEXT_TASK.md).

## Product identity

1. Australian Energy Assessments household platform: electricity and gas comparison, NEM12 processing, home energy plans, scenarios, guides, rebates, assessments and always-free consumer accounts.
2. TLink marketplace: protected household opportunities, installer and wholesaler accounts, verification, catalogue, product selection, purchasing and referrals.
3. TLink trade operating platform: CRM, customers, system-numbered jobs, scheduling, forms, assets, warranties, handover, accounting, payment pathways, teams and device management.
4. TLink field application: assigned work, encrypted offline data, conflict-safe synchronisation, forms, time, evidence and remote revocation for iOS and Android.

## Active runtime and data services

- Web and API runtime: OpenAI Sites using the Vinext Cloudflare worker output.
- Database: Cloudflare D1 binding `DB`.
- Private evidence storage: R2 binding `EVIDENCE`.
- Source and release record: GitHub.
- Low-cost email and monitoring path: Google Apps Script and Google Workspace.
- Not active: Netlify and Vercel deployment targets.

## Confirmed implementation

- Native electricity and gas comparison routes plus compatibility rollback for electricity.
- Consumer, installer, wholesaler and restricted admin authentication journeys.
- Certificate price education with seven certificate definitions, a scheduled six-month reported-trade history and a privacy-safe public read endpoint.
- Privacy-safe opportunity matching with household identity and direct contact withheld from trade accounts.
- Installer CRM, catalogue, purchasing, integrations, payments, teams, assets, handover and native field-sync foundations.
- Keyset pagination, server-side search, D1 FTS5 indexes, query telemetry and high-volume list tables.
- Synthetic scale fixtures separated from production migrations.
- Uppercase canonical Australian state codes for new writes, filters and normalisation.
- Server-configured membership checkout, billing portal and webhook payment-link mapping.
- Phase 6 free trade access: verified installers and wholesalers receive role-appropriate CRM, leads, marketplace, scheduling, team, field, forms, purchasing, catalogue and handover tools without a subscription, seat or per-lead entitlement.
- Marketplace opportunities expose direct quote, CRM job and dated site-visit actions while retaining the protected opportunity match as the owner-scoped source reference.
- Historical Stripe subscriptions remain manageable through the billing portal, but the public and dashboard journeys no longer offer a new paid plan or paid referral reward for core trade access.
- Additive migration `0047_customer_service_site_foundation.sql` creates owner-scoped customer contacts, service sites and site-contact assignments, backfills one primary contact and site for each existing direct CRM customer and links only direct jobs to the migrated site.
- Additive migration `0048_unified_enquiry_inbox.sql` creates the owner-scoped direct and protected-reference enquiry inbox, conversation and audit history, explicit duplicate conversion and generic CSV or Excel imports.
- Additive migration `0049_customer_asset_timeline.sql` extends the existing installed-asset register with customer, service-site, provenance, review and lifecycle links. Existing handover assets require installer confirmation before joining the direct-customer timeline.
- Additive migration `0050_versioned_trade_quotes.sql` adds direct-job quote headers, immutable versions, integer-cent line calculations and verified-customer decision evidence without changing the protected marketplace quote flow.
- Additive migration `0051_team_scheduling_capacity.sql` adds team working hours, unavailable periods, appointment member assignments and appointment revisions while preserving existing job, appointment, team and service-site sources of truth.
- Additive migration `0052_service_follow_up_preparation.sql` adds one owner-scoped service follow-up per service plan and due date plus immutable preparation audit events. Existing assets, service plans, customer preferences, consent receipts, customer records, service sites and team members remain authoritative.
- Additive migration `0053_service_reminder_delivery.sql` adds provider channel settings, idempotent delivery records, authenticated provider events, verified mobile contacts and customer channel opt-outs. Email and SMS channels remain disabled until their protected Sites credentials and authenticated callbacks are configured.
- Additive migration `0054_service_follow_up_reporting.sql` adds the date-first indexes required for bounded aggregate follow-up workload and delivery reporting without duplicating service, delivery or staff sources of truth.
- Additive migration `0055_appointment_rescheduling.sql` adds verified-customer appointment change requests, owner-scoped review tasks, immutable decision events and reconstructable appointment revisions. Customer submission never changes the schedule; authorised dispatch acceptance reruns existing conflict checks before the atomic update.
- Additive migration `0056_customer_contact_release.sql` adds optional private phone and service-address defaults, one customer-authorised contact snapshot per exact opportunity match and immutable grant, withdrawal and project-closure events. Marketplace scopes remain anonymised until a verified customer separately releases the named fields to one shortlisted verified installer.
- Additive migration `0057_customer_property_arrivals.sql` adds structured project property context, R2-backed evidence metadata, immutable evidence access events, revisioned installer arrival-window proposals and immutable proposal and customer-selection events. Customer-approved uploads are available to every active verified installer allocated to the exact enquiry. Job conversion and arrival proposals remain gated to the accepted connected installer.
- Additive migration `0058_trade_contact_arrival_handoff.sql` adds mandatory trade ABN storage, customer-selected direct installer contact snapshots, CRM job and appointment linkage and preparation acknowledgement state. Direct contact exposes only installer business name, contact number, email and ABN and creates an admin-visible audit notification.
- Additive migration `0059_appointment_notifications.sql` adds revision-bound appointment events, audience and channel delivery records and authenticated provider event history. Appointment creation, first staff assignment, authorised schedule changes and customer preparation confirmation reuse existing customer account updates, trade operational email, channel opt-out, daily limit and provider callback controls. The `TLink` SMS sender approval flag remains false by default, so appointment SMS cannot send before approval.
- Additive migration `0060_customer_photo_requests.sql` adds one revisioned photo request per direct-customer job, hashed expiring capability links, immutable request events and request context on existing private job media. Authorised installer office users can edit job-specific requirements and issue or revoke links. Customers complete a privacy self-review before signature-checked, metadata-stripped photos enter the exact job proof.
- Additive migration `0061_photo_request_templates.sql` adds owner-scoped photo-guidance templates, immutable published versions and source-version metadata on each independent job request. Archived templates cannot seed new requests. Usage and controlled trade-feedback counts use request metadata only and never inspect customer images.
- Additive migration `0062_photo_request_delivery.sql` adds encrypted current-link recovery, revision and token-issue idempotent email or SMS delivery, two bounded resends, a final-seven-day expiry reminder, authenticated receipt updates and privacy-safe administrator health. SMS remains suppressed until the Australian sender is approved.
- Additive migration `0063_photo_request_review.sql` adds immutable customer completion evidence, append-only per-requirement installer review, fixed retake reasons and review-bound targeted follow-up identity. Reviewed originals remain available to authorised job users, while field and template reporting receive only readiness and aggregate outcomes.
- Additive migration `0064_trade_price_book.sql` adds owner-scoped reusable trade items, integer-cent cost and sell values, deterministic basis-point markup and margin, immutable price-change history and quote-line snapshots. Owners, managers and coordinators can maintain the library; active items can populate direct-job quote drafts without changing issued quote revisions or duplicating the existing business-capability and approved-supplier-catalogue sources.
- Additive migration `0065_trade_job_packets.sql` adds owner-scoped reusable packet composition from current price-book items plus references to existing job-template tasks and published forms. Deterministic estimates and suggested-crew readiness reuse authoritative capability and active-team sources. Direct-job quote lines snapshot the packet, revision and item while issued quote revisions remain immutable.
- Feature-owned admin account, opportunity, catalogue, inbox and product-enquiry workspaces, with shared saved-list request helpers.
- Admin performance SLO dashboard with 7-day p95 latency, average database time, error-rate and sample-size assessment plus read-only keyset query-plan checks.
- Stripe production preflight on 17 July 2026: no active account tasks; four active Direct Trade membership payment links at the configured monthly and annual prices; one active membership webhook destination subscribing to five events with a 0% error rate.

## Validation contract

`npm run validate` is the release gate. It must pass on the exact commit being published and includes:

- TypeScript checking for the active web application and worker.
- ESLint.
- Runtime integration tests.
- Full automated tests.
- Fresh Cloudflare D1 migration application including FTS5.
- Production build.

`npm run test:coverage` provides the coverage report. Source-pattern tests remain structural guardrails, not proof of runtime behaviour. New access-control, data-flow and calculation work should add executable tests at the domain or route boundary.

## External or unverified state

- Stripe production account status, historical membership payment links and webhook destination were inspected on 17 July 2026. Phase 6 supersedes new subscription-led core access. Existing subscribers retain a billing-portal path while product and commercial owners determine the retirement, cancellation or credit process. Webhook signing secrets remain deployment secrets.
- The public Sites baseline before P6-2A was version 122, sourced from `d3b69fb` on `codex/sites-custom-domain-migration`. The P6-2A release branch continues from that exact baseline; future releases must continue from the newest live Sites version and rerun the release audit.
- P6-2A was published as Sites version 123 from commit `e5ddc9471b059342840d2e7c86cb0a91758814ca` on `codex/sites-custom-domain-migration`.
- P6-2B was published as Sites version 124 from commit `5863f0419c420811bfa145ed9c4523f212888dde` on `codex/sites-custom-domain-migration`.
- P6-2C was published as Sites version 126 from commit `d711fda4590dfa67c1e09dbb413d18b5fde07f92` on `codex/sites-custom-domain-migration`.
- P6-2D was published as Sites version 127 from commit `5fb6511845e059d843e29cf179b1134141b52842` on `codex/sites-custom-domain-migration`. The canonical domain and `/api/health` both returned HTTP 200 after publication.
- P6-2E was published as Sites version 129 from commit `83007b3001b3ac61e0af5b1fdd1fdd346208708a` on `codex/sites-custom-domain-migration`. It adds team scheduling, capacity and server-side conflict checks and makes the admin account's saved verification status authoritative in both admin and signed-in trade entitlement responses. The Sites origin redirected to the canonical domain, and the canonical domain and `/api/health` both returned HTTP 200 after publication.
- P6-2F was published as Sites version 133 from commit `86418e57f1d0f97f2cfcf9baf07de30720d3d821` on `codex/sites-custom-domain-migration`. It adds consent-aware service follow-up preparation, deterministic reminder drafts, staff assignment, suppression, completion and audit controls. The final release aligns unstored customer lifecycle preferences to explicit opt-in rather than a visually checked default. The Sites origin redirected to the canonical domain, and the canonical domain and `/api/health` both returned HTTP 200 after publication.
- P6-2G was published as Sites version 135 from commit `5bff61906e490d8bcd6f60402fb16cb0011b70c1` on `codex/sites-custom-domain-migration`. It adds consent-safe Resend email and Twilio SMS delivery boundaries, explicit customer channel selection, verified mobile contacts, idempotent delivery history, authenticated provider callbacks, channel opt-outs and administrator delivery health controls. Provider channels remain disabled until protected account credentials, verified senders and callback secrets are configured. Sites environment revision 11 added only the non-secret reply-to address and exact Twilio callback URL. The Sites origin redirected to the canonical domain, and the canonical domain and `/api/health` both returned HTTP 200 after publication.
- P6-2H was published as Sites version 137 from commit `61e0a1b837d0762bce250f9bc41db8c16986a5e4` on `codex/sites-custom-domain-migration`. It adds consent-safe aggregate follow-up workload and delivery reporting plus date-first reporting indexes. The Resend sending domain is verified, and its credentials and authenticated webhook are protected in Sites. The upgraded Twilio account, Messaging Service, delivery callback, Advanced Opt-Out and SMS Verify Service with Fraud Guard are configured in deployed Sites environment revision 14. The `TLink` Australian sender registration remains a draft pending genuine brand-ownership and identity evidence, so SMS remains disabled. The Sites origin redirected to the canonical domain, and the canonical domain and `/api/health` both returned HTTP 200 after publication.
- P6-2I was published as Sites version 140 from commit `17c21503924e3b1fb567cbec04d46a5b6fa5484b` on `codex/sites-custom-domain-migration`. It adds verified-customer appointment change requests, duplicate-active-request prevention, owner-scoped CRM review tasks, immutable decision history and dispatch accept, reject and alternative controls. Customer submission does not change the appointment. Acceptance is request and appointment revision protected, reruns team schedule conflict checks and preserves the prior and accepted schedule revisions. The Sites origin redirected to the canonical domain, and the canonical appointment route and `/api/health` both returned HTTP 200 after publication.
- P6-2J was published as Sites version 142 from commit `c257543427b6a214b57851bfd1132750e7387b50` on `codex/sites-custom-domain-migration`. It keeps marketplace opportunities anonymous through matching and quote review, requires a private customer phone and complete project-matching service address before a trade request, and releases a snapshotted contact record only to the exact verified installer whose quote the customer shortlisted and explicitly consented to contact. Other matches remain redacted, and withdrawal removes future portal visibility while preserving immutable audit history. The Sites origin redirected to the canonical domain, and the canonical account profile, trade dashboard and `/api/health` routes returned HTTP 200 after publication.
- P6-2K was published as Sites version 144 from commit `14e03278926d979d2f84862be1edb0b4c1e473a3` on `codex/sites-custom-domain-migration`. It adds required structured property context, consented phone or tablet photo capture, signature-checked R2 evidence storage and revisioned installer-owned arrival proposals. Quoting photos are shared with every active verified installer allocated to the exact enquiry, while supporting documents remain restricted to the accepted connected installer. Only that installer can propose arrival windows or convert the platform lead to a CRM job, and customer selection does not create an appointment. The Sites origin redirected to the canonical domain, and the canonical new-project, trade-dashboard, marketplace-standards and `/api/health` routes returned HTTP 200 after publication.
- P6-2K photo privacy hardening was published as Sites version 146 from commit `25eba2c226e48870c1252914a0c27946f5121151`. It converts quote-guidance images to bounded JPEGs in supported browsers and independently strips JPEG, PNG or WebP metadata on the server before private R2 storage. The Sites origin redirected to the canonical domain, and the canonical new-project, trade-dashboard, marketplace-standards and `/api/health` routes returned HTTP 200 after publication.
- P6-2L was published as Sites version 148 from commit `d4036832d0e47ae455d29103f963a78fb3571d5c` on `codex/sites-custom-domain-migration`. It shares every customer-approved project upload, including PDFs, with each active verified installer allocated to the exact enquiry; adds the customer direct-contact choice with only installer business name, contact number, email and ABN plus an admin-visible audit notification; requires those four business fields for new or updated trade profiles; and materialises a selected arrival window as an unassigned CRM appointment only when the accepted installer converts the lead. Customer preparation acknowledgement is reset after dispatch assignment or an accepted reschedule. The Sites origin returned HTTP 308 to the canonical domain, and the canonical homepage, new-project, trade-dashboard, trade-signup, marketplace-standards, operations control-centre and `/api/health` routes returned HTTP 200 after publication.
- P6-2Q was published as Sites version 159 from commit `c90417d4f23943cbca4881bc63ccd71bc57933c9` on `codex/sites-custom-domain-migration`. The Jobs index cancellation correction in `aa771460b190c7e744caca216bb4c8dde3087c77` was published with the same implementation baseline as Sites version 160. Superseded Jobs and Customers index requests are aborted before they can replace the current filtered results. The canonical signed-in Jobs list showed its expected job and detail workspace after publication, and the canonical domain and `/api/health` returned HTTP 200.
- P6-3A was published as Sites version 161 from release commit `9ed209550357d66d3c2ef996a21fa6b311465958`, with implementation commit `ab7331b0ae1d6b0ce4a2981278a74a09c95ac708`, on `codex/sites-custom-domain-migration`. It adds the authoritative trade price book, guided quick starts and direct-job quote reuse while keeping issued quote versions immutable. Production environment revision 14 was retained.
- Live verification after P6-2C observed HTTPS, HSTS, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options` and `X-Frame-Options` on the canonical custom domain. No CSP header was observed.
- Apple and Google developer accounts, signing credentials, mobile Firebase files, OAuth client IDs and APNs or FCM release credentials are required for store distribution.
- Historical shared D1 databases may already contain explicit synthetic demo records from migrations 0033 to 0038. They remain marked as synthetic and filterable. Fresh databases no longer receive them automatically.

## Release policy

- Preserve the compatibility electricity comparator until the native stability and parity gate passes.
- Publish validated commits to GitHub and Sites only.
- Never publish generated account credentials, benchmark outputs, secrets or customer data.
- Do not rewrite migration history already applied to a shared database. Compatibility identifiers can remain no-op while new corrective migrations move state forward.
