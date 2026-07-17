# TLink and AEA release truth

Last verified: 17 July 2026

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
- P6-2G implementation is pending exact-source validation and publication. Provider activation remains separately gated on Resend and Twilio account credentials, verified senders and callback secrets.
- Live verification after P6-2C observed HTTPS, HSTS, `Permissions-Policy`, `Referrer-Policy`, `X-Content-Type-Options` and `X-Frame-Options` on the canonical custom domain. No CSP header was observed.
- Apple and Google developer accounts, signing credentials, mobile Firebase files, OAuth client IDs and APNs or FCM release credentials are required for store distribution.
- Historical shared D1 databases may already contain explicit synthetic demo records from migrations 0033 to 0038. They remain marked as synthetic and filterable. Fresh databases no longer receive them automatically.

## Release policy

- Preserve the compatibility electricity comparator until the native stability and parity gate passes.
- Publish validated commits to GitHub and Sites only.
- Never publish generated account credentials, benchmark outputs, secrets or customer data.
- Do not rewrite migration history already applied to a shared database. Compatibility identifiers can remain no-op while new corrective migrations move state forward.
