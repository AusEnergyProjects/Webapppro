# TLink and AEA release truth

Last verified: 16 July 2026

This is the canonical implementation-status document. README, roadmap, runbooks and historical architecture notes must link here instead of defining competing release states.

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
- Privacy-safe opportunity matching with household identity and direct contact withheld from trade accounts.
- Installer CRM, catalogue, purchasing, integrations, payments, teams, assets, handover and native field-sync foundations.
- Keyset pagination, server-side search, D1 FTS5 indexes, query telemetry and high-volume list tables.
- Synthetic scale fixtures separated from production migrations.
- Uppercase canonical Australian state codes for new writes, filters and normalisation.
- Server-configured membership checkout, billing portal and webhook payment-link mapping.

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

- Stripe production activation is not proven by source code. Before public paid membership launch, an owner must verify account activation, product prices, payment links, webhook destinations and secrets in Stripe.
- Apple and Google developer accounts, signing credentials, mobile Firebase files, OAuth client IDs and APNs or FCM release credentials are required for store distribution.
- Historical shared D1 databases may already contain explicit synthetic demo records from migrations 0033 to 0038. They remain marked as synthetic and filterable. Fresh databases no longer receive them automatically.

## Release policy

- Preserve the compatibility electricity comparator until the native stability and parity gate passes.
- Publish validated commits to GitHub and Sites only.
- Never publish generated account credentials, benchmark outputs, secrets or customer data.
- Do not rewrite migration history already applied to a shared database. Compatibility identifiers can remain no-op while new corrective migrations move state forward.
