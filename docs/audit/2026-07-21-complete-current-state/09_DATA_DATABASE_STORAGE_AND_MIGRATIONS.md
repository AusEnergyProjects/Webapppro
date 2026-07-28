# 09 — Data, database, storage and migrations

Audit date: 2026-07-21 (Australia/Sydney)<br>
Audit repository HEAD: `ff3c8efe3d5e501286d8e83e28086d6d4590be27` (documentation-only child)<br>
Application and production source: OpenAI Sites version 199, `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`

## Executive finding

The application uses one Sites-managed Cloudflare D1 database as the authoritative source for CRM and operational state, one Sites-managed R2 bucket for binary evidence/documents, and an encrypted local SQLite cache in the Expo field app. Auxiliary state also exists in browser local storage, Firebase React Native authentication persistence, encrypted mobile files, Google Sheets, Apps Script Script Properties and downstream providers. The tracked server relational model is large: **145 regular application tables**, **five FTS5 virtual tables**, **16 SQL triggers**, and **79 ordered SQL migrations**. A clean local migration replay passed at the tracked commit.

The model’s most important structural weakness is the complete absence of declared foreign keys. All cross-table integrity and tenancy is application-enforced through text IDs and owner/customer Firebase UIDs. The most important operational weakness is that owner-controlled production query, export, point-in-time recovery, R2 inventory and restore were not demonstrated. Those two weaknesses prevent a production-ready CRM assessment even though the schema and migration breadth are substantial.

Audit chronology matters. Snapshot A began at `543cc189` while the protected console was uncommitted; Snapshot B had clean/pushed `4a5cd19` but live v198; Snapshot C deployed that exact application source as Sites v199. Snapshot D moved repository HEAD to docs-only child `ff3c8ef` and did not change the application deployment. Release QA at Snapshot C verified bounded owner-only browsing across the 145 ordinary tables and credential-cell redaction, without changing a production row (`docs/RELEASE_TRUTH.md:124`). That is useful operational access evidence, but it is not an independent export, backup, PITR or restore capability.

## Authoritative and auxiliary data stores

| Store | Intended authority | Binding/access | Data classes | Current evidence |
|---|---|---|---|---|
| Cloudflare D1 / SQLite | Primary CRM, account, job, quote, invoice, payment/accounting ledger, consent, audit and provider-sync state | Worker binding `DB`; `db/index.ts:1-9` | Identity references, contact details, addresses, job/commercial data, provider tokens/metadata, consent/audit | Binding and source use verified; production rows, instance owner, plan and recovery unknown |
| Cloudflare R2 | Binary evidence and documents | Worker binding `EVIDENCE` | Verification PDFs/images, project evidence, handover documents, field/job photos and mobile multipart uploads | Source paths and authorization verified; production object inventory/policy/export unknown |
| Worker default Cache API / edge HTML cache | Non-authoritative rendered HTML response cache/CDN | `globalThis.caches.default` for every successful non-API GET accepting HTML; `worker/index.ts:6,37-71` | Request-URL keyed HTML responses, public for 120 seconds with stale-while-revalidate 600 seconds | `VERIFIED DEPLOYED` code path; no explicit auth/cookie/private-route exclusion or purge/version namespace is present. Current account pages appear client-data driven, but cross-user cache safety was not runtime-tested |
| Electricity/gas module caches | Non-authoritative per-isolate upstream-plan/result caches | Module-scoped `planCache` Maps with one-hour TTL at `src/app/api/electricity-plans/route.js:10-31` and `src/app/api/gas-plans/route.ts:9-18,47-57,203` | Electricity key: postcode/customer type; gas key: postcode, annual MJ, conditional choice and usage profile; values are upstream/result payloads | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; per-isolate, no explicit size bound/eviction sweep, and entries expire only when looked up/replaced or isolate ends |
| Development lead-rate fallback | Development-only, non-authoritative abuse counter; not used by the configured production path | Module-scoped `Map` returned by `createInMemoryLeadRateStore()` at `src/lib/lead-rate-limit.mjs:33-49`; production constructs the D1 store | HMAC-obscured client key mapped to count and reset timestamp | `NOT APPLICABLE` to the production configuration; implemented development fallback has process/isolate lifetime only, no persistence or cross-process coordination |
| Public HTTP/CDN cache headers | Non-authoritative response caching | Electricity/gas success responses and certificate-price response (`src/app/api/electricity-plans/route.js:13-17`; `src/app/api/gas-plans/route.ts:37-45`; `src/app/api/certificate-prices/route.ts:10`) | Public plan/certificate payloads; gas result varies by annual use/profile in URL | `PARTIAL`: cache headers exist, but actual cache key/vary/purge behavior and sensitive-query logging/retention were not verified |
| Expo SQLite | Temporary field-device cache and offline queues; server D1 remains authoritative | Device-local `aea-field.db`; key in Expo Secure Store; `mobile/src/lib/database.ts:9-30` | Assigned job snapshots, action/upload queues and settings | Four tables/three indexes are fully inventoried below; physical-device encryption, purge and recovery not independently tested |
| Expo encrypted files | Temporary upload staging | Device file system plus app encryption helper/key | Photos/documents awaiting multipart upload | Implemented; physical-device file protection, OS backup behavior and interrupted purge unverified |
| Synthetic generator filesystem outputs | Test-only identity checkpoint, password export and generated fixture; never business authority | Default ignored `synthetic-test-output` directory plus configurable `--out`/`--sql`; `scripts/seed-synthetic-population.mjs:8-14,140-144,300-321` | Plaintext synthetic emails/passwords/Firebase UIDs, checkpoint state and generated SQL | Safety control `BROKEN`: no-argument execution writes under the repository and overwrites a tracked fixture while attempting external Firebase identity mutations; arbitrary writable output paths are accepted, cleanup only removes the checkpoint after success, and prior execution is `UNKNOWN` |
| Browser `localStorage` | Non-authoritative UI preferences, public-plan cache and browser-local throttle timestamps | Admin keys at `src/components/AdminNotificationInbox.tsx:170-186,262-272`; legacy comparator cache/throttle at `public/electricity-comparator.html:725-754,1548-1608,2365-2434` | Browser-alert enabled flag, inbox queue filter, postcode/customer-type keyed plan bundle with TTL, and comparison/lead timestamp arrays | Implemented; browser/profile persistence and clearing are not centrally governed. The observed legacy cache does not store NMI, interval usage, lead name or email, but its key includes postcode |
| Firebase Auth React Native persistence | Mobile identity/session persistence, not CRM authority | `getReactNativePersistence(AsyncStorage)` at `mobile/src/lib/auth.ts:1-26` | Firebase authentication persistence material controlled by the SDK | Implemented; on-device storage encryption, logout/revocation purge and physical-device exposure were not inspected |
| Firebase Authentication | Identity authority, not CRM record authority | Client SDK; server verifies ID token through Google JWKs | UID, email, verified flag and token claims | Implementation verified; project ownership/IAM/revocation unknown |
| Google Sheet / Apps Script | Lead/reminder relay record | Container-bound sheet with 19-column `HEADERS` contract at `integrations/google-apps-script/lead-email-relay.gs:22-27`; read/write paths at lines 393-430 and other handlers | Contact/lead inputs, comparison/reminder state, event details and unsubscribe token | Source exists; live sheet rows, access policy, retention, backup, deployment and owner not inspected |
| Apps Script Script Properties | Secret/configuration plus monitor and notification-deduplication state | `PropertiesService.getScriptProperties()` at `integrations/google-apps-script/lead-email-relay.gs:56-81,185-195,203-216` | Probe signing secret, latest health state and hashed notification-dedupe timestamps | Implemented source; live values, administrator access, rotation, retention/export and recovery unknown; no value was read |
| External accounting/calendar/payment providers | Downstream systems/mirrors | OAuth/provider APIs | External invoice/event/payment IDs and statuses | Adapter source exists; live state/config unknown |

`.openai/hosting.json:1-5` declares only logical D1/R2 binding names; it does not identify the underlying provider account, production database UUID or bucket owner. The local UUID in `vite.config.ts:24` is a dummy development value.

### Complete data-access-layer inventory

| Access layer | Source boundary | Stores/services reached | Authority and status |
|---|---|---|---|
| D1 binding accessor | `db/index.ts:1-9` | Worker `DB` binding | Supplies the database handle only; it is not a repository/ORM layer |
| Web/API route handlers | All 94 route modules / 197 HTTP operations catalogued in report 08 | Direct prepared D1 statements/batches; selected R2/provider calls and two plan Maps | Primary server trust boundary; operation-specific validation/auth is in report 08 |
| Server domain helpers | Server helpers under `src/lib/`, including `src/lib/appointment-notification-server.ts` and integration/domain services | D1, R2 and external providers through explicit inputs or `getD1()` | Reused business/side-effect logic, but no single repository abstraction owns every query |
| Owner Database Console | `src/lib/admin-database-console.ts`; `src/app/api/admin/database/route.ts` | Generic bounded D1 metadata/table reads and three allowlisted insert/delete surfaces | `VERIFIED DEPLOYED`; security decision is withdrawal, not expansion (report 13) |
| R2 route layer | Verification, customer-project, handover, field/photo and mobile-media routes listed in the R2 object-model section below | `EVIDENCE` binding plus D1 metadata | Server-authorized object boundary; no separate object repository or complete reconciler |
| Web clients | 55 direct-fetch components and route/page shells catalogued in report 07 | Same-origin APIs; browser `localStorage` for the bounded cases above | Client cache/UI layer only; never database authority |
| Mobile transport and local repositories | `mobile/src/lib/api.ts`, `database.ts`, `encrypted-files.ts`, `sync.ts`, `uploads.ts` | Same-origin sync/media APIs, SQLite, encrypted files, Secure Store, AsyncStorage | Offline/cache/queue boundary; D1/R2 remains authoritative after accepted sync/upload |
| Google Apps Script repository | `integrations/google-apps-script/lead-email-relay.gs` | Bound Google Sheet, Script Properties, Gmail and `UrlFetch` | Separate managed data/automation plane; source exists, deployed version/owner/live data unknown |
| Provider adapters | Provider-neutral integration/payment/accounting/calendar/notification modules catalogued in report 11 | Provider HTTPS/OAuth/webhook APIs plus D1 ledgers | TLink records authoritative intent/snapshots; providers own downstream delivery/payment/accounting records |
| Migration/replay tooling | Ordered `drizzle/*.sql`, `scripts/check-migrations.mjs`, `drizzle.config.ts` | Fresh local Wrangler D1 | Schema change authority is ordered SQL; production applied ledger/rollback remains unknown |

### End-to-end data-lineage disposition

| Source | Validation/transformation | Store/cache/provider path | Export/deletion/authority disposition |
|---|---|---|---|
| Household comparison inputs and optional NEM12 | Browser parsing/normalization and server plan-query validation | Interval/NMI stays browser memory; public plan bundle may enter legacy `localStorage`; plan APIs use per-isolate Maps and public cache headers while calling energy sources | No NEM12 upload path found; caches are non-authoritative. Gas cache key/query includes annual use/profile; exact edge/request-log retention is unknown |
| Account/project/marketplace input | Firebase identity plus route/domain validation and consent/release rules | D1 project/customer/opportunity records; authorized evidence to R2; bounded provider notifications | D1/R2 authoritative; customer correction exists, complete subject export/deletion does not |
| Trade CRM/quote/invoice/job input | Owner/role/object checks, typed normalizers, integer-cent and revision/idempotency rules | D1 authoritative records; selected files to R2; provider snapshots/IDs downstream | Visible-page CSV and provider exports are partial, not complete owner export; archive/correction/deletion matrix below |
| Provider callback/webhook | Signature/state/replay validation in provider routes | D1 attempt/event/reconciliation ledgers; provider remains external financial/delivery record | Provider export/dispute retention and complete recovery are `UNKNOWN`; report 11 owns each contract |
| Mobile assigned work and offline action/media | Firebase/device/version checks; local encrypted staging; revision/receipt validation at sync/media APIs | SQLite/files/AsyncStorage -> HTTPS -> D1/R2; rejected/conflict work stays local for review | Local data is rebuildable/cache-only by design; purge/revocation physical-device proof is `UNKNOWN` |
| Admin notification preference/state | UI values only | Two browser `localStorage` keys; no notification bodies in observed calls | Non-authoritative; user/browser clearing only |
| Lead/reminder/operations relay | Envelope validation, HMAC/dedupe, Sheet header normalization and Apps Script locks where present | D1/source event -> Apps Script -> Sheet/Script Properties/Gmail | Separate records require owner/IAM/retention/export/deletion decision; live authority/reconciliation unknown |
| Schema/migration change | Ordered SQL plus fresh replay check | Repository SQL -> local/prod D1 schema and backfills | Forward-from-empty replay passed; historical upgrade, production ledger, down/restore rollback unknown |

## Relational model inventory

`db/schema.ts` declares 145 `sqliteTable(...)` exports from lines 4-2852. The following is the complete physical table inventory, grouped by operational domain. These groupings are an audit aid; they are not independent databases or security boundaries.

### Accounts, administration and identity (19)

`trade_accounts`, `trade_supplier_locations`, `stripe_memberships`, `stripe_webhook_events`, `lead_rate_limits`, `trade_referral_codes`, `trade_referrals`, `trade_membership_credits`, `verification_documents`, `admin_users`, `admin_audit_log`, `admin_notifications`, `admin_notification_deliveries`, `admin_usability_pilots`, `admin_usability_pilot_participants`, `admin_usability_pilot_sessions`, `trade_account_notes`, `customer_account_notes`, `trade_account_feature_grants`.

Evidence: `db/schema.ts:4-351`.

### Work orders, team, mobile, handover and field execution (19)

`trade_work_orders`, `trade_team_members`, `trade_team_invites`, `trade_team_sync_changes`, `trade_offline_actions`, `trade_mobile_devices`, `trade_mobile_push_outbox`, `trade_mobile_upload_sessions`, `trade_mobile_upload_parts`, `trade_crm_counters`, `trade_work_order_tasks`, `trade_work_order_events`, `trade_handover_packs`, `trade_installed_assets`, `trade_job_notification_reads`, `trade_team_working_hours`, `trade_team_unavailability`, `trade_compliance_items`, `trade_handover_documents`.

Evidence: `db/schema.ts:352-711`.

### Asset lifecycle, reminders, safety and ownership (21)

`trade_asset_service_plans`, `trade_service_job_generations`, `trade_asset_service_events`, `trade_service_follow_ups`, `trade_service_follow_up_events`, `service_reminder_channel_settings`, `service_reminder_deliveries`, `service_reminder_delivery_events`, `appointment_notification_events`, `appointment_notification_deliveries`, `appointment_notification_delivery_events`, `customer_service_reminder_contacts`, `customer_service_reminder_opt_outs`, `customer_asset_lifecycle_preferences`, `asset_safety_notices`, `asset_safety_acknowledgements`, `customer_asset_ownerships`, `customer_asset_transfer_requests`, `customer_asset_transfer_events`, `trade_handover_corrections`, `trade_opportunities`.

Evidence: `db/schema.ts:712-1117`. `trade_opportunities` begins the marketplace/opportunity domain but is included here to preserve exact consecutive schema ranges.

### Opportunity matching and CRM customer/enquiry records (11)

`trade_opportunity_matches`, `trade_crm_customers`, `trade_crm_enquiries`, `trade_crm_enquiry_messages`, `trade_crm_enquiry_attachments`, `trade_crm_enquiry_events`, `trade_crm_customer_contacts`, `trade_crm_service_sites`, `trade_crm_site_contacts`, `trade_crm_job_details`, `trade_price_book_items`.

Evidence: `db/schema.ts:1118-1365`. `trade_price_book_items` starts pricing but is included to preserve the consecutive range.

### Pricing, job packets, quotes and commercial job plans (22)

`trade_price_book_price_history`, `trade_job_packets`, `trade_job_packet_items`, `trade_job_packet_forms`, `trade_crm_quotes`, `trade_crm_quote_versions`, `trade_crm_quote_items`, `trade_crm_quote_execution_snapshots`, `trade_crm_quote_choices`, `trade_crm_quote_acceptances`, `trade_crm_commercial_handovers`, `trade_crm_job_plans`, `trade_crm_job_plan_phases`, `trade_crm_job_plan_requirements`, `trade_crm_job_actuals`, `trade_crm_quote_links`, `trade_crm_quote_events`, `trade_crm_quote_questions`, `trade_crm_quote_deliveries`, `trade_crm_appointments`, `trade_crm_appointment_revisions`, `trade_crm_appointment_reschedule_requests`.

Evidence: `db/schema.ts:1366-1769`.

### Scheduling, imports, forms, notes, time and photo evidence (19)

`trade_crm_appointment_reschedule_events`, `trade_crm_job_templates`, `trade_data_import_batches`, `trade_data_import_rows`, `trade_job_forms`, `trade_form_templates`, `trade_crm_job_notes`, `trade_crm_time_entries`, `trade_crm_job_media`, `trade_crm_photo_requests`, `trade_crm_photo_templates`, `trade_crm_photo_template_versions`, `trade_crm_photo_request_events`, `trade_crm_photo_request_completions`, `trade_crm_photo_requirement_reviews`, `trade_crm_photo_request_deliveries`, `trade_crm_photo_request_delivery_events`, `trade_crm_signoffs`, `trade_crm_quick_invoices`.

Evidence: `db/schema.ts:1770-2167`.

### Invoices, integrations, payments and accounting (11)

`trade_crm_quick_invoice_revisions`, `trade_crm_quick_invoice_credits`, `trade_crm_invoice_payment_allocations`, `trade_crm_integrations`, `trade_crm_oauth_states`, `trade_crm_payment_links`, `trade_crm_payment_events`, `trade_crm_accounting_documents`, `trade_crm_accounting_events`, `customer_accounts`, `customer_projects`.

Evidence: `db/schema.ts:2168-2418`. Customer tables begin the next domain but are included to preserve the consecutive range.

### Customer project, catalogue, purchasing and observability (23)

`customer_consent_receipts`, `customer_project_quotes`, `trade_crm_calendar_events`, `customer_project_contact_releases`, `customer_project_contact_release_events`, `customer_project_evidence`, `customer_project_evidence_events`, `customer_project_arrival_proposals`, `customer_project_arrival_events`, `supplier_products`, `supplier_product_links`, `installer_catalogue_preferences`, `workspace_list_views`, `installer_product_lists`, `installer_product_list_items`, `supplier_product_enquiries`, `trade_purchase_orders`, `trade_purchase_order_items`, `trade_purchase_order_events`, `trade_warranty_claims`, `certificate_price_history`, `certificate_price_sync_runs`, `api_performance_samples`.

Evidence: `db/schema.ts:2419-2852`.

The eight groups total 145 regular tables. Physical D1 additionally contains five FTS5 virtual tables described below.

## Relationship, tenancy and integrity model

Tenant ownership is represented through a mixture of `firebase_uid`, `owner_uid`, `customer_uid` and parent record IDs. Many child/event tables do not repeat a tenant key and are reachable only through a parent record. This is a conventional application-scoped design, but it makes every join and mutation helper part of the security boundary.

Static inspection found **no `FOREIGN KEY`/`REFERENCES` relationships in the current Drizzle schema or migration SQL**. No cascading delete/update policy exists at the database layer. The migration count includes one temporary table-rebuild sequence in `0001`, but not an enduring foreign-key contract. Consequences:

- orphan rows can be created by defects, partial migrations or direct administration;
- a deleted parent does not automatically remove children or block deletion;
- restore/import order and reconciliation must be maintained manually;
- a wrong owner/record join can become a cross-tenant disclosure rather than a database constraint failure;
- the database console’s allowlisting and recent-owner controls reduce direct risk but do not supply referential integrity.

Recommendation: add constraints to new/high-value boundaries first and produce integrity queries for existing relationships before attempting retrofits. Candidate first boundaries are owner-to-customer/job, work-order child ledgers, quote/version/item chains, evidence metadata, payment/accounting ledgers and mobile upload sessions. Constraint migrations must be preceded by production orphan reports and a rehearsed repair plan.

## Indexes, search and triggers

Across migration text, static counting found 285 non-unique `CREATE INDEX` statements and 121 `CREATE UNIQUE INDEX` statements. Rebuild migrations can inflate statement counts relative to the final physical index count; use live `sqlite_master` inspection for an exact deployed count when database access is available.

Migration `0044_flimsy_omega_flight.sql` adds five FTS5 virtual tables:

| Virtual table | Source table | Purpose | Maintenance |
|---|---|---|---|
| `tlink_product_search` | `supplier_products` | Name/brand/model/supplier/category search | Insert/update/delete triggers |
| `tlink_account_search` | `trade_accounts` | Business/contact/postcode/state search | Insert/update/delete triggers |
| `tlink_customer_search` | `customer_accounts` | Customer/display/email/location search | Insert/update/delete triggers |
| `tlink_opportunity_search` | `trade_opportunities` | Opportunity/project/location/service search | Insert/update/delete triggers |
| `tlink_crm_customer_search` | `trade_crm_customers` | Owner-scoped CRM customer/contact/address search | Insert/update/delete triggers |

Evidence: `drizzle/0044_flimsy_omega_flight.sql:18-123`. Fifteen FTS maintenance triggers plus `admin_notifications_delivery_enqueue` from `drizzle/0014_lonely_alex_wilder.sql:20` make 16 triggers. No SQL views exist. The historical `trade_crm_property_views` table was created in `0020` and dropped in `0024`.

FTS5 has a material recovery implication: Cloudflare’s documented D1 export does not support databases containing virtual tables. A production logical backup must explicitly omit and recreate FTS5 tables/triggers or use another supported recovery path: <https://developers.cloudflare.com/d1/best-practices/import-export-data/>.

## Complete migration inventory

The repository contains the following 79 ordered SQL files:

```text
0000_complex_absorbing_man.sql
0001_futuristic_frog_thor.sql
0002_closed_korg.sql
0003_fearless_shadow_king.sql
0004_mixed_chat.sql
0005_yielding_gideon.sql
0006_silky_wild_pack.sql
0007_gifted_silhouette.sql
0008_majestic_dormammu.sql
0009_groovy_zaran.sql
0010_wealthy_ultragirl.sql
0011_even_reavers.sql
0012_elite_whizzer.sql
0013_magenta_vivisector.sql
0014_lonely_alex_wilder.sql
0015_aromatic_black_knight.sql
0016_fair_ultragirl.sql
0017_brief_timeslip.sql
0018_military_starhawk.sql
0019_melodic_unus.sql
0020_lying_stick.sql
0021_mushy_gamora.sql
0022_worried_sleepwalker.sql
0023_petite_the_phantom.sql
0024_lethal_purifiers.sql
0025_dizzy_spot.sql
0026_lovely_zodiak.sql
0027_handy_the_anarchist.sql
0028_fearless_white_queen.sql
0029_busy_deathstrike.sql
0030_gifted_white_tiger.sql
0031_steep_random.sql
0032_windy_fixer.sql
0033_synthetic_benchmark_population.sql
0034_pretty_masque.sql
0035_ecosystem_flow_repair.sql
0036_synthetic_journey_readiness.sql
0037_synthetic_catalogue_readiness.sql
0038_complete_trade_purchasing_walkthrough.sql
0039_exotic_mulholland_black.sql
0040_dry_pyro.sql
0041_foamy_shotgun.sql
0042_big_lady_mastermind.sql
0043_serious_layla_miller.sql
0044_flimsy_omega_flight.sql
0045_canonical_australian_states.sql
0046_certificate_price_history.sql
0047_customer_service_site_foundation.sql
0048_unified_enquiry_inbox.sql
0049_customer_asset_timeline.sql
0050_versioned_trade_quotes.sql
0051_team_scheduling_capacity.sql
0052_service_follow_up_preparation.sql
0053_service_reminder_delivery.sql
0054_service_follow_up_reporting.sql
0055_appointment_rescheduling.sql
0056_customer_contact_release.sql
0057_customer_property_arrivals.sql
0058_trade_contact_arrival_handoff.sql
0059_appointment_notifications.sql
0060_customer_photo_requests.sql
0061_photo_request_templates.sql
0062_photo_request_delivery.sql
0063_photo_request_review.sql
0064_trade_price_book.sql
0065_trade_job_packets.sql
0066_optioned_trade_quotes.sql
0067_secure_quote_sharing.sql
0068_accepted_quote_handoff.sql
0069_ready_jobs_supplier_profiles.sql
0070_frictionless_team_roster.sql
0071_job_execution_progress.sql
0072_trade_calendar_sync.sql
0073_phone_first_field_job.sql
0074_global_tlink_job_numbers.sql
0075_guided_quick_invoices.sql
0076_invoice_corrections_credits.sql
0077_trade_job_notification_reads.sql
0078_payment_link_attempts.sql
```

Functional progression:

- `0000-0014`: trade accounts, billing/referrals, verification, administration, customer/admin notes and notification delivery.
- `0015-0031`: work orders, handover, asset lifecycle/ownership, CRM, integrations, team/mobile, forms and purchasing.
- `0032-0045`: canonical states, synthetic benchmark/journey data, ecosystem repairs, list views, performance sampling, FTS and state cleanup.
- `0046-0059`: certificate history, service sites, unified enquiries, asset timeline, quotes, team capacity, follow-ups/reminders, rescheduling, contact/arrival handoff and appointment notifications.
- `0060-0069`: customer photo requests, templates/delivery/review, price book, job packets, optioned/secure quotes, accepted handoff and ready-job/supplier profiles.
- `0070-0078`: team roster, execution, calendar mirror, phone field app, global job numbers, quick invoices, correction/credit ledger, notification reads and payment-link attempts.

## Migration-control findings

`drizzle/meta/_journal.json` contains 68 journal entries ending at `0069`; the repository contains 54 generated snapshots. Eleven SQL migrations are not represented by that journal:

```text
0045_canonical_australian_states.sql
0059_appointment_notifications.sql
0070_frictionless_team_roster.sql
0071_job_execution_progress.sql
0072_trade_calendar_sync.sql
0073_phone_first_field_job.sql
0074_global_tlink_job_numbers.sql
0075_guided_quick_invoices.sql
0076_invoice_corrections_credits.sql
0077_trade_job_notification_reads.sql
0078_payment_link_attempts.sql
```

This does not make the SQL invalid: `scripts/check-migrations.mjs` applies the actual ordered `.sql` files rather than trusting the journal. It does mean Drizzle generation metadata is not a complete authoritative ledger and a future `drizzle-kit generate` can produce confusing diffs or duplicate intent. The authoritative migration rule should be documented and metadata reconciled without rewriting applied production SQL.

At `4a5cd19`, `npm.cmd run db:check` exited successfully after applying all 79 migrations to a fresh local Wrangler D1 database. This proves forward replay from empty against the local runtime. It does **not** prove production migration state, upgrade from every historical deployed state, rollback, data preservation or restoration.

Static migration statement counts are: 147 `CREATE TABLE` statements (including rebuild/temp tables), five `CREATE VIRTUAL TABLE`, 131 `ALTER TABLE`, 285 non-unique and 121 unique index creates, two table drops, nine index drops, 16 triggers, zero views, 25 inserts and 24 updates. These are change-script counts, not final-object counts.

### Data-changing migrations, backfills and rollback safety

An exact migration scan found 18 of 79 SQL files containing migration-time DML, a destructive drop, or DML inside a trigger/FTS definition. They are completely disposed here:

| Class | Exact migrations | Data/change behavior | Rollback disposition |
|---|---|---|---|
| Table rebuild/copy | `0001_futuristic_frog_thor.sql` | Copies `trade_accounts` into a replacement table with new defaults, drops the old table, renames the replacement | Forward replay passed; data preservation on historical production and rollback require a pre-change export/restore and were not tested |
| Direct normalization/backfill | `0005_yielding_gideon.sql`, `0013_magenta_vivisector.sql`, `0045_canonical_australian_states.sql`, `0047_customer_service_site_foundation.sql`, `0048_unified_enquiry_inbox.sql`, `0049_customer_asset_timeline.sql`, `0070_frictionless_team_roster.sql`, `0074_global_tlink_job_numbers.sql` | Updates existing values and/or derives new customer/site/contact/enquiry/timeline/team/job-number records | No down migration exists; rerun/idempotency varies by statement. Historical-row reconciliation and rollback were not executed |
| Default/seed or ledger backfill | `0014_lonely_alex_wilder.sql`, `0034_pretty_masque.sql`, `0053_service_reminder_delivery.sql`, `0069_ready_jobs_supplier_profiles.sql`, `0076_invoice_corrections_credits.sql` | Uses `INSERT`/`INSERT OR IGNORE` to create notification delivery, pilot/default channel, supplier-location or invoice/revision/allocation records | Generally conflict-bounded where `OR IGNORE` is used, but reversal semantics and production row counts are `UNKNOWN` |
| Superseded-object/index removal | `0024_lethal_purifiers.sql`, `0043_serious_layla_miller.sql`, `0078_payment_link_attempts.sql` | Drops one obsolete table and/or superseded indexes before replacement/current constraints | Destructive DDL is not rolled back by repository tooling; restore/forward-fix is required |
| FTS population and trigger DML definitions | `0044_flimsy_omega_flight.sql` | Creates/rebuilds five FTS tables and defines insert/update/delete maintenance triggers | FTS is derived and can be rebuilt in principle, but a production rebuild/reconciliation and rollback were not exercised |

There are no tracked down migrations or automatic rollback command. `db:check` validates zero-to-current forward replay only. Before any production migration, acceptance requires exact pre/post row/integrity counts, a tested owner-controlled backup/restore, transaction/statement failure behavior, forward-fix plan and a stop condition; destructive restore or rollback was not authorized or run by this audit.

## Exhaustive declared schema-object register

This point-in-time register applies to repository audit HEAD `ff3c8efe3d5e501286d8e83e28086d6d4590be27`, whose application code is the deployed Sites v199 source `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`. The current declaration source is `db/schema.ts`; SQL-only FTS objects and triggers are in the ordered `drizzle/*.sql` history. Whether production D1 `sqlite_master` exactly matches this register is **UNKNOWN** because no independent production schema query/export was available.

| Register item | Repository-confirmed current declaration | Production physical truth |
|---|---:|---|
| Regular tables / typed columns | 145 / 1,957 | UNKNOWN |
| Primary-key column declarations | 144; `trade_crm_counters` has no primary key | UNKNOWN |
| Explicit `.notNull()` / `.default()` column modifiers | 1,812 / 815 | UNKNOWN |
| Column-level `.unique()` constraints | 2 | UNKNOWN |
| Named unique / non-unique current indexes | 116 / 277 | UNKNOWN |
| Declared foreign keys / checks / cascades | 0 / 0 / 0 | UNKNOWN |
| SQL triggers | 16 | UNKNOWN |

### Relationship and constraint interpretation

The **declared relationship inventory is empty**: neither `db/schema.ts` nor the 79 production SQL files contains a Drizzle `.references()`/`foreignKey()` declaration or SQL `FOREIGN KEY`/`REFERENCES` clause. Consequently there are no declared parent targets, update/delete actions, deferrability rules or cascades to enumerate. This is a confirmed repository fact, not evidence that production contains no orphan data.

The final column below is deliberately labelled **application-reference candidates**. It exhaustively lists the 465 current column names other than bare `id` that end in `_id` or `_uid` (including `firebase_uid`). Naming and observed joins make these plausible application relationships, but the database does not declare their targets. Some are primary tenant identifiers or external/provider/request identifiers rather than relational links; this audit does not invent a target or cascade. Every one of the 465 is therefore explicitly disposed as `UNDECLARED APPLICATION REFERENCE CANDIDATE`; the table is not a claim that all are internal foreign-key relationships. Confirmed semantic relationship families from server queries are recorded below. Relationships outside those families remain `UNKNOWN`, not silently absent.

| Confirmed application-enforced relationship family | Representative source evidence | Integrity/tenant mechanism | Status |
|---|---|---|---|
| Tenant/actor identity -> owner-scoped records | Repeated `firebase_uid`, `owner_uid`, `customer_uid`, `installer_uid` candidates in the 145-table register; server identity boundary in `src/lib/firebase-server.ts:17-43` | Server binds authenticated UID/derived owner UID into selects and mutations | `PARTIAL`: pervasive, but no database FK or complete production orphan scan |
| CRM customer -> contacts/sites/site contacts -> work orders | Multi-entity reads at `src/app/api/trade-crm/route.ts:408-486`; atomic create/update batches in the same route | Owner UID plus IDs, exact-match checks and batches | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; referential enforcement is application-only |
| Work order -> tasks/appointments/notes/forms/time/media | `src/app/api/trade-work-orders/route.ts:181-251,308-537`; field route relationships | Owner/work-order predicates, revisions and D1 batches | `PARTIAL`; no FK/cascade and restore/delete ordering unproved |
| Team member/device -> assignment/schedule/mobile audience | `src/app/api/trade-team/sync/route.ts`; `src/app/api/trade-work-orders/route.ts:308-537` | Owner/member scope, active device and revisioned audience changes | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; physical-client acceptance blocked |
| Customer project -> opportunity -> match/quote/contact release/arrival | `src/app/api/trade-opportunities/route.ts:288-386`; admin match route in report 08 | Customer/installer/status/revision gates plus event records | `VERIFIED DEPLOYED` for dated slices; database relation remains unconstrained |
| Quote -> version/choices/link/acceptance -> commercial handoff | Quote/token routes and `src/app/api/trade-commercial-handoff/route.ts` | Immutable version IDs, token hash, explicit signer, unique/idempotent handoff | `PARTIAL`; complete production journey and external provider handoff unproved |
| Invoice/payment/accounting attempt -> provider event/document | Accounting/payment/webhook routes catalogued in report 08 | Stable external IDs, signature/replay checks, provider-neutral ledgers | `PARTIAL`; account/live reconciliation and Sites policy scope blocked/unknown |
| Asset -> service plan/event/handover/ownership/correction/safety | Asset, handover and correction routes catalogued in report 08 | Owner/customer/job predicates, immutable events and review states | `PARTIAL`; retention/export/restore and complete orphan proof absent |
| Notification event -> delivery -> provider callback/dedupe | `db/schema.ts:867-932`; `src/lib/appointment-notification-server.ts:36-200` | Event/idempotency keys, consent/opt-out checks and D1 batches | `PARTIAL`; live provider completeness varies |
| R2 object -> D1 metadata owner/domain record | R2 object-model table below and its route evidence | Opaque tenant/domain key plus authorized metadata row | `PARTIAL`; two-store transaction/orphan risk remains |
| Mobile server change/action/upload -> local queue/session/receipt | `mobile/src/lib/database.ts`; sync/media routes in report 08 | Revision, device, idempotency receipt/session and queue state | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; local/server restore acceptance absent |
| Admin entity/action -> audit/notification records | Admin route catalogue in report 08; `db/schema.ts:186-253` | Server-side role/owner gates, event/entity IDs and audit batch | `PARTIAL`; generic console bypass risk is treated separately |
| External/provider/correlation IDs | Stripe, Square, accounting, calendar, delivery and request/idempotency candidates in the table | Provider contract and uniqueness/idempotency rules, not internal parent rows | `PARTIAL`/`UNKNOWN` per report 11; deliberately not assigned invented FK targets |

### Transactions, locking, races and consistency

| Surface | Implemented control | Residual race/consistency disposition |
|---|---|---|
| Multi-row D1 domain changes | 63 `db.batch` operations across 51 modules are catalogued in report 08; representative work-order updates batch revision, event and sync-change writes (`src/app/api/trade-work-orders/route.ts:308-537`) | `PARTIAL`: batch boundaries are explicit, but there is no cross-request/global transaction coordinator and not every read-modify-write uses compare-and-set |
| Revision-guarded workflow changes | Arrival selection and field/mobile actions use current revision/state predicates (`src/app/api/trade-work-orders/route.ts:441-445`; `src/app/api/trade-field-work/route.ts:173-208`) | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; contention/load and every stale-write path were not exhaustively executed |
| Shared lead throttling | Version compare-and-swap plus `INSERT OR IGNORE`, up to 12 attempts (`src/lib/lead-rate-limit.mjs:51-127`) | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; fails closed on malformed/unavailable shared state; capacity not load-tested |
| Uniqueness/idempotency | 116 unique indexes, idempotency/event keys and `INSERT OR IGNORE`/`ON CONFLICT` patterns | `PARTIAL`: substantial duplicate protection, but no FK/check layer and provider-specific replay coverage varies |
| Apps Script admin alert dedupe | `LockService.getScriptLock().tryLock(30000)` protects dedupe/send/property write (`integrations/google-apps-script/lead-email-relay.gs:185-200`) | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; a busy request fails; live retry/alert ownership unknown |
| Apps Script Sheet follow-up/lead state | Daily handler scans/writes the bound sheet; no encompassing lock was found in `sendFollowUps` (`integrations/google-apps-script/lead-email-relay.gs:419-430`) | `PARTIAL`: overlapping manual/trigger/webhook writes can race; require row/idempotency/lock policy and concurrency test |
| Mobile local database | `withTransactionAsync` wraps server-change/purge reconciliation (`mobile/src/lib/database.ts:107-130`); one cached open-database promise serializes initialization | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; OS termination/interrupted file+SQLite operations and physical concurrency untested |
| D1 and R2 together | Uploads use put-then-metadata plus best-effort compensation; no distributed transaction | `PARTIAL`: Worker termination can leave orphan objects or missing-object metadata; reconciler/repair ledger absent |
| External provider side effects and D1 | Idempotency keys, callback ledgers and reconciliation helpers exist per report 11 | `PARTIAL`: network timeout after provider commit can leave uncertain local state; sandbox replay/reconciliation required per provider |

Constraint coverage is complete for the current Drizzle declaration: the matrix lists every primary key and every `DEFAULT` modifier; all 1,957 columns have either explicit `.notNull()` or `.primaryKey()` except nullable `customer_asset_ownerships.active_key` at `db/schema.ts:1015`. The only column-level unique constraints are `verification_documents.object_key` at `db/schema.ts:160` and `trade_handover_documents.object_key` at `db/schema.ts:703`. There are no `CHECK` constraints or table-level/composite primary-key declarations. The 116 unique indexes are enumerated in the following index register.

| Table | Evidence | Primary key | Columns with DEFAULT | Application-reference candidates only |
|---|---|---|---|---|
| `trade_accounts` | `db/schema.ts:4-41` | `firebase_uid@L5` | `abn@L8`, `address_line_1@L9`, `suburb@L10`, `address_state@L11`, `postcode@L12`, `phone@L14`, `partner_type@L15`, `business_website@L16`, `service_states@L17`, `capabilities@L18`, `summary@L19`, `account_status@L20`, `verification_status@L21`, `plan_key@L22`, `billing_status@L23`, `availability_status@L24`, `service_base_postcode@L25`, `service_radius_km@L26`, `email_opportunities@L27`, `email_weekly_summary@L28`, `is_synthetic@L29`, `settings_updated_at@L30` | `firebase_uid@L5` |
| `trade_supplier_locations` | `db/schema.ts:43-62` | `id@L44` | `location_type@L47`, `sales_email@L52`, `contact_number@L53`, `dispatch_notes@L54`, `service_states_json@L55`, `record_status@L56` | `firebase_uid@L45` |
| `stripe_memberships` | `db/schema.ts:64-82` | `id@L65` | `stripe_customer_id@L70`, `cancel_at_period_end@L73`, `current_period_end@L76` | `firebase_uid@L66`, `payment_link_id@L69`, `stripe_customer_id@L70`, `stripe_subscription_id@L71` |
| `stripe_webhook_events` | `db/schema.ts:84-90` | `id@L85` | none | none |
| `lead_rate_limits` | `db/schema.ts:92-99` | `client_hash@L93` | `timestamps@L94`, `version@L95` | none |
| `trade_referral_codes` | `db/schema.ts:101-110` | `code@L102` | `status@L104` | `firebase_uid@L103` |
| `trade_referrals` | `db/schema.ts:112-132` | `id@L113` | `status@L117`, `risk_reason@L118`, `referred_subscription_id@L119`, `first_paid_at@L121`, `rewarded_at@L122`, `reviewed_by_uid@L123`, `reviewed_at@L124` | `referrer_uid@L115`, `referred_uid@L116`, `referred_subscription_id@L119`, `reviewed_by_uid@L123` |
| `trade_membership_credits` | `db/schema.ts:134-151` | `id@L135` | `status@L140`, `extension_start@L141`, `extension_end@L142`, `stripe_request_id@L143`, `failure_code@L144` | `referral_id@L136`, `firebase_uid@L137`, `stripe_subscription_id@L139`, `stripe_request_id@L143` |
| `verification_documents` | `db/schema.ts:153-167` | `id@L154` | `expiry_date@L161`, `status@L162` | `firebase_uid@L155` |
| `admin_users` | `db/schema.ts:169-184` | `id@L170` | `display_name@L173`, `role@L174`, `status@L175`, `invited_by_uid@L176`, `last_login_at@L177` | `firebase_uid@L171`, `invited_by_uid@L176` |
| `admin_audit_log` | `db/schema.ts:186-199` | `id@L187` | `metadata@L193` | `admin_uid@L188`, `entity_id@L191` |
| `admin_notifications` | `db/schema.ts:201-234` | `id@L202` | `priority@L206`, `actor_type@L211`, `actor_uid@L212`, `requires_action@L213`, `status@L214`, `read_at@L215`, `read_by_uid@L216`, `resolved_at@L217`, `resolved_by_uid@L218`, `resolution_note@L219`, `assigned_to_uid@L220`, `assigned_at@L221`, `due_at@L222`, `metadata@L223` | `entity_id@L210`, `actor_uid@L212`, `read_by_uid@L216`, `resolved_by_uid@L218`, `assigned_to_uid@L220` |
| `admin_notification_deliveries` | `db/schema.ts:236-253` | `id@L237` | `channel@L239`, `status@L240`, `attempts@L241`, `next_attempt_at@L242`, `last_attempt_at@L243`, `delivered_at@L244`, `last_error@L245`, `response_code@L246` | `notification_id@L238` |
| `admin_usability_pilots` | `db/schema.ts:255-269` | `id@L256` | `target_participants@L259`, `status@L260`, `starts_at@L261`, `ends_at@L262`, `success_criteria@L263` | `created_by_uid@L264` |
| `admin_usability_pilot_participants` | `db/schema.ts:271-291` | `id@L272` | `baseline_system@L277`, `team_size@L278`, `primary_trade@L279`, `status@L280`, `owner_uid@L281`, `next_action@L282`, `completed_at@L284` | `pilot_id@L273`, `firebase_uid@L274`, `owner_uid@L281` |
| `admin_usability_pilot_sessions` | `db/schema.ts:293-315` | `id@L294` | `status@L298`, `scheduled_at@L299`, `completed_at@L300`, `duration_minutes@L301`, `tasks_attempted@L302`, `tasks_completed@L303`, `ease_score@L304`, `confidence_score@L305`, `feedback@L306`, `observed_frictions@L307`, `next_action@L308` | `pilot_id@L295`, `participant_id@L296`, `facilitator_uid@L309` |
| `trade_account_notes` | `db/schema.ts:317-325` | `id@L318` | none | `firebase_uid@L319`, `created_by_uid@L321` |
| `customer_account_notes` | `db/schema.ts:327-335` | `id@L328` | none | `firebase_uid@L329`, `created_by_uid@L331` |
| `trade_account_feature_grants` | `db/schema.ts:337-350` | `id@L338` | `status@L341`, `expires_at@L342`, `note@L343` | `firebase_uid@L339`, `granted_by_uid@L344` |
| `trade_work_orders` | `db/schema.ts:352-378` | `id@L353` | `work_type@L356`, `source_type@L357`, `source_reference@L358`, `service_category@L361`, `site_area@L362`, `stage@L363`, `priority@L364`, `scheduled_start@L365`, `scheduled_end@L366`, `assignee_member_id@L367`, `assignee_label@L368`, `revision@L369`, `record_status@L370` | `firebase_uid@L354`, `assignee_member_id@L367` |
| `trade_team_members` | `db/schema.ts:380-398` | `id@L381` | `member_uid@L383`, `role@L386`, `status@L387`, `accepted_at@L389`, `last_active_at@L390` | `owner_uid@L382`, `member_uid@L383` |
| `trade_team_invites` | `db/schema.ts:400-412` | `id@L401` | `consumed_at@L406` | `team_member_id@L402`, `owner_uid@L403` |
| `trade_team_sync_changes` | `db/schema.ts:414-426` | `sequence@L415` | `audience_member_id@L417`, `operation@L420`, `revision@L421` | `owner_uid@L416`, `audience_member_id@L417`, `entity_id@L419` |
| `trade_offline_actions` | `db/schema.ts:428-450` | `id@L429` | `member_id@L432`, `device_id@L433`, `base_revision@L439`, `result_revision@L440`, `status@L441`, `lease_until@L442`, `error_code@L443`, `updated_at@L445` | `owner_uid@L430`, `actor_uid@L431`, `member_id@L432`, `device_id@L433`, `client_action_id@L434`, `entity_id@L438` |
| `trade_mobile_devices` | `db/schema.ts:452-475` | `id@L453` | `member_id@L456`, `device_name@L459`, `push_provider@L461`, `push_token@L462`, `push_token_updated_at@L463`, `status@L464`, `revoked_at@L467`, `revoked_by_uid@L468` | `owner_uid@L454`, `actor_uid@L455`, `member_id@L456`, `device_id@L457`, `revoked_by_uid@L468` |
| `trade_mobile_push_outbox` | `db/schema.ts:477-495` | `id@L478` | `payload@L485`, `status@L486`, `attempts@L487`, `next_attempt_at@L488` | `owner_uid@L479`, `audience_member_id@L480`, `entity_id@L484` |
| `trade_mobile_upload_sessions` | `db/schema.ts:497-527` | `id@L498` | `member_id@L501`, `category@L511`, `caption@L512`, `status@L514`, `media_id@L515`, `completed_at@L517`, `last_error@L518` | `owner_uid@L499`, `actor_uid@L500`, `member_id@L501`, `device_id@L502`, `client_upload_id@L503`, `work_order_id@L505`, `upload_id@L507`, `media_id@L515` |
| `trade_mobile_upload_parts` | `db/schema.ts:529-540` | `id@L530` | none | `session_id@L531` |
| `trade_crm_counters` | `db/schema.ts:542-549` | none | `last_value@L545` | `firebase_uid@L543` |
| `trade_work_order_tasks` | `db/schema.ts:551-566` | `id@L552` | `due_at@L556`, `status@L557`, `completed_at@L558`, `revision@L559`, `sort_order@L560` | `work_order_id@L553`, `firebase_uid@L554` |
| `trade_work_order_events` | `db/schema.ts:568-578` | `id@L569` | none | `work_order_id@L570`, `firebase_uid@L571` |
| `trade_handover_packs` | `db/schema.ts:580-598` | `id@L581` | `customer_project_id@L584`, `service_category@L585`, `status@L586`, `submitted_at@L587`, `published_at@L588`, `review_note@L589`, `reviewed_by_uid@L590`, `reviewed_at@L591` | `work_order_id@L582`, `firebase_uid@L583`, `customer_project_id@L584`, `reviewed_by_uid@L590` |
| `trade_installed_assets` | `db/schema.ts:600-634` | `id@L601` | `crm_customer_id@L605`, `service_site_id@L606`, `source_type@L607`, `source_reference@L608`, `review_status@L609`, `asset_status@L610`, `asset_label@L611`, `commissioning_reference@L612`, `serial_number@L616`, `quantity@L617`, `installed_at@L618`, `warranty_provider@L619`, `warranty_reference@L620`, `warranty_start@L621`, `warranty_end@L622`, `supplier_product_id@L623`, `record_status@L624` | `handover_pack_id@L602`, `work_order_id@L603`, `firebase_uid@L604`, `crm_customer_id@L605`, `service_site_id@L606`, `supplier_product_id@L623` |
| `trade_job_notification_reads` | `db/schema.ts:636-645` | `id@L637` | none | `firebase_uid@L638`, `read_by_uid@L640` |
| `trade_team_working_hours` | `db/schema.ts:647-660` | `id@L648` | `is_available@L654` | `owner_uid@L649`, `team_member_id@L650` |
| `trade_team_unavailability` | `db/schema.ts:662-675` | `id@L663` | `reason@L668` | `owner_uid@L664`, `team_member_id@L665`, `created_by_uid@L669` |
| `trade_compliance_items` | `db/schema.ts:677-692` | `id@L678` | `guidance@L684`, `status@L685`, `completed_at@L686` | `handover_pack_id@L679`, `work_order_id@L680`, `firebase_uid@L681` |
| `trade_handover_documents` | `db/schema.ts:694-710` | `id@L695` | `customer_visible@L704` | `handover_pack_id@L696`, `work_order_id@L697`, `firebase_uid@L698` |
| `trade_asset_service_plans` | `db/schema.ts:712-733` | `id@L713` | `status@L721`, `job_template_id@L722`, `auto_create_enabled@L723`, `job_lead_days@L724`, `last_generated_due_at@L725`, `last_generated_work_order_id@L726` | `asset_id@L714`, `handover_pack_id@L715`, `work_order_id@L716`, `firebase_uid@L717`, `job_template_id@L722`, `last_generated_work_order_id@L726` |
| `trade_service_job_generations` | `db/schema.ts:735-747` | `id@L736` | `generated_work_order_id@L739` | `service_plan_id@L737`, `source_work_order_id@L738`, `generated_work_order_id@L739`, `firebase_uid@L740` |
| `trade_asset_service_events` | `db/schema.ts:749-767` | `id@L750` | `event_type@L756`, `summary@L758`, `provider_reference@L759`, `next_due_at@L760` | `service_plan_id@L751`, `asset_id@L752`, `handover_pack_id@L753`, `work_order_id@L754`, `firebase_uid@L755` |
| `trade_service_follow_ups` | `db/schema.ts:769-793` | `id@L770` | `status@L778`, `assignee_member_id@L779`, `suppression_reason@L780`, `internal_notes@L781`, `reminder_subject@L782`, `reminder_body@L783`, `revision@L784` | `service_plan_id@L771`, `asset_id@L772`, `crm_customer_id@L773`, `service_site_id@L774`, `work_order_id@L775`, `firebase_uid@L776`, `assignee_member_id@L779` |
| `trade_service_follow_up_events` | `db/schema.ts:795-806` | `id@L796` | none | `follow_up_id@L797`, `firebase_uid@L798`, `actor_uid@L799` |
| `service_reminder_channel_settings` | `db/schema.ts:808-820` | `channel@L809` | `enabled@L811`, `sender_label@L812`, `daily_limit@L813`, `revision@L814`, `updated_by_uid@L815` | `updated_by_uid@L815` |
| `service_reminder_deliveries` | `db/schema.ts:822-851` | `id@L823` | `status@L832`, `attempts@L833`, `provider_message_id@L834`, `provider_status@L835`, `last_error@L836`, `sent_at@L838`, `delivered_at@L839`, `failed_at@L840` | `follow_up_id@L824`, `firebase_uid@L825`, `customer_uid@L826`, `asset_id@L827`, `provider_message_id@L834`, `created_by_uid@L841` |
| `service_reminder_delivery_events` | `db/schema.ts:853-865` | `id@L854` | `provider_status@L858` | `delivery_id@L855` |
| `appointment_notification_events` | `db/schema.ts:867-887` | `id@L868` | none | `appointment_id@L870`, `work_order_id@L871`, `proposal_id@L872`, `project_id@L873`, `installer_uid@L874`, `customer_uid@L875` |
| `appointment_notification_deliveries` | `db/schema.ts:889-919` | `id@L890` | `status@L901`, `eligibility_reason@L902`, `attempts@L903`, `provider_message_id@L904`, `provider_status@L905`, `last_error@L906`, `sent_at@L908`, `delivered_at@L909`, `failed_at@L910` | `event_id@L891`, `appointment_id@L892`, `recipient_uid@L894`, `provider_message_id@L904` |
| `appointment_notification_delivery_events` | `db/schema.ts:921-933` | `id@L922` | `provider_status@L926` | `delivery_id@L923` |
| `customer_service_reminder_contacts` | `db/schema.ts:935-943` | `customer_uid@L936` | `mobile_e164@L937`, `mobile_verified_at@L938`, `pending_mobile_e164@L939` | `customer_uid@L936` |
| `customer_service_reminder_opt_outs` | `db/schema.ts:945-957` | `id@L946` | `provider_reference@L950` | `customer_uid@L947` |
| `customer_asset_lifecycle_preferences` | `db/schema.ts:959-972` | `id@L960` | `reminders_enabled@L963`, `email_enabled@L964`, `sms_enabled@L965`, `reminder_lead_days@L966` | `customer_uid@L961`, `asset_id@L962` |
| `asset_safety_notices` | `db/schema.ts:974-995` | `id@L975` | `severity@L979`, `asset_category@L980`, `brand@L981`, `model_number@L982`, `source_label@L984`, `effective_at@L985`, `expires_at@L986`, `status@L987`, `published_at@L988`, `withdrawn_at@L989` | `created_by_uid@L976` |
| `asset_safety_acknowledgements` | `db/schema.ts:997-1009` | `id@L998` | `status@L1002` | `notice_id@L999`, `asset_id@L1000`, `customer_uid@L1001` |
| `customer_asset_ownerships` | `db/schema.ts:1011-1027` | `id@L1012` | `status@L1016`, `source_type@L1017`, `transfer_id@L1018`, `ended_at@L1020` | `handover_pack_id@L1013`, `customer_uid@L1014`, `transfer_id@L1018` |
| `customer_asset_transfer_requests` | `db/schema.ts:1029-1050` | `id@L1030` | `to_customer_uid@L1033`, `status@L1035`, `recipient_consent_at@L1037`, `review_note@L1039`, `reviewed_by_uid@L1040`, `reviewed_at@L1041` | `handover_pack_id@L1031`, `from_customer_uid@L1032`, `to_customer_uid@L1033`, `reviewed_by_uid@L1040` |
| `customer_asset_transfer_events` | `db/schema.ts:1052-1063` | `id@L1053` | `actor_uid@L1057` | `transfer_id@L1054`, `actor_uid@L1057` |
| `trade_handover_corrections` | `db/schema.ts:1065-1089` | `id@L1066` | `previous_value@L1073`, `proposed_value@L1074`, `status@L1076`, `published_at@L1078`, `review_note@L1079`, `reviewed_by_uid@L1080`, `reviewed_at@L1081` | `handover_pack_id@L1067`, `work_order_id@L1068`, `firebase_uid@L1069`, `asset_id@L1070`, `reviewed_by_uid@L1080` |
| `trade_opportunities` | `db/schema.ts:1091-1116` | `id@L1092` | `postcode@L1095`, `service_categories@L1097`, `priority@L1098`, `timing@L1099`, `status@L1101`, `source_reference@L1102`, `contact_limit@L1103`, `maximum_connected_installers@L1104`, `expires_at@L1105`, `expired_at@L1106`, `is_synthetic@L1108` | `created_by_uid@L1107` |
| `trade_opportunity_matches` | `db/schema.ts:1118-1140` | `id@L1119` | `status@L1122`, `admin_note@L1123`, `partner_note@L1124`, `matched_categories@L1125`, `distance_metres@L1126`, `allocation_rank@L1127`, `match_source@L1128`, `contact_attempt_count@L1129`, `last_contact_at@L1130`, `connected_at@L1131` | `opportunity_id@L1120`, `firebase_uid@L1121`, `matched_by_uid@L1132` |
| `trade_crm_customers` | `db/schema.ts:1142-1167` | `id@L1143` | `customer_type@L1146`, `first_name@L1147`, `last_name@L1148`, `business_name@L1149`, `business_number@L1150`, `email@L1151`, `phone@L1152`, `address_line_1@L1153`, `address_line_2@L1154`, `suburb@L1155`, `address_state@L1156`, `postcode@L1157`, `tags@L1158`, `private_notes@L1159`, `record_status@L1160` | `firebase_uid@L1144` |
| `trade_crm_enquiries` | `db/schema.ts:1169-1210` | `id@L1170` | `source_type@L1172`, `source_reference@L1173`, `external_record_id@L1174`, `opportunity_match_id@L1175`, `status@L1176`, `customer_id@L1177`, `customer_contact_id@L1178`, `service_site_id@L1179`, `customer_type@L1180`, `first_name@L1181`, `last_name@L1182`, `business_name@L1183`, `business_number@L1184`, `email@L1185`, `phone@L1186`, `address_line_1@L1187`, `address_line_2@L1188`, `suburb@L1189`, `address_state@L1190`, `postcode@L1191`, `service_category@L1192`, `description@L1193`, `urgency@L1194`, `preferred_date@L1195`, `service_region@L1196`, `assigned_label@L1197`, `next_follow_up_at@L1198`, `lost_reason@L1199`, `protected_source@L1200`, `duplicate_decision@L1201`, `record_status@L1202` | `firebase_uid@L1171`, `external_record_id@L1174`, `opportunity_match_id@L1175`, `customer_id@L1177`, `customer_contact_id@L1178`, `service_site_id@L1179` |
| `trade_crm_enquiry_messages` | `db/schema.ts:1212-1224` | `id@L1213` | `channel@L1216`, `direction@L1217`, `subject@L1218` | `enquiry_id@L1214`, `firebase_uid@L1215` |
| `trade_crm_enquiry_attachments` | `db/schema.ts:1226-1238` | `id@L1227` | `content_type@L1231`, `size_bytes@L1232`, `object_key@L1233`, `status@L1234` | `enquiry_id@L1228`, `firebase_uid@L1229` |
| `trade_crm_enquiry_events` | `db/schema.ts:1240-1249` | `id@L1241` | none | `enquiry_id@L1242`, `firebase_uid@L1243` |
| `trade_crm_customer_contacts` | `db/schema.ts:1251-1268` | `id@L1252` | `first_name@L1255`, `last_name@L1256`, `role_label@L1257`, `email@L1258`, `phone@L1259`, `is_primary@L1260`, `record_status@L1261` | `firebase_uid@L1253`, `customer_id@L1254` |
| `trade_crm_service_sites` | `db/schema.ts:1270-1290` | `id@L1271` | `site_label@L1274`, `address_line_1@L1275`, `address_line_2@L1276`, `suburb@L1277`, `address_state@L1278`, `postcode@L1279`, `access_instructions@L1280`, `parking_instructions@L1281`, `hazard_notes@L1282`, `is_primary@L1283`, `record_status@L1284` | `firebase_uid@L1272`, `customer_id@L1273` |
| `trade_crm_site_contacts` | `db/schema.ts:1292-1305` | `id@L1293` | `role_label@L1297`, `is_primary@L1298`, `record_status@L1299` | `firebase_uid@L1294`, `service_site_id@L1295`, `customer_contact_id@L1296` |
| `trade_crm_job_details` | `db/schema.ts:1307-1333` | `id@L1308` | `crm_customer_id@L1311`, `service_site_id@L1312`, `customer_source@L1313`, `pipeline_stage@L1314`, `building_type@L1315`, `description@L1316`, `customer_reference@L1317`, `next_action@L1318`, `tags@L1319`, `estimated_value_cents@L1320`, `quoted_value_cents@L1321`, `invoiced_value_cents@L1322`, `paid_value_cents@L1323`, `quote_status@L1324`, `invoice_status@L1325`, `payment_due_at@L1326` | `work_order_id@L1309`, `firebase_uid@L1310`, `crm_customer_id@L1311`, `service_site_id@L1312` |
| `trade_price_book_items` | `db/schema.ts:1335-1364` | `id@L1336` | `description@L1340`, `unit_label@L1342`, `supplier_cost_cents_ex_gst@L1343`, `tax_code@L1345`, `markup_basis_points@L1346`, `margin_basis_points@L1347`, `expected_duration_minutes@L1348`, `required_skill@L1349`, `supplier_name@L1350`, `supplier_sku@L1351`, `supplier_product_id@L1352`, `record_status@L1353`, `price_revision@L1354` | `firebase_uid@L1337`, `supplier_product_id@L1352`, `created_by_uid@L1355`, `updated_by_uid@L1356` |
| `trade_price_book_price_history` | `db/schema.ts:1366-1382` | `id@L1367` | none | `price_book_item_id@L1368`, `firebase_uid@L1369`, `changed_by_uid@L1377` |
| `trade_job_packets` | `db/schema.ts:1384-1402` | `id@L1385` | `service_category@L1389`, `job_template_id@L1390`, `suggested_crew_size@L1391`, `record_status@L1392`, `revision@L1393` | `firebase_uid@L1386`, `job_template_id@L1390`, `created_by_uid@L1394`, `updated_by_uid@L1395` |
| `trade_job_packet_items` | `db/schema.ts:1404-1416` | `id@L1405` | none | `packet_id@L1406`, `firebase_uid@L1407`, `price_book_item_id@L1409` |
| `trade_job_packet_forms` | `db/schema.ts:1418-1430` | `id@L1419` | none | `packet_id@L1420`, `firebase_uid@L1421` |
| `trade_crm_quotes` | `db/schema.ts:1432-1447` | `id@L1433` | `current_version_number@L1439`, `status@L1440` | `work_order_id@L1434`, `firebase_uid@L1435`, `crm_customer_id@L1436`, `service_site_id@L1437` |
| `trade_crm_quote_versions` | `db/schema.ts:1449-1469` | `id@L1450` | `status@L1454`, `acceptance_email@L1455`, `subtotal_cents@L1456`, `tax_cents@L1457`, `total_cents@L1458`, `terms@L1459`, `valid_until@L1460`, `consent_statement@L1461`, `issued_at@L1462` | `quote_id@L1451`, `firebase_uid@L1452` |
| `trade_crm_quote_items` | `db/schema.ts:1471-1498` | `id@L1472` | `price_book_item_id@L1484`, `price_book_item_type@L1485`, `unit_cost_cents_ex_gst@L1486`, `markup_basis_points@L1487`, `margin_basis_points@L1488`, `job_packet_id@L1489`, `job_packet_revision@L1490`, `job_packet_line_id@L1491`, `section_heading@L1492`, `quote_choice_id@L1493` | `quote_version_id@L1473`, `firebase_uid@L1474`, `price_book_item_id@L1484`, `job_packet_id@L1489`, `job_packet_line_id@L1491`, `quote_choice_id@L1493` |
| `trade_crm_quote_execution_snapshots` | `db/schema.ts:1500-1505` | `id@L1501` | `source_kind@L1502`, `packets_json@L1502`, `expected_duration_minutes@L1503`, `suggested_crew_size@L1503`, `required_capabilities_json@L1504` | `quote_version_id@L1501`, `firebase_uid@L1501` |
| `trade_crm_quote_choices` | `db/schema.ts:1507-1526` | `id@L1508` | `summary@L1516`, `recommended@L1517`, `subtotal_cents@L1518`, `tax_cents@L1519`, `total_cents@L1520` | `quote_version_id@L1509`, `firebase_uid@L1510` |
| `trade_crm_quote_acceptances` | `db/schema.ts:1528-1559` | `id@L1529` | `actor_email_verified@L1537`, `actor_auth_time@L1538`, `actor_sign_in_provider@L1539`, `selected_choice_ids_json@L1542`, `selected_subtotal_cents@L1543`, `selected_tax_cents@L1544`, `selected_total_cents@L1545`, `selection_summary@L1546`, `signer_name@L1547`, `actor_type@L1548`, `quote_link_id@L1549`, `token_issue@L1550`, `commercial_reference@L1551`, `currency@L1552` | `quote_id@L1530`, `quote_version_id@L1531`, `work_order_id@L1532`, `firebase_uid@L1533`, `crm_customer_id@L1534`, `customer_firebase_uid@L1535`, `quote_link_id@L1549` |
| `trade_crm_commercial_handovers` | `db/schema.ts:1561-1588` | `id@L1562` | `currency@L1570`, `scope_snapshot_json@L1571`, `terms_snapshot@L1572`, `deposit_kind@L1576`, `deposit_basis_points@L1577`, `deposit_fixed_cents@L1578`, `deposit_amount_cents@L1579`, `status@L1580` | `acceptance_id@L1563`, `quote_id@L1564`, `quote_version_id@L1565`, `work_order_id@L1566`, `firebase_uid@L1567`, `crm_customer_id@L1568` |
| `trade_crm_job_plans` | `db/schema.ts:1590-1614` | `id@L1591` | `source_kind@L1597`, `status@L1598`, `budget_cost_cents@L1602`, `budget_margin_cents@L1603`, `expected_duration_minutes@L1604`, `suggested_crew_size@L1605`, `deposit_requirement@L1606`, `ready_at@L1607`, `completed_at@L1608` | `commercial_handoff_id@L1592`, `quote_version_id@L1593`, `work_order_id@L1594`, `firebase_uid@L1595` |
| `trade_crm_job_plan_phases` | `db/schema.ts:1616-1631` | `id@L1617` | `source_packet_id@L1623`, `source_packet_revision@L1624`, `expected_duration_minutes@L1625`, `status@L1626`, `completed_at@L1626`, `updated_at@L1627` | `job_plan_id@L1618`, `firebase_uid@L1619`, `source_packet_id@L1623` |
| `trade_crm_job_plan_requirements` | `db/schema.ts:1633-1652` | `id@L1634` | `source_id@L1640`, `quantity_milli@L1642`, `unit_cost_cents@L1643`, `total_cost_cents@L1644`, `expected_duration_minutes@L1645`, `required_capability@L1646`, `status@L1647` | `job_plan_id@L1635`, `job_plan_phase_id@L1636`, `firebase_uid@L1637`, `source_id@L1640` |
| `trade_crm_job_actuals` | `db/schema.ts:1654-1660` | `id@L1655` | `quantity_milli@L1657`, `duration_minutes@L1657`, `total_cost_cents@L1658`, `note@L1658` | `job_plan_id@L1655`, `job_plan_phase_id@L1655`, `job_plan_requirement_id@L1656`, `work_order_id@L1656`, `firebase_uid@L1656`, `recorded_by_uid@L1658` |
| `trade_crm_quote_links` | `db/schema.ts:1662-1668` | `id@L1663` | `encrypted_token@L1665`, `token_issue@L1665`, `status@L1666`, `revoked_at@L1666` | `quote_id@L1663`, `quote_version_id@L1663`, `work_order_id@L1664`, `firebase_uid@L1664`, `crm_customer_id@L1664` |
| `trade_crm_quote_events` | `db/schema.ts:1670-1674` | `id@L1671` | `quote_link_id@L1671`, `actor_type@L1672`, `summary@L1673` | `quote_link_id@L1671`, `quote_id@L1671`, `quote_version_id@L1671`, `work_order_id@L1672`, `firebase_uid@L1672` |
| `trade_crm_quote_questions` | `db/schema.ts:1676-1680` | `id@L1677` | `answer@L1678`, `status@L1679`, `answered_at@L1679`, `answered_by_uid@L1679` | `quote_link_id@L1677`, `quote_id@L1677`, `quote_version_id@L1677`, `work_order_id@L1678`, `firebase_uid@L1678`, `answered_by_uid@L1679` |
| `trade_crm_quote_deliveries` | `db/schema.ts:1682-1688` | `id@L1683` | `status@L1684`, `recipient_preview@L1684`, `consent_basis@L1685`, `provider_message_id@L1685`, `provider_status@L1685`, `attempts@L1686`, `last_error@L1686`, `sent_at@L1686`, `delivered_at@L1686` | `quote_link_id@L1683`, `quote_version_id@L1683`, `work_order_id@L1683`, `firebase_uid@L1683`, `crm_customer_id@L1683`, `provider_message_id@L1685` |
| `trade_crm_appointments` | `db/schema.ts:1690-1714` | `id@L1691` | `appointment_type@L1694`, `ends_at@L1697`, `assignee_member_id@L1698`, `assignee_label@L1699`, `status@L1700`, `travel_started_at@L1701`, `arrived_at@L1702`, `work_started_at@L1703`, `completed_at@L1704`, `last_transition_by_uid@L1705`, `notes@L1706`, `revision@L1707` | `work_order_id@L1692`, `firebase_uid@L1693`, `assignee_member_id@L1698`, `last_transition_by_uid@L1705` |
| `trade_crm_appointment_revisions` | `db/schema.ts:1716-1733` | `id@L1717` | `ends_at@L1723`, `assignee_member_id@L1724`, `assignee_label@L1725`, `source_reference@L1727` | `appointment_id@L1718`, `work_order_id@L1719`, `firebase_uid@L1720`, `assignee_member_id@L1724`, `changed_by_uid@L1728` |
| `trade_crm_appointment_reschedule_requests` | `db/schema.ts:1735-1768` | `id@L1736` | `status@L1743`, `active_key@L1744`, `preferred_windows@L1745`, `reason@L1746`, `access_notes@L1747`, `original_ends_at@L1750`, `original_assignee_member_id@L1751`, `original_assignee_label@L1752`, `proposed_starts_at@L1753`, `proposed_ends_at@L1754`, `proposed_assignee_member_id@L1755`, `proposed_assignee_label@L1756`, `decision_note@L1757`, `revision@L1758`, `decided_by_uid@L1760`, `decided_at@L1761` | `appointment_id@L1737`, `work_order_id@L1738`, `firebase_uid@L1739`, `crm_customer_id@L1740`, `customer_firebase_uid@L1741`, `original_assignee_member_id@L1751`, `proposed_assignee_member_id@L1755`, `decided_by_uid@L1760` |
| `trade_crm_appointment_reschedule_events` | `db/schema.ts:1770-1789` | `id@L1771` | `from_starts_at@L1780`, `from_ends_at@L1781`, `to_starts_at@L1782`, `to_ends_at@L1783` | `request_id@L1772`, `appointment_id@L1773`, `work_order_id@L1774`, `firebase_uid@L1775`, `actor_uid@L1777` |
| `trade_crm_job_templates` | `db/schema.ts:1791-1806` | `id@L1792` | `title@L1795`, `service_category@L1796`, `priority@L1797`, `description@L1798`, `task_titles@L1799`, `record_status@L1800` | `firebase_uid@L1793` |
| `trade_data_import_batches` | `db/schema.ts:1808-1832` | `id@L1809` | `file_size_bytes@L1814`, `row_count@L1815`, `ready_count@L1816`, `warning_count@L1817`, `duplicate_count@L1818`, `error_count@L1819`, `imported_count@L1820`, `skipped_count@L1821`, `failed_count@L1822`, `status@L1823`, `committed_at@L1824`, `rollback_until@L1825`, `rolled_back_at@L1826` | `firebase_uid@L1810` |
| `trade_data_import_rows` | `db/schema.ts:1834-1854` | `id@L1835` | `row_key@L1839`, `issues@L1842`, `resolution@L1843`, `result_status@L1844`, `target_entity_type@L1845`, `target_entity_id@L1846`, `error@L1847` | `batch_id@L1836`, `firebase_uid@L1837`, `target_entity_id@L1846` |
| `trade_job_forms` | `db/schema.ts:1856-1876` | `id@L1857` | `jurisdiction@L1863`, `answers@L1865`, `status@L1866`, `revision@L1867`, `completed_by_uid@L1868`, `completed_at@L1869` | `work_order_id@L1858`, `firebase_uid@L1859`, `completed_by_uid@L1868` |
| `trade_form_templates` | `db/schema.ts:1878-1899` | `id@L1879` | `jurisdiction@L1883`, `categories@L1884`, `description@L1885`, `guidance@L1886`, `fields@L1887`, `source_notes@L1888`, `status@L1889`, `published_by_uid@L1891`, `published_at@L1892`, `withdrawn_at@L1893` | `created_by_uid@L1890`, `published_by_uid@L1891` |
| `trade_crm_job_notes` | `db/schema.ts:1901-1913` | `id@L1902` | `note_type@L1905`, `issue_status@L1907` | `work_order_id@L1903`, `firebase_uid@L1904` |
| `trade_crm_time_entries` | `db/schema.ts:1915-1928` | `id@L1916` | `staff_label@L1919`, `notes@L1922` | `work_order_id@L1917`, `firebase_uid@L1918` |
| `trade_crm_job_media` | `db/schema.ts:1930-1952` | `id@L1931` | `category@L1934`, `caption@L1939`, `source@L1940`, `photo_request_id@L1941`, `photo_requirement_id@L1942`, `request_revision@L1943`, `checklist_version@L1944`, `customer_acknowledged_at@L1945` | `work_order_id@L1932`, `firebase_uid@L1933`, `photo_request_id@L1941`, `photo_requirement_id@L1942` |
| `trade_crm_photo_requests` | `db/schema.ts:1954-1981` | `id@L1955` | `encrypted_token@L1960`, `token_issue@L1961`, `status@L1962`, `requirements@L1963`, `revision@L1964`, `last_shared_at@L1966`, `source_template_id@L1967`, `source_template_version_id@L1968`, `source_template_version@L1969`, `source_template_edited@L1970`, `template_feedback@L1971`, `template_missing_feedback@L1972` | `work_order_id@L1956`, `firebase_uid@L1957`, `crm_customer_id@L1958`, `source_template_id@L1967`, `source_template_version_id@L1968`, `created_by_uid@L1973` |
| `trade_crm_photo_templates` | `db/schema.ts:1983-1998` | `id@L1984` | `service_category@L1987`, `status@L1988`, `draft_requirements@L1989`, `published_version@L1990` | `firebase_uid@L1985`, `created_by_uid@L1991`, `updated_by_uid@L1992` |
| `trade_crm_photo_template_versions` | `db/schema.ts:2000-2014` | `id@L2001` | none | `template_id@L2002`, `firebase_uid@L2003`, `published_by_uid@L2009` |
| `trade_crm_photo_request_events` | `db/schema.ts:2016-2029` | `id@L2017` | `actor_uid@L2022` | `photo_request_id@L2018`, `work_order_id@L2019`, `firebase_uid@L2020`, `actor_uid@L2022` |
| `trade_crm_photo_request_completions` | `db/schema.ts:2031-2049` | `id@L2032` | none | `photo_request_id@L2033`, `work_order_id@L2034`, `firebase_uid@L2035` |
| `trade_crm_photo_requirement_reviews` | `db/schema.ts:2051-2069` | `id@L2052` | `reason_code@L2060`, `guidance@L2061`, `reviewed_upload_count@L2062` | `photo_request_id@L2053`, `work_order_id@L2054`, `firebase_uid@L2055`, `photo_requirement_id@L2058`, `actor_uid@L2063` |
| `trade_crm_photo_request_deliveries` | `db/schema.ts:2071-2107` | `id@L2072` | `customer_uid@L2077`, `review_revision@L2082`, `photo_requirement_id@L2083`, `status@L2088`, `eligibility_reason@L2089`, `attempts@L2090`, `provider_message_id@L2091`, `provider_status@L2092`, `last_error@L2093`, `sent_at@L2095`, `delivered_at@L2096`, `failed_at@L2097` | `photo_request_id@L2073`, `work_order_id@L2074`, `firebase_uid@L2075`, `crm_customer_id@L2076`, `customer_uid@L2077`, `photo_requirement_id@L2083`, `provider_message_id@L2091`, `created_by_uid@L2098` |
| `trade_crm_photo_request_delivery_events` | `db/schema.ts:2109-2121` | `id@L2110` | `provider_status@L2114` | `delivery_id@L2111` |
| `trade_crm_signoffs` | `db/schema.ts:2123-2136` | `id@L2124` | `method@L2130` | `work_order_id@L2125`, `firebase_uid@L2126` |
| `trade_crm_quick_invoices` | `db/schema.ts:2138-2166` | `id@L2139` | `currency@L2144`, `line_items_json@L2145`, `subtotal_cents@L2146`, `tax_cents@L2147`, `total_cents@L2148`, `status@L2150`, `delivery_status@L2151`, `delivery_provider@L2152`, `provider_message_id@L2153`, `attempts@L2155`, `last_error@L2156`, `sent_at@L2157`, `revision@L2161` | `work_order_id@L2140`, `firebase_uid@L2141`, `crm_customer_id@L2142`, `provider_message_id@L2153`, `created_by_uid@L2158` |
| `trade_crm_quick_invoice_revisions` | `db/schema.ts:2168-2184` | `id@L2169` | `change_reason@L2178` | `invoice_id@L2170`, `firebase_uid@L2171`, `created_by_uid@L2179` |
| `trade_crm_quick_invoice_credits` | `db/schema.ts:2186-2204` | `id@L2187` | `status@L2196` | `invoice_id@L2188`, `work_order_id@L2189`, `firebase_uid@L2190`, `created_by_uid@L2198` |
| `trade_crm_invoice_payment_allocations` | `db/schema.ts:2206-2221` | `id@L2207` | `provider_payment_id@L2213` | `invoice_id@L2208`, `work_order_id@L2209`, `firebase_uid@L2210`, `payment_link_id@L2211`, `provider_payment_id@L2213` |
| `trade_crm_integrations` | `db/schema.ts:2223-2240` | `id@L2224` | `status@L2227`, `external_account_id@L2228`, `external_account_label@L2229`, `scopes@L2231`, `token_expires_at@L2232`, `last_sync_at@L2233`, `last_error@L2234` | `firebase_uid@L2225`, `external_account_id@L2228` |
| `trade_crm_oauth_states` | `db/schema.ts:2242-2254` | `id@L2243` | `consumed_at@L2249` | `firebase_uid@L2244` |
| `trade_crm_payment_links` | `db/schema.ts:2256-2290` | `id@L2257` | `commercial_handoff_id@L2260`, `commercial_reference@L2261`, `purpose@L2262`, `provider_order_id@L2265`, `provider_payment_id@L2266`, `paid_amount_cents@L2268`, `status@L2270`, `attempt_number@L2271`, `superseded_by_id@L2272`, `superseded_at@L2273`, `paid_at@L2274`, `failure_code@L2275`, `last_event_id@L2276`, `last_event_at@L2277` | `work_order_id@L2258`, `firebase_uid@L2259`, `commercial_handoff_id@L2260`, `external_id@L2264`, `provider_order_id@L2265`, `provider_payment_id@L2266`, `superseded_by_id@L2272`, `last_event_id@L2276` |
| `trade_crm_payment_events` | `db/schema.ts:2292-2309` | `id@L2293` | `amount_cents@L2301`, `provider_payment_id@L2302`, `occurred_at@L2303` | `event_id@L2295`, `payment_link_id@L2297`, `work_order_id@L2298`, `firebase_uid@L2299`, `provider_payment_id@L2302` |
| `trade_crm_accounting_documents` | `db/schema.ts:2311-2342` | `id@L2312` | `commercial_handoff_id@L2315`, `commercial_reference@L2316`, `scope_snapshot_json@L2317`, `subtotal_cents@L2318`, `tax_cents@L2319`, `document_type@L2321`, `external_contact_id@L2322`, `external_document_id@L2323`, `external_number@L2324`, `external_url@L2325`, `account_reference@L2326`, `amount_cents@L2327`, `paid_amount_cents@L2328`, `currency@L2329`, `status@L2330`, `provider_status@L2331`, `due_at@L2332`, `last_synced_at@L2333`, `last_error@L2334` | `work_order_id@L2313`, `firebase_uid@L2314`, `commercial_handoff_id@L2315`, `external_contact_id@L2322`, `external_document_id@L2323` |
| `trade_crm_accounting_events` | `db/schema.ts:2344-2360` | `id@L2345` | `provider_status@L2352`, `amount_cents@L2353`, `paid_amount_cents@L2354`, `detail@L2355` | `accounting_document_id@L2346`, `work_order_id@L2347`, `firebase_uid@L2348` |
| `customer_accounts` | `db/schema.ts:2362-2384` | `firebase_uid@L2363` | `phone@L2366`, `address_line_1@L2367`, `address_line_2@L2368`, `suburb@L2369`, `postcode@L2370`, `address_state@L2371`, `property_type@L2372`, `household_situation@L2373`, `account_updates@L2374`, `account_status@L2375`, `is_synthetic@L2376` | `firebase_uid@L2363` |
| `customer_projects` | `db/schema.ts:2386-2417` | `id@L2387` | `home_nickname@L2390`, `existing_features@L2397`, `service_categories@L2398`, `priorities@L2399`, `project_stage@L2400`, `timing@L2401`, `budget_range@L2402`, `property_context@L2403`, `private_notes@L2404`, `plan_snapshot@L2405`, `completed_plan_items@L2406`, `status@L2407`, `opportunity_id@L2408`, `submitted_at@L2409`, `archived_at@L2410`, `is_synthetic@L2411` | `firebase_uid@L2388`, `opportunity_id@L2408` |
| `customer_consent_receipts` | `db/schema.ts:2419-2431` | `id@L2420` | `project_id@L2422`, `withdrawn_at@L2426` | `firebase_uid@L2421`, `project_id@L2422` |
| `customer_project_quotes` | `db/schema.ts:2433-2458` | `id@L2434` | `product_list_id@L2439`, `inclusions@L2440`, `product_snapshot@L2441`, `product_subtotal_cents_ex_gst@L2442`, `labour_cents_ex_gst@L2443`, `other_cents_ex_gst@L2444`, `total_cents_ex_gst@L2445`, `quote_type@L2446`, `start_window@L2447`, `duration_weeks@L2448`, `workmanship_warranty_years@L2449`, `status@L2450`, `customer_decision@L2451` | `project_id@L2435`, `opportunity_id@L2436`, `opportunity_match_id@L2437`, `installer_uid@L2438`, `product_list_id@L2439` |
| `trade_crm_calendar_events` | `db/schema.ts:2460-2476` | `id@L2461` | `external_event_id@L2465`, `external_url@L2466`, `appointment_revision@L2467`, `status@L2468`, `last_error@L2469`, `last_synced_at@L2470` | `firebase_uid@L2462`, `appointment_id@L2463`, `external_event_id@L2465` |
| `customer_project_contact_releases` | `db/schema.ts:2478-2505` | `id@L2479` | `status@L2486`, `disclosed_fields@L2488`, `address_line_2@L2493`, `withdrawn_at@L2498` | `project_id@L2480`, `opportunity_id@L2481`, `opportunity_match_id@L2482`, `quote_id@L2483`, `customer_uid@L2484`, `installer_uid@L2485` |
| `customer_project_contact_release_events` | `db/schema.ts:2507-2523` | `id@L2508` | `disclosed_fields@L2518` | `release_id@L2509`, `project_id@L2510`, `opportunity_match_id@L2511`, `customer_uid@L2512`, `installer_uid@L2513`, `actor_uid@L2515` |
| `customer_project_evidence` | `db/schema.ts:2525-2541` | `id@L2526` | `status@L2535` | `project_id@L2527`, `customer_uid@L2528`, `client_upload_id@L2529` |
| `customer_project_evidence_events` | `db/schema.ts:2543-2556` | `id@L2544` | `installer_uid@L2548` | `evidence_id@L2545`, `project_id@L2546`, `customer_uid@L2547`, `installer_uid@L2548`, `actor_uid@L2550` |
| `customer_project_arrival_proposals` | `db/schema.ts:2558-2584` | `id@L2559` | `status@L2565`, `windows@L2566`, `installer_note@L2567`, `selected_window@L2568`, `revision@L2569`, `selected_at@L2571`, `direct_contact_snapshot@L2572`, `direct_contact_selected_at@L2573`, `crm_work_order_id@L2574`, `crm_appointment_id@L2575`, `preparation_acknowledged_at@L2576`, `withdrawn_at@L2577` | `project_id@L2560`, `quote_id@L2561`, `opportunity_match_id@L2562`, `customer_uid@L2563`, `installer_uid@L2564`, `crm_work_order_id@L2574`, `crm_appointment_id@L2575` |
| `customer_project_arrival_events` | `db/schema.ts:2586-2603` | `id@L2587` | `windows@L2597`, `selected_window@L2598` | `proposal_id@L2588`, `project_id@L2589`, `opportunity_match_id@L2590`, `customer_uid@L2591`, `installer_uid@L2592`, `actor_uid@L2594` |
| `supplier_products` | `db/schema.ts:2605-2638` | `id@L2606` | `min_order_qty@L2614`, `order_increment@L2615`, `unit_label@L2616`, `stock_status@L2617`, `lead_time_days@L2618`, `warranty_years@L2619`, `datasheet_url@L2620`, `listing_status@L2621`, `review_status@L2622`, `review_note@L2623`, `is_synthetic@L2624` | `firebase_uid@L2607` |
| `supplier_product_links` | `db/schema.ts:2640-2654` | `id@L2641` | `relationship@L2645`, `default_qty@L2646`, `note@L2647` | `firebase_uid@L2642`, `product_id@L2643`, `linked_product_id@L2644` |
| `installer_catalogue_preferences` | `db/schema.ts:2656-2675` | `firebase_uid@L2657` | `search@L2658`, `model_search@L2659`, `category@L2660`, `supplier_uid@L2661`, `brand@L2662`, `service_state@L2663`, `stock_status@L2664`, `minimum_price_cents@L2665`, `maximum_price_cents@L2666`, `maximum_lead_days@L2667`, `minimum_warranty_years@L2668`, `sort_key@L2669`, `page_size@L2670`, `visible_columns@L2671` | `firebase_uid@L2657`, `supplier_uid@L2661` |
| `workspace_list_views` | `db/schema.ts:2677-2687` | `id@L2678` | `preferences@L2682` | `owner_uid@L2679` |
| `installer_product_lists` | `db/schema.ts:2689-2701` | `id@L2690` | `project_postcode@L2693`, `notes@L2694`, `status@L2695`, `submitted_at@L2696` | `firebase_uid@L2691` |
| `installer_product_list_items` | `db/schema.ts:2703-2716` | `id@L2704` | `quantity@L2708` | `list_id@L2705`, `product_id@L2706`, `supplier_uid@L2707` |
| `supplier_product_enquiries` | `db/schema.ts:2718-2732` | `id@L2719` | `status@L2723`, `message@L2724`, `supplier_note@L2725` | `list_id@L2720`, `installer_uid@L2721`, `supplier_uid@L2722` |
| `trade_purchase_orders` | `db/schema.ts:2734-2761` | `id@L2735` | `status@L2741`, `installer_reference@L2742`, `supplier_reference@L2743`, `delivery_method@L2744`, `delivery_notes@L2745`, `supplier_note@L2746`, `expected_at@L2747`, `subtotal_cents_ex_gst@L2748`, `gst_cents@L2749`, `total_cents_inc_gst@L2750`, `confirmed_at@L2752`, `fulfilled_at@L2753` | `enquiry_id@L2737`, `list_id@L2738`, `installer_uid@L2739`, `supplier_uid@L2740` |
| `trade_purchase_order_items` | `db/schema.ts:2763-2780` | `id@L2764` | `unit_label@L2770`, `quantity@L2771`, `fulfilled_quantity@L2772`, `warranty_years@L2774` | `purchase_order_id@L2765`, `supplier_product_id@L2766` |
| `trade_purchase_order_events` | `db/schema.ts:2782-2793` | `id@L2783` | none | `purchase_order_id@L2784`, `actor_uid@L2789` |
| `trade_warranty_claims` | `db/schema.ts:2795-2817` | `id@L2796` | `status@L2802`, `serial_number@L2805`, `supplier_response@L2806`, `resolution@L2807`, `resolved_at@L2809` | `purchase_order_id@L2798`, `purchase_order_item_id@L2799`, `installer_uid@L2800`, `supplier_uid@L2801` |
| `certificate_price_history` | `db/schema.ts:2819-2829` | `id@L2820` | none | none |
| `certificate_price_sync_runs` | `db/schema.ts:2831-2840` | `id@L2832` | `record_count@L2835`, `message@L2836` | none |
| `api_performance_samples` | `db/schema.ts:2842-2857` | `id@L2843` | `db_duration_ms@L2849`, `result_count@L2850`, `cursor_used@L2851` | none |

### Complete current named-index register

Every named current Drizzle index is listed once below. `@L` is the declaration line in `db/schema.ts`. A dash means the table declares no named index of that class. This is an object-identity inventory; indexed expressions and sort predicates remain visible at the cited line.

| Table | Unique indexes (116) | Non-unique indexes (277) |
|---|---|---|
| `trade_accounts` | none | `trade_accounts_eligibility_idx@L36`, `trade_accounts_admin_type_updated_idx@L37`, `trade_accounts_admin_status_updated_idx@L38`, `trade_accounts_admin_verification_updated_idx@L39`, `trade_accounts_business_nocase_idx@L40` |
| `trade_supplier_locations` | `trade_supplier_locations_owner_name_idx@L60` | `trade_supplier_locations_owner_status_idx@L61` |
| `stripe_memberships` | `stripe_memberships_subscription_idx@L80` | `stripe_memberships_owner_idx@L81` |
| `stripe_webhook_events` | none | `stripe_webhook_events_created_idx@L89` |
| `lead_rate_limits` | none | `lead_rate_limits_updated_idx@L98` |
| `trade_referral_codes` | `trade_referral_codes_owner_idx@L108` | `trade_referral_codes_status_idx@L109` |
| `trade_referrals` | `trade_referrals_referred_idx@L128` | `trade_referrals_referrer_idx@L129`, `trade_referrals_code_idx@L130`, `trade_referrals_status_idx@L131` |
| `trade_membership_credits` | `trade_membership_credits_beneficiary_idx@L148` | `trade_membership_credits_owner_idx@L149`, `trade_membership_credits_status_idx@L150` |
| `verification_documents` | none | `verification_documents_owner_idx@L166` |
| `admin_users` | `admin_users_firebase_uid_idx@L181`, `admin_users_email_idx@L182` | `admin_users_status_idx@L183` |
| `admin_audit_log` | none | `admin_audit_log_created_idx@L196`, `admin_audit_log_admin_idx@L197`, `admin_audit_log_entity_idx@L198` |
| `admin_notifications` | `admin_notifications_event_key_idx@L227` | `admin_notifications_status_idx@L228`, `admin_notifications_action_idx@L229`, `admin_notifications_category_idx@L230`, `admin_notifications_entity_idx@L231`, `admin_notifications_assignee_idx@L232`, `admin_notifications_due_idx@L233` |
| `admin_notification_deliveries` | `admin_notification_deliveries_notification_channel_idx@L250` | `admin_notification_deliveries_status_idx@L251`, `admin_notification_deliveries_notification_idx@L252` |
| `admin_usability_pilots` | none | `admin_usability_pilots_status_idx@L268` |
| `admin_usability_pilot_participants` | `admin_usability_pilot_participant_account_idx@L288`, `admin_usability_pilot_participant_slot_idx@L289` | `admin_usability_pilot_participant_status_idx@L290` |
| `admin_usability_pilot_sessions` | none | `admin_usability_pilot_sessions_participant_idx@L313`, `admin_usability_pilot_sessions_status_idx@L314` |
| `trade_account_notes` | none | `trade_account_notes_owner_idx@L324` |
| `customer_account_notes` | none | `customer_account_notes_owner_idx@L334` |
| `trade_account_feature_grants` | `trade_account_feature_grants_owner_key_idx@L348` | `trade_account_feature_grants_owner_idx@L349` |
| `trade_work_orders` | `trade_work_orders_owner_number_idx@L374`, `trade_work_orders_tlink_job_number_idx@L375` | `trade_work_orders_owner_stage_idx@L376`, `trade_work_orders_source_idx@L377` |
| `trade_team_members` | `trade_team_members_owner_email_idx@L394` | `trade_team_members_owner_member_idx@L395`, `trade_team_members_member_status_idx@L396`, `trade_team_members_owner_status_idx@L397` |
| `trade_team_invites` | `trade_team_invites_token_idx@L409` | `trade_team_invites_member_idx@L410`, `trade_team_invites_owner_idx@L411` |
| `trade_team_sync_changes` | none | `trade_team_sync_changes_owner_sequence_idx@L424`, `trade_team_sync_changes_entity_idx@L425` |
| `trade_offline_actions` | `trade_offline_actions_owner_client_idx@L447` | `trade_offline_actions_actor_idx@L448`, `trade_offline_actions_entity_idx@L449` |
| `trade_mobile_devices` | `trade_mobile_devices_owner_device_idx@L471` | `trade_mobile_devices_owner_status_idx@L472`, `trade_mobile_devices_actor_status_idx@L473`, `trade_mobile_devices_member_status_idx@L474` |
| `trade_mobile_push_outbox` | `trade_mobile_push_outbox_event_idx@L492` | `trade_mobile_push_outbox_pending_idx@L493`, `trade_mobile_push_outbox_audience_idx@L494` |
| `trade_mobile_upload_sessions` | `trade_mobile_upload_sessions_owner_client_idx@L522`, `trade_mobile_upload_sessions_object_idx@L523` | `trade_mobile_upload_sessions_device_idx@L524`, `trade_mobile_upload_sessions_job_idx@L525`, `trade_mobile_upload_sessions_expiry_idx@L526` |
| `trade_mobile_upload_parts` | `trade_mobile_upload_parts_session_part_idx@L538` | `trade_mobile_upload_parts_session_idx@L539` |
| `trade_crm_counters` | `trade_crm_counters_owner_key_idx@L548` | none |
| `trade_work_order_tasks` | none | `trade_work_order_tasks_owner_idx@L564`, `trade_work_order_tasks_order_idx@L565` |
| `trade_work_order_events` | none | `trade_work_order_events_owner_idx@L576`, `trade_work_order_events_order_idx@L577` |
| `trade_handover_packs` | `trade_handover_packs_work_order_idx@L595` | `trade_handover_packs_owner_idx@L596`, `trade_handover_packs_customer_project_idx@L597` |
| `trade_installed_assets` | none | `trade_installed_assets_pack_idx@L628`, `trade_installed_assets_owner_idx@L629`, `trade_installed_assets_warranty_idx@L630`, `trade_installed_assets_customer_idx@L631`, `trade_installed_assets_site_idx@L632`, `trade_installed_assets_review_idx@L633` |
| `trade_job_notification_reads` | `trade_job_notification_reads_actor_key_idx@L643` | `trade_job_notification_reads_actor_time_idx@L644` |
| `trade_team_working_hours` | `trade_team_working_hours_member_day_idx@L658` | `trade_team_working_hours_owner_day_idx@L659` |
| `trade_team_unavailability` | none | `trade_team_unavailability_owner_range_idx@L673`, `trade_team_unavailability_member_range_idx@L674` |
| `trade_compliance_items` | `trade_compliance_items_pack_key_idx@L690` | `trade_compliance_items_owner_idx@L691` |
| `trade_handover_documents` | none | `trade_handover_documents_pack_idx@L708`, `trade_handover_documents_owner_idx@L709` |
| `trade_asset_service_plans` | `trade_asset_service_plans_asset_type_idx@L730` | `trade_asset_service_plans_owner_due_idx@L731`, `trade_asset_service_plans_pack_idx@L732` |
| `trade_service_job_generations` | `trade_service_job_generations_plan_due_idx@L744` | `trade_service_job_generations_owner_idx@L745`, `trade_service_job_generations_work_idx@L746` |
| `trade_asset_service_events` | none | `trade_asset_service_events_plan_idx@L764`, `trade_asset_service_events_asset_idx@L765`, `trade_asset_service_events_owner_idx@L766` |
| `trade_service_follow_ups` | `trade_service_follow_ups_plan_due_idx@L788` | `trade_service_follow_ups_owner_status_due_idx@L789`, `trade_service_follow_ups_owner_assignee_due_idx@L790`, `trade_service_follow_ups_owner_customer_site_idx@L791`, `trade_service_follow_ups_report_due_idx@L792` |
| `trade_service_follow_up_events` | none | `trade_service_follow_up_events_record_idx@L804`, `trade_service_follow_up_events_owner_idx@L805` |
| `service_reminder_channel_settings` | none | `service_reminder_channel_settings_enabled_idx@L819` |
| `service_reminder_deliveries` | `service_reminder_deliveries_idempotency_idx@L845`, `service_reminder_deliveries_provider_message_idx@L846` | `service_reminder_deliveries_follow_up_idx@L847`, `service_reminder_deliveries_owner_status_idx@L848`, `service_reminder_deliveries_customer_channel_idx@L849`, `service_reminder_deliveries_report_time_idx@L850` |
| `service_reminder_delivery_events` | `service_reminder_delivery_events_provider_idx@L863` | `service_reminder_delivery_events_delivery_idx@L864` |
| `appointment_notification_events` | `appointment_notification_events_key_idx@L884` | `appointment_notification_events_appointment_idx@L885`, `appointment_notification_events_project_idx@L886` |
| `appointment_notification_deliveries` | `appointment_notification_deliveries_idempotency_idx@L914`, `appointment_notification_deliveries_provider_message_idx@L915` | `appointment_notification_deliveries_event_idx@L916`, `appointment_notification_deliveries_status_idx@L917`, `appointment_notification_deliveries_recipient_idx@L918` |
| `appointment_notification_delivery_events` | `appointment_notification_delivery_events_provider_idx@L931` | `appointment_notification_delivery_events_delivery_idx@L932` |
| `customer_service_reminder_contacts` | `customer_service_reminder_contacts_mobile_idx@L942` | none |
| `customer_service_reminder_opt_outs` | `customer_service_reminder_opt_outs_customer_channel_idx@L954` | `customer_service_reminder_opt_outs_channel_idx@L955`, `customer_service_reminder_opt_outs_report_time_idx@L956` |
| `customer_asset_lifecycle_preferences` | `customer_asset_lifecycle_preferences_owner_asset_idx@L970` | `customer_asset_lifecycle_preferences_owner_idx@L971` |
| `asset_safety_notices` | none | `asset_safety_notices_status_idx@L993`, `asset_safety_notices_scope_idx@L994` |
| `asset_safety_acknowledgements` | `asset_safety_acknowledgements_owner_notice_asset_idx@L1006` | `asset_safety_acknowledgements_notice_idx@L1007`, `asset_safety_acknowledgements_owner_idx@L1008` |
| `customer_asset_ownerships` | `customer_asset_ownerships_active_key_idx@L1024` | `customer_asset_ownerships_owner_idx@L1025`, `customer_asset_ownerships_pack_idx@L1026` |
| `customer_asset_transfer_requests` | `customer_asset_transfer_requests_code_idx@L1045` | `customer_asset_transfer_requests_pack_idx@L1046`, `customer_asset_transfer_requests_sender_idx@L1047`, `customer_asset_transfer_requests_recipient_idx@L1048`, `customer_asset_transfer_requests_expiry_idx@L1049` |
| `customer_asset_transfer_events` | none | `customer_asset_transfer_events_transfer_idx@L1061`, `customer_asset_transfer_events_actor_idx@L1062` |
| `trade_handover_corrections` | `trade_handover_corrections_pack_version_idx@L1085` | `trade_handover_corrections_owner_idx@L1086`, `trade_handover_corrections_pack_idx@L1087`, `trade_handover_corrections_asset_idx@L1088` |
| `trade_opportunities` | none | `trade_opportunities_status_idx@L1112`, `trade_opportunities_state_idx@L1113`, `trade_opportunities_title_nocase_idx@L1114`, `trade_opportunities_expiry_idx@L1115` |
| `trade_opportunity_matches` | `trade_opportunity_matches_unique_idx@L1136` | `trade_opportunity_matches_owner_idx@L1137`, `trade_opportunity_matches_opportunity_idx@L1138`, `trade_opportunity_matches_status_idx@L1139` |
| `trade_crm_customers` | `trade_crm_customers_owner_number_idx@L1164` | `trade_crm_customers_owner_status_idx@L1165`, `trade_crm_customers_owner_name_idx@L1166` |
| `trade_crm_enquiries` | `trade_crm_enquiries_owner_source_idx@L1206` | `trade_crm_enquiries_owner_status_idx@L1207`, `trade_crm_enquiries_owner_external_idx@L1208`, `trade_crm_enquiries_customer_idx@L1209` |
| `trade_crm_enquiry_messages` | none | `trade_crm_enquiry_messages_owner_idx@L1223` |
| `trade_crm_enquiry_attachments` | none | `trade_crm_enquiry_attachments_owner_idx@L1237` |
| `trade_crm_enquiry_events` | none | `trade_crm_enquiry_events_owner_idx@L1248` |
| `trade_crm_customer_contacts` | none | `trade_crm_customer_contacts_owner_customer_idx@L1265`, `trade_crm_customer_contacts_owner_email_idx@L1266`, `trade_crm_customer_contacts_owner_phone_idx@L1267` |
| `trade_crm_service_sites` | none | `trade_crm_service_sites_owner_customer_idx@L1288`, `trade_crm_service_sites_owner_postcode_idx@L1289` |
| `trade_crm_site_contacts` | `trade_crm_site_contacts_owner_site_contact_idx@L1303` | `trade_crm_site_contacts_owner_contact_idx@L1304` |
| `trade_crm_job_details` | `trade_crm_job_details_work_order_idx@L1330` | `trade_crm_job_details_owner_pipeline_idx@L1331`, `trade_crm_job_details_customer_idx@L1332` |
| `trade_price_book_items` | `trade_price_book_items_owner_code_idx@L1360` | `trade_price_book_items_owner_status_name_idx@L1361`, `trade_price_book_items_owner_type_idx@L1362`, `trade_price_book_items_supplier_product_idx@L1363` |
| `trade_price_book_price_history` | `trade_price_book_price_history_revision_idx@L1380` | `trade_price_book_price_history_owner_changed_idx@L1381` |
| `trade_job_packets` | `trade_job_packets_owner_code_idx@L1399`, `trade_job_packets_owner_name_idx@L1400` | `trade_job_packets_owner_status_idx@L1401` |
| `trade_job_packet_items` | `trade_job_packet_items_position_idx@L1413`, `trade_job_packet_items_price_idx@L1414` | `trade_job_packet_items_owner_idx@L1415` |
| `trade_job_packet_forms` | `trade_job_packet_forms_position_idx@L1427`, `trade_job_packet_forms_template_idx@L1428` | `trade_job_packet_forms_owner_idx@L1429` |
| `trade_crm_quotes` | `trade_crm_quotes_owner_work_idx@L1444`, `trade_crm_quotes_owner_number_idx@L1445` | `trade_crm_quotes_customer_idx@L1446` |
| `trade_crm_quote_versions` | `trade_crm_quote_versions_quote_version_idx@L1466` | `trade_crm_quote_versions_owner_idx@L1467`, `trade_crm_quote_versions_acceptance_email_idx@L1468` |
| `trade_crm_quote_items` | `trade_crm_quote_items_version_position_idx@L1496` | `trade_crm_quote_items_owner_idx@L1497` |
| `trade_crm_quote_execution_snapshots` | `trade_crm_quote_execution_snapshots_version_idx@L1505` | `trade_crm_quote_execution_snapshots_owner_idx@L1505` |
| `trade_crm_quote_choices` | `trade_crm_quote_choices_version_key_idx@L1523`, `trade_crm_quote_choices_version_position_idx@L1524` | `trade_crm_quote_choices_owner_version_idx@L1525` |
| `trade_crm_quote_acceptances` | `trade_crm_quote_acceptances_version_idx@L1556` | `trade_crm_quote_acceptances_owner_idx@L1557`, `trade_crm_quote_acceptances_customer_idx@L1558` |
| `trade_crm_commercial_handovers` | `trade_crm_commercial_handovers_acceptance_idx@L1585`, `trade_crm_commercial_handovers_reference_idx@L1586` | `trade_crm_commercial_handovers_work_idx@L1587` |
| `trade_crm_job_plans` | `trade_crm_job_plans_handoff_idx@L1612` | `trade_crm_job_plans_work_idx@L1613` |
| `trade_crm_job_plan_phases` | `trade_crm_job_plan_phases_position_idx@L1629` | `trade_crm_job_plan_phases_owner_idx@L1630` |
| `trade_crm_job_plan_requirements` | `trade_crm_job_plan_requirements_position_idx@L1650` | `trade_crm_job_plan_requirements_owner_idx@L1651` |
| `trade_crm_job_actuals` | `trade_crm_job_actuals_requirement_idx@L1660` | `trade_crm_job_actuals_work_idx@L1660`, `trade_crm_job_actuals_plan_idx@L1660` |
| `trade_crm_quote_links` | `trade_crm_quote_links_version_idx@L1668` | `trade_crm_quote_links_owner_idx@L1668`, `trade_crm_quote_links_expiry_idx@L1668` |
| `trade_crm_quote_events` | `trade_crm_quote_events_evidence_idx@L1674` | `trade_crm_quote_events_version_idx@L1674`, `trade_crm_quote_events_owner_idx@L1674` |
| `trade_crm_quote_questions` | none | `trade_crm_quote_questions_version_idx@L1680`, `trade_crm_quote_questions_owner_idx@L1680` |
| `trade_crm_quote_deliveries` | `trade_crm_quote_deliveries_idempotency_idx@L1688` | `trade_crm_quote_deliveries_version_idx@L1688` |
| `trade_crm_appointments` | none | `trade_crm_appointments_owner_start_idx@L1711`, `trade_crm_appointments_work_order_idx@L1712`, `trade_crm_appointments_assignee_start_idx@L1713` |
| `trade_crm_appointment_revisions` | `trade_crm_appointment_revisions_item_revision_idx@L1731` | `trade_crm_appointment_revisions_owner_idx@L1732` |
| `trade_crm_appointment_reschedule_requests` | `trade_crm_appointment_reschedule_active_idx@L1765` | `trade_crm_appointment_reschedule_owner_idx@L1766`, `trade_crm_appointment_reschedule_customer_idx@L1767` |
| `trade_crm_appointment_reschedule_events` | none | `trade_crm_appointment_reschedule_events_request_idx@L1787`, `trade_crm_appointment_reschedule_events_owner_idx@L1788` |
| `trade_crm_job_templates` | `trade_crm_job_templates_owner_name_idx@L1805` | `trade_crm_job_templates_owner_idx@L1804` |
| `trade_data_import_batches` | none | `trade_data_import_batches_owner_idx@L1830`, `trade_data_import_batches_status_idx@L1831` |
| `trade_data_import_rows` | `trade_data_import_rows_batch_row_idx@L1851` | `trade_data_import_rows_batch_status_idx@L1852`, `trade_data_import_rows_target_idx@L1853` |
| `trade_job_forms` | `trade_job_forms_work_template_idx@L1873` | `trade_job_forms_owner_status_idx@L1874`, `trade_job_forms_work_idx@L1875` |
| `trade_form_templates` | `trade_form_templates_key_version_idx@L1897` | `trade_form_templates_status_idx@L1898` |
| `trade_crm_job_notes` | none | `trade_crm_job_notes_owner_idx@L1911`, `trade_crm_job_notes_work_order_idx@L1912` |
| `trade_crm_time_entries` | none | `trade_crm_time_entries_owner_date_idx@L1926`, `trade_crm_time_entries_work_order_idx@L1927` |
| `trade_crm_job_media` | none | `trade_crm_job_media_owner_idx@L1949`, `trade_crm_job_media_work_order_idx@L1950`, `trade_crm_job_media_photo_request_idx@L1951` |
| `trade_crm_photo_requests` | `trade_crm_photo_requests_work_order_idx@L1977` | `trade_crm_photo_requests_owner_idx@L1978`, `trade_crm_photo_requests_expiry_idx@L1979`, `trade_crm_photo_requests_template_version_idx@L1980` |
| `trade_crm_photo_templates` | none | `trade_crm_photo_templates_owner_status_idx@L1996`, `trade_crm_photo_templates_owner_service_idx@L1997` |
| `trade_crm_photo_template_versions` | `trade_crm_photo_template_versions_template_version_idx@L2012` | `trade_crm_photo_template_versions_owner_idx@L2013` |
| `trade_crm_photo_request_events` | none | `trade_crm_photo_request_events_request_idx@L2027`, `trade_crm_photo_request_events_job_idx@L2028` |
| `trade_crm_photo_request_completions` | `trade_crm_photo_request_completions_evidence_idx@L2045`, `trade_crm_photo_request_completions_revision_idx@L2046` | `trade_crm_photo_request_completions_request_idx@L2047`, `trade_crm_photo_request_completions_job_idx@L2048` |
| `trade_crm_photo_requirement_reviews` | `trade_crm_photo_requirement_reviews_revision_idx@L2066` | `trade_crm_photo_requirement_reviews_requirement_idx@L2067`, `trade_crm_photo_requirement_reviews_job_idx@L2068` |
| `trade_crm_photo_request_deliveries` | `trade_crm_photo_request_deliveries_idempotency_idx@L2102`, `trade_crm_photo_request_deliveries_provider_message_idx@L2103` | `trade_crm_photo_request_deliveries_request_idx@L2104`, `trade_crm_photo_request_deliveries_owner_status_idx@L2105`, `trade_crm_photo_request_deliveries_customer_channel_idx@L2106` |
| `trade_crm_photo_request_delivery_events` | `trade_crm_photo_request_delivery_events_provider_idx@L2119` | `trade_crm_photo_request_delivery_events_delivery_idx@L2120` |
| `trade_crm_signoffs` | none | `trade_crm_signoffs_owner_idx@L2134`, `trade_crm_signoffs_work_order_idx@L2135` |
| `trade_crm_quick_invoices` | `trade_crm_quick_invoices_owner_job_idx@L2163`, `trade_crm_quick_invoices_number_idx@L2164` | `trade_crm_quick_invoices_owner_status_idx@L2165` |
| `trade_crm_quick_invoice_revisions` | `trade_crm_quick_invoice_revisions_invoice_revision_idx@L2182` | `trade_crm_quick_invoice_revisions_owner_idx@L2183` |
| `trade_crm_quick_invoice_credits` | `trade_crm_quick_invoice_credits_number_idx@L2201` | `trade_crm_quick_invoice_credits_invoice_idx@L2202`, `trade_crm_quick_invoice_credits_owner_idx@L2203` |
| `trade_crm_invoice_payment_allocations` | `trade_crm_invoice_payment_allocations_link_idx@L2218` | `trade_crm_invoice_payment_allocations_invoice_idx@L2219`, `trade_crm_invoice_payment_allocations_owner_idx@L2220` |
| `trade_crm_integrations` | `trade_crm_integrations_owner_provider_idx@L2238` | `trade_crm_integrations_owner_status_idx@L2239` |
| `trade_crm_oauth_states` | `trade_crm_oauth_states_hash_idx@L2252` | `trade_crm_oauth_states_owner_expiry_idx@L2253` |
| `trade_crm_payment_links` | `trade_crm_payment_links_idempotency_idx@L2282`, `trade_crm_payment_links_commercial_attempt_idx@L2283`, `trade_crm_payment_links_collectible_idx@L2284` | `trade_crm_payment_links_commercial_status_idx@L2286`, `trade_crm_payment_links_owner_idx@L2287`, `trade_crm_payment_links_work_order_idx@L2288`, `trade_crm_payment_links_provider_order_idx@L2289` |
| `trade_crm_payment_events` | `trade_crm_payment_events_provider_event_idx@L2306` | `trade_crm_payment_events_link_idx@L2307`, `trade_crm_payment_events_owner_idx@L2308` |
| `trade_crm_accounting_documents` | `trade_crm_accounting_documents_job_type_idx@L2338` | `trade_crm_accounting_documents_provider_external_idx@L2339`, `trade_crm_accounting_documents_owner_idx@L2340`, `trade_crm_accounting_documents_status_idx@L2341` |
| `trade_crm_accounting_events` | none | `trade_crm_accounting_events_document_idx@L2358`, `trade_crm_accounting_events_owner_idx@L2359` |
| `customer_accounts` | `customer_accounts_email_idx@L2382` | `customer_accounts_status_idx@L2383` |
| `customer_projects` | none | `customer_projects_owner_idx@L2415`, `customer_projects_opportunity_idx@L2416` |
| `customer_consent_receipts` | none | `customer_consent_receipts_owner_idx@L2429`, `customer_consent_receipts_project_idx@L2430` |
| `customer_project_quotes` | `customer_project_quotes_match_idx@L2455` | `customer_project_quotes_project_idx@L2456`, `customer_project_quotes_installer_idx@L2457` |
| `trade_crm_calendar_events` | `trade_crm_calendar_events_owner_appointment_provider_idx@L2474` | `trade_crm_calendar_events_owner_status_idx@L2475` |
| `customer_project_contact_releases` | `customer_project_contact_releases_match_idx@L2502` | `customer_project_contact_releases_customer_idx@L2503`, `customer_project_contact_releases_installer_idx@L2504` |
| `customer_project_contact_release_events` | none | `customer_project_contact_release_events_release_idx@L2521`, `customer_project_contact_release_events_project_idx@L2522` |
| `customer_project_evidence` | `customer_project_evidence_client_idx@L2539` | `customer_project_evidence_project_idx@L2540` |
| `customer_project_evidence_events` | none | `customer_project_evidence_events_item_idx@L2554`, `customer_project_evidence_events_project_idx@L2555` |
| `customer_project_arrival_proposals` | `customer_project_arrival_proposals_match_idx@L2581` | `customer_project_arrival_proposals_customer_idx@L2582`, `customer_project_arrival_proposals_installer_idx@L2583` |
| `customer_project_arrival_events` | none | `customer_project_arrival_events_proposal_idx@L2601`, `customer_project_arrival_events_project_idx@L2602` |
| `supplier_products` | `supplier_products_owner_model_idx@L2628` | `supplier_products_owner_idx@L2629`, `supplier_products_listing_idx@L2630`, `supplier_products_category_idx@L2631`, `supplier_products_marketplace_name_idx@L2632`, `supplier_products_marketplace_brand_idx@L2633`, `supplier_products_marketplace_model_idx@L2634`, `supplier_products_marketplace_price_idx@L2635`, `supplier_products_marketplace_lead_idx@L2636`, `supplier_products_marketplace_filter_idx@L2637` |
| `supplier_product_links` | `supplier_product_links_unique_idx@L2651` | `supplier_product_links_owner_idx@L2652`, `supplier_product_links_product_idx@L2653` |
| `installer_catalogue_preferences` | none | `installer_catalogue_preferences_updated_idx@L2674` |
| `workspace_list_views` | `workspace_list_views_owner_view_idx@L2685` | `workspace_list_views_owner_idx@L2686` |
| `installer_product_lists` | none | `installer_product_lists_owner_idx@L2700` |
| `installer_product_list_items` | `installer_product_list_items_unique_idx@L2713` | `installer_product_list_items_list_idx@L2714`, `installer_product_list_items_supplier_idx@L2715` |
| `supplier_product_enquiries` | `supplier_product_enquiries_list_supplier_idx@L2729` | `supplier_product_enquiries_supplier_idx@L2730`, `supplier_product_enquiries_installer_idx@L2731` |
| `trade_purchase_orders` | `trade_purchase_orders_number_idx@L2757`, `trade_purchase_orders_enquiry_idx@L2758` | `trade_purchase_orders_installer_idx@L2759`, `trade_purchase_orders_supplier_idx@L2760` |
| `trade_purchase_order_items` | `trade_purchase_order_items_product_idx@L2778` | `trade_purchase_order_items_order_idx@L2779` |
| `trade_purchase_order_events` | none | `trade_purchase_order_events_order_idx@L2792` |
| `trade_warranty_claims` | `trade_warranty_claims_number_idx@L2813` | `trade_warranty_claims_installer_idx@L2814`, `trade_warranty_claims_supplier_idx@L2815`, `trade_warranty_claims_order_idx@L2816` |
| `certificate_price_history` | `certificate_price_history_code_date_idx@L2827` | `certificate_price_history_date_idx@L2828` |
| `certificate_price_sync_runs` | none | `certificate_price_sync_runs_status_date_idx@L2839` |
| `api_performance_samples` | none | `api_performance_samples_route_time_idx@L2854`, `api_performance_samples_time_idx@L2855`, `api_performance_samples_duration_idx@L2856` |

Three unique indexes are partial and their predicates are security/uniqueness-relevant: `trade_work_orders_tlink_job_number_idx` applies only to `work_number GLOB 'TLJ-*'` (`db/schema.ts:375`); `trade_team_members_owner_email_idx` excludes blank email (`db/schema.ts:394`); and `trade_crm_payment_links_collectible_idx` applies only to statuses `creating/open/processing/paid` (`db/schema.ts:2284-2285`).

Historical SQL creates 406 index statements but only 398 distinct names because eight names are dropped and recreated. The current 393-name register above plus the five historical-only names below reconciles every distinct declared index identity. Statement count remains the migration-history count, not a claim about deployed physical indexes.

| Historical-only or changed index identity | SQL evidence | Disposition at current source |
|---|---|---|
| `verification_documents_object_key_unique` | `drizzle/0003_fearless_shadow_king.sql:15` | Current uniqueness is the column-level `.unique()` at `db/schema.ts:160`; generated SQL name is not a named Drizzle index declaration. |
| `trade_handover_documents_object_key_unique` | `drizzle/0016_fair_ultragirl.sql:32` | Current uniqueness is the column-level `.unique()` at `db/schema.ts:703`; generated SQL name is not a named Drizzle index declaration. |
| `trade_crm_property_views_work_order_idx`, `trade_crm_property_views_owner_idx` | `drizzle/0020_lying_stick.sql:58-59`; table drop `drizzle/0024_lethal_purifiers.sql:1` | Superseded with the dropped `trade_crm_property_views` table; not current. |
| `trade_crm_payment_links_commercial_provider_idx` | create `drizzle/0068_accepted_quote_handoff.sql:37`; drop `drizzle/0078_payment_link_attempts.sql:4` | Superseded by current attempt and active-collectible uniqueness at `db/schema.ts:2283-2285`. |
| Eight same-name drop/recreate identities | supplier marketplace five and opportunity two: `drizzle/0043_serious_layla_miller.sql:1-17`; team email: `drizzle/0070_frictionless_team_roster.sql:1-3` | Names remain current and are already listed once above; the later predicate/expression is authoritative. |

### Complete trigger register

| Trigger | Timing/event and source | Effect | Evidence |
|---|---|---|---|
| `admin_notifications_delivery_enqueue` | AFTER INSERT on `admin_notifications`, gated by action/priority and excluding backfill marker | Enqueues one webhook delivery with `INSERT OR IGNORE` | `drizzle/0014_lonely_alex_wilder.sql:20-30` |
| `tlink_product_search_insert` | AFTER INSERT on `supplier_products` | Inserts FTS product row | `drizzle/0044_flimsy_omega_flight.sql:24-27` |
| `tlink_product_search_update` | AFTER UPDATE of indexed product fields | Replaces FTS product row | `drizzle/0044_flimsy_omega_flight.sql:29-33` |
| `tlink_product_search_delete` | AFTER DELETE on `supplier_products` | Deletes FTS product row | `drizzle/0044_flimsy_omega_flight.sql:35-37` |
| `tlink_account_search_insert` | AFTER INSERT on `trade_accounts` | Inserts FTS account row | `drizzle/0044_flimsy_omega_flight.sql:44-47` |
| `tlink_account_search_update` | AFTER UPDATE of indexed account fields | Replaces FTS account row and refreshes that supplier's FTS product rows | `drizzle/0044_flimsy_omega_flight.sql:49-56` |
| `tlink_account_search_delete` | AFTER DELETE on `trade_accounts` | Deletes FTS account row | `drizzle/0044_flimsy_omega_flight.sql:58-60` |
| `tlink_customer_search_insert` | AFTER INSERT on `customer_accounts` | Inserts FTS customer row | `drizzle/0044_flimsy_omega_flight.sql:67-70` |
| `tlink_customer_search_update` | AFTER UPDATE of indexed customer fields | Replaces FTS customer row | `drizzle/0044_flimsy_omega_flight.sql:72-76` |
| `tlink_customer_search_delete` | AFTER DELETE on `customer_accounts` | Deletes FTS customer row | `drizzle/0044_flimsy_omega_flight.sql:78-80` |
| `tlink_opportunity_search_insert` | AFTER INSERT on `trade_opportunities` | Inserts FTS opportunity row | `drizzle/0044_flimsy_omega_flight.sql:87-90` |
| `tlink_opportunity_search_update` | AFTER UPDATE of indexed opportunity fields | Replaces FTS opportunity row | `drizzle/0044_flimsy_omega_flight.sql:92-96` |
| `tlink_opportunity_search_delete` | AFTER DELETE on `trade_opportunities` | Deletes FTS opportunity row | `drizzle/0044_flimsy_omega_flight.sql:98-100` |
| `tlink_crm_customer_search_insert` | AFTER INSERT on `trade_crm_customers` | Inserts owner-scoped CRM FTS row | `drizzle/0044_flimsy_omega_flight.sql:108-112` |
| `tlink_crm_customer_search_update` | AFTER UPDATE of indexed CRM-customer fields | Replaces owner-scoped CRM FTS row | `drizzle/0044_flimsy_omega_flight.sql:114-119` |
| `tlink_crm_customer_search_delete` | AFTER DELETE on `trade_crm_customers` | Deletes owner-scoped CRM FTS row | `drizzle/0044_flimsy_omega_flight.sql:121-123` |

No other `CREATE TRIGGER` declaration exists in the 79 production SQL files. Trigger enablement and successful maintenance in deployed D1 are **UNKNOWN** without production `sqlite_master` and FTS reconciliation queries.

### Individual synthetic-fixture disposition

The five tracked files under `fixtures/synthetic/migrations/` total 5,415,025 bytes. They are not part of the 79-file production migration directory. `scripts/validate-synthetic-population.mjs:4-12` builds an in-memory SQLite database, applies production SQL, then applies these five fixtures in lexical order; `package.json:17` exposes that path only as `synthetic:validate`. The ordinary migration check points Wrangler only at `drizzle` (`scripts/check-migrations.mjs:20-35`). No production fixture-load command was found.

| Fixture | Size / mutations / affected tables | Individual disposition | Production-data status |
|---|---|---|---|
| `0033_synthetic_benchmark_population.sql` | 5,403,761 bytes; 65,301 lines; 9,050 INSERT statements across `trade_accounts`, `trade_account_feature_grants`, `customer_accounts`, `customer_projects`, `customer_consent_receipts`, `trade_opportunities`, `trade_opportunity_matches`, `supplier_products`, `trade_crm_customers`, `trade_crm_job_details`, `trade_crm_appointments`, `trade_crm_job_notes`, `trade_work_orders`, `trade_work_order_tasks` and `trade_crm_counters` (`fixtures/synthetic/migrations/0033_synthetic_benchmark_population.sql:1-65301`) | Active opt-in baseline fixture generated to this path by `scripts/seed-synthetic-population.mjs:6-14`; required by the in-memory synthetic validator. The paired production migration is now a no-op `SELECT 1` placeholder (`drizzle/0033_synthetic_benchmark_population.sql:1-4`). | UNKNOWN: historical environments may have applied an earlier payload; current production rows were not queried. |
| `0035_ecosystem_flow_repair.sql` | 2,163 bytes; 60 lines; one UPDATE and one INSERT/SELECT affecting `trade_opportunities` and `trade_opportunity_matches` (`fixtures/synthetic/migrations/0035_ecosystem_flow_repair.sql:1-60`) | Active second-stage opt-in repair that normalizes synthetic opportunity references and fills eligible installer matches. Production counterpart is a no-op placeholder (`drizzle/0035_ecosystem_flow_repair.sql:1-3`). | UNKNOWN; no production query. |
| `0036_synthetic_journey_readiness.sql` | 1,531 bytes; 23 lines; four UPDATE statements affecting `trade_accounts`, `customer_accounts`, `customer_projects` and `trade_opportunities` (`fixtures/synthetic/migrations/0036_synthetic_journey_readiness.sql:1-23`) | Active third-stage opt-in normalization for synthetic account reach, canonical journey values and states. Production counterpart is a no-op placeholder (`drizzle/0036_synthetic_journey_readiness.sql:1-3`). | UNKNOWN; no production query. |
| `0037_synthetic_catalogue_readiness.sql` | 194 bytes; 4 lines; one UPDATE to `supplier_products` (`fixtures/synthetic/migrations/0037_synthetic_catalogue_readiness.sql:1-4`) | Active fourth-stage opt-in fixture that approves pending synthetic catalogue records. Production counterpart is a no-op placeholder (`drizzle/0037_synthetic_catalogue_readiness.sql:1-3`). | UNKNOWN; no production query. |
| `0038_complete_trade_purchasing_walkthrough.sql` | 7,376 bytes; 51 lines; eight mutations affecting `installer_product_lists`, `installer_product_list_items`, `supplier_product_enquiries`, `trade_purchase_orders`, `trade_purchase_order_items`, `trade_purchase_order_events`, `trade_warranty_claims` and `trade_crm_counters` (`fixtures/synthetic/migrations/0038_complete_trade_purchasing_walkthrough.sql:1-51`) | Active fifth-stage opt-in purchasing walkthrough. Production counterpart is a no-op placeholder (`drizzle/0038_complete_trade_purchasing_walkthrough.sql:1-3`). | UNKNOWN; no production query. |

Disposition conclusion: retain these files as explicitly opt-in synthetic test fixtures, not schema migrations or production seeds. Keep the no-op production identifiers because applied migration identity is historical state; do not reinsert payloads into ordinary migration replay. Before any cleanup or live-data claim, query production for the synthetic markers and establish an approved deletion/reconciliation plan.

## R2 object model

The code uses deterministic tenant/domain prefixes rather than public object URLs. Representative keys include:

| Domain | Prefix shape | Metadata authority | Limits/handling |
|---|---|---|---|
| Trade verification | `verification/{uid}/{uuid}` | `verification_documents` | PDF/image allowlist; 8 MB |
| Customer project evidence | `customer-projects/{customerUid}/{projectId}/{uuid}` | `customer_project_evidence` + events | PDF/image allowlist; 8 MB |
| Handover documents | `handovers/{ownerUid}/{packId}/{uuid}` | `trade_handover_documents` + work-order events | PDF/image allowlist; 8 MB |
| Field/job media | `crm-job-media/{ownerUid}/{workOrderId}/{uuid}` and request-nested keys | `trade_crm_job_media` and photo request ledgers | Field routes up to 8 MB; public photo flow sanitizes JPEG/PNG/WebP and bounds to about 650 KB |
| Mobile multipart media | Session-generated job/media key | `trade_mobile_upload_sessions` and `trade_mobile_upload_parts` | JPEG/PNG/WebP/PDF; total up to 50 MB; 5 MB parts |

Relevant route implementations: `src/app/api/trade-verification/documents/route.ts`, `customer-project-evidence/route.ts`, `trade-handover/documents/route.ts`, `trade-field-work/route.ts`, `job-information/[token]/route.ts`, and `trade-team/media/route.ts`.

Downloads are proxied through the Worker after authorization; no public pre-signed URL generation was found. Uploads generally write R2 first, then D1 metadata, and attempt to delete the object if the D1 write throws. Deletion often removes R2 and then D1 metadata. A Worker termination between stores can still create an orphan or missing-object record because D1 and R2 have no distributed transaction. Mobile multipart flow has explicit abort/recovery state, but no comprehensive all-prefix reconciler or orphan sweep was found.

Most upload routes validate size and client-declared MIME/type. No malware scanner or content-disarm pipeline was found. The public customer photo path re-encodes and strips metadata; other PDF/image routes do not prove server-side content sniffing or malware scanning.

R2 lifecycle, retention/lock, object inventory, independent API tokens, S3 export, replication and restore are unknown. The current Sites limitation is known: Sites does not support data or inference residency at launch, including deployed Sites, code, D1/R2 data/files, artifacts and logs (official evidence indexed in `20_EVIDENCE_INDEX_AND_COMMAND_LOG.md`; hosting interpretation in report 06). Exact physical location remains `UNKNOWN`, but it must not be described as owner-selectable Australian residency. Sites terms make the Site operator controller of Hosted Data and responsible for privacy disclosures/consents; that controller responsibility does not prove ownership or IAM access to the underlying Cloudflare infrastructure account. General R2 controls exist but current managed-resource configuration is unproved: lifecycle <https://developers.cloudflare.com/r2/buckets/object-lifecycles/>, bucket locks <https://developers.cloudflare.com/r2/buckets/bucket-locks/>, S3 compatibility <https://developers.cloudflare.com/r2/api/s3/api/>.

## Mobile local storage

`mobile/src/lib/database.ts` creates local `jobs`, `action_queue`, `upload_queue` and `settings` tables, enables WAL, obtains a key through Secure Store, and issues an encryption-key pragma. Upload files are encrypted before staging. Address data is purged after 24 hours, and revocation paths remove local records/files. Server D1 state remains authoritative; action receipts and sync cursors make offline retry idempotent.

### Complete mobile SQLite schema and index inventory

| Object | Complete declared columns / key | Purpose and authority |
|---|---|---|
| `jobs` | `id` text primary key; `work_number`; `scheduled_start`; `stage`; `protected_job`; `has_address`; `revision`; `payload`; `cached_at` (`mobile/src/lib/database.ts:31-41`) | Server-derived assigned-job snapshot/cache; not authoritative |
| `jobs_schedule_idx` | `(scheduled_start, work_number)` (`mobile/src/lib/database.ts:42`) | Device schedule ordering |
| `action_queue` | `id` text primary key; `work_order_id`; `payload`; `status`; `attempts`; `retry_after`; `error_code`; `error_message`; `created_at`; `updated_at` (`mobile/src/lib/database.ts:43-54`) | Offline mutation queue; server receipt/revision decides authority |
| `action_queue_status_idx` | `(status, created_at)` (`mobile/src/lib/database.ts:55`) | Pending/retry scan |
| `upload_queue` | `id` text primary key; `work_order_id`; `local_uri`; `file_name`; `content_type`; `size_bytes`; `category`; `caption`; `session_id`; `uploaded_parts`; `status`; `attempts`; `error_message`; `created_at`; `updated_at` (`mobile/src/lib/database.ts:56-72`) | Encrypted-file upload staging and multipart retry metadata; R2/D1 server records become authoritative after commit |
| `upload_queue_status_idx` | `(status, created_at)` (`mobile/src/lib/database.ts:73`) | Pending/retry scan |
| `settings` | `key` text primary key; `value` (`mobile/src/lib/database.ts:74-77`) | Device sync/settings values; not business-record authority |

The mobile database declares four tables, 36 columns and three indexes. It enables `foreign_keys`, but declares no local foreign-key relationship. One module-scoped `databasePromise` caches the open handle (`mobile/src/lib/database.ts:11,82-84`); this is process-local connection state, not a durable business record.

### Browser and mobile authentication persistence

The React web source uses exactly two named `localStorage` keys: `aea-admin-browser-alerts` and `aea-admin-inbox-queue`. Both are local UI preferences in `AdminNotificationInbox`; neither call site writes notification bodies, customer data or credentials. The legacy comparator additionally uses dynamic `electricity-provenance-v2:{postcode}:{customerType}` keys for TTL-bounded public plan bundles and named `aeaCompareTimes`/`aeaLeadTimes` timestamp arrays for browser-local throttling. It does not write NMI, interval readings, usage inputs, lead name or email to storage in the inspected paths, but postcode exists in the dynamic key. Retention, cross-profile behavior and clearing remain browser-controlled.

The mobile app separately configures Firebase Auth to use React Native `AsyncStorage`; the SDK's actual serialized fields were not inspected. Because authentication persistence can be security-sensitive, physical-device storage, logout, remote revocation and device-loss behavior require acceptance testing rather than an assumption that SQLite/file encryption also protects AsyncStorage.

## Archival, export, correction and deletion disposition

| Store/path | Archive/retention behavior | Export behavior | Correction behavior | Deletion/purge behavior and evidence limit |
|---|---|---|---|---|
| D1 CRM/jobs | Work orders can become `record_status='archived'` only after complete/cancel (`src/app/api/trade-work-orders/route.ts:489-506`); import rollback archives created customer/contact/site/enquiry/job records within seven days (`src/app/api/trade-imports/route.ts:379-415`) | Visible-page, selected-column CSV exists for bounded indexes/admin views; no complete owner/customer relational export exists | Ordinary active records have domain edits/revisions; exact quote/invoice/event ledgers preserve history | Hard deletion is feature-specific or absent; no global retention/legal-hold/subject-erasure orchestrator or restored-delete proof |
| D1 handover/assets | Approved handover/asset/event records are retained as history | Customer views/downloads exist; no complete portable pack export proved | Versioned correction requests preserve the prior approved value (`src/app/api/trade-handover-corrections/route.ts:51-153`) | Document metadata can be deleted with authorized R2 deletion; complete asset/ownership erasure policy unknown |
| D1 invoices/payments | Issued commercial records are immutable/status-ledgered rather than overwritten | Provider draft export and visible UI/CSV are partial downstream exports, not full ledger export | Issued invoices use bounded credits and immutable revisions (`src/app/api/trade-quick-invoices/route.ts:145-180`) | No generic invoice/payment hard delete; legal/financial retention and provider-side deletion unknown |
| D1 imported data | Import batch/results retain source/result/rollback metadata | Template/download and UI reconciliation exist; batch-wide raw portable export not proved | Changed-after-import rows block rollback rather than overwriting newer data | Seven-day guarded rollback archives imported domain records and can end `rollback_partial`; it is not a database rollback |
| Owner Database Console | No archive semantics of its own | Explicitly no export/backup | No update/correction command | Hard delete is default-deny and limited to three allowlisted tables with owner/recent-auth/confirmation/audit; report 13 recommends withdrawal |
| R2 objects + D1 metadata | No proved provider lifecycle/lock/retention configuration | Authorized per-object download exists; complete bucket inventory/export absent | Replacement/revision is domain-specific; no generic in-place editor | Verification, project evidence, handover and mobile-media routes expose owner/domain-scoped delete/abort paths; cross-store termination can orphan one side and no complete sweep exists |
| Mobile SQLite/encrypted files | Cache is retained while assignment/device policy permits; addresses are purged after 24 hours | No user export; cache must be rebuildable from server | Conflicts/rejections remain queued for user retry/discard | Sync deletion removes job/queues/files; `purgeLocalData` deletes database, DB key, encrypted directory and file key (`mobile/src/lib/database.ts:107-137,359-367`); physical-device/OS-backup proof absent |
| Browser caches/preferences | Legacy plan cache expires on read after TTL; timestamp arrays prune old entries; admin preferences persist | No export | User changes preference values; plan cache replaces by key | Cache expiry removes the accessed plan key; browser/site-data clearing is otherwise the purge. Alert preference has an explicit remove path; no central remote purge |
| Firebase Auth / mobile AsyncStorage | Provider/session retention policy unknown | User/account export not evidenced | Password reset exists; account profile correction is D1-side | App sign-out exists, but serialized persistence purge, remote revocation and account deletion were not independently tested |
| Google Sheet | Rows retain lead/reminder/delivery state; unsubscribe changes a flag, not row retention | Provider UI/API export capability was not inspected | Handlers update reminder/unsubscribe fields | No repository Sheet deletion/retention/legal-hold workflow found; live backup and owner controls unknown |
| Apps Script Script Properties | Health state and dedupe timestamps persist; code prunes notification dedupe by age | No repository export | Latest health state overwrites the prior property | No complete property purge/recovery runbook; secret rotation and live administrator access unknown |
| External providers | Provider-specific retention and immutable transaction rules apply | Provider exports are `UNKNOWN` until account evidence; TLink stores bounded IDs/status | Reconciliation/status/credit workflows exist per provider | Disconnect/revoke paths vary; provider-side erasure, dispute retention and recovery are `UNKNOWN` (report 11) |

This matrix describes implemented paths, not a legal retention schedule. No cross-store operation proves that one customer/tenant can be completely exported, corrected, held and deleted across D1, R2, browser/mobile state, Sheets/Properties, Firebase and all providers.

Important limits:

- the audit did not run a physical iOS/Android device or inspect the on-disk database, so effective database encryption is unverified;
- EAS/store release identity and production push credentials are unknown;
- the active server/mobile sync contract is v3 (`src/lib/trade-mobile-server.ts:5`); unused `SYNC_CONTRACT_VERSION = 2` in `mobile/src/lib/config.ts:4` is stale code;
- device loss, OS backup inclusion/exclusion, failed purge, interrupted upload and long-offline conflict recovery need physical-device tests.

## Sensitive-data classification

| Class | Examples | Stores | Required control gap |
|---|---|---|---|
| Identity/contact | Names, email, phone, Firebase UID | D1, limited mobile cache, Google Sheet and providers | Retention/export/offboarding and IAM/Sheet ownership unproved |
| Location/property | Addresses, postcode, access/parking/hazard notes | D1, temporary mobile cache | Cross-tenant tests and device purge verification |
| Commercial/financial | Quote/invoice lines, cents, deposit/payment status, external IDs | D1 and provider systems | Sites policy conflict; reconciliation and retention governance |
| Evidence/documents | Photos, PDFs, verification and handover artifacts | R2 + D1 metadata; mobile staging | Malware scanning, lifecycle/lock/export/orphan reconciliation |
| Credentials/tokens | OAuth access/refresh material, Firebase auth persistence and webhook/provider configuration | D1, Sites secrets/environment, mobile AsyncStorage and Apps Script Script Properties | Encryption/key rotation, logout/revocation purge, provider IAM and break-glass evidence |
| Consent/audit | Consent receipts, contact releases, events, admin logs | D1 | Legal retention, immutable export and administrator-access audit |
| Local UI/cache state | Alert-enable and queue-filter settings; postcode/customer-type plan cache; comparison/lead timestamps | Browser `localStorage` | Central clearing/expiry and shared-browser behavior; plan cache has a TTL, while named timestamp arrays are pruned on read |
| Relay/monitor state | Lead/reminder rows, unsubscribe token, health state and notification-dedupe timestamps | Google Sheet and Apps Script Script Properties | Account/IAM, retention, backup/export, deletion and recovery evidence |

No payment-card details are intentionally stored in D1/R2; payment pages are provider-hosted. The application nevertheless enables financial transactions, which conflicts with the reviewed Sites prohibited-use text.

## Backup, restore and disaster recovery

Current evidence does **not** establish a backup. Git contains schema/migrations, not production data. Sites version history contains packaged source, not a verified customer-restorable D1/R2 snapshot. No complete backup/recovery contract was found for the Google Sheet, Script Properties, Firebase Auth persistence or mobile device state; mobile caches should be safely rebuildable, while the Sheet/Properties require an explicit authority/retention/export decision.

Cloudflare D1 Time Travel can provide point-in-time recovery (30 days paid, seven days free) but requires production backend access and an in-place restore is destructive: <https://developers.cloudflare.com/d1/reference/time-travel/>. Current plan, access and bookmarks are unknown. Cloudflare also documents exporting a Time Travel state to R2 using Workflows, but no such workflow is present here.

Required recovery proof:

1. Identify the production D1 database and R2 bucket in an owner-controlled provider account.
2. Record plan, retention, regions/data-location, IAM and break-glass access.
3. Produce an encrypted independent logical D1 export; omit/rebuild FTS5 virtual tables/triggers explicitly.
4. Restore into an isolated non-production D1 instance and validate row counts, money totals, tenant boundaries, event chains and FTS search.
5. Inventory/export R2 objects through owner-controlled S3 credentials, then restore and reconcile every D1 object key/hash/size.
6. Rehearse point-in-time recovery with an agreed RPO/RTO and a no-production-impact stop condition.
7. Test a full application cutover to restored bindings and Firebase/provider configuration.
8. Schedule recurring recovery rehearsals; a backup that has never restored is unverified.

## Data risks and remediation priority

1. **Critical — no demonstrated owner-controlled recovery:** establish D1/R2 access, independent export, PITR and restore before treating the system as a CRM system of record.
2. **High — no relational foreign keys:** run orphan/integrity reports, then add constraints to new and highest-value relationships in bounded migrations.
3. **High — cross-store consistency:** create a D1/R2 inventory reconciler, safe orphan quarantine and repair ledger; do not delete unknown objects automatically.
4. **High — provider credentials in application state:** prove encryption/key rotation, least privilege, revocation and provider-account ownership.
5. **High — upload content safety:** add server-side content sniffing and malware scanning for PDFs/images; retain sanitized-photo behavior.
6. **Medium — migration metadata drift:** document ordered SQL as authority, reconcile journal/snapshots, and add CI that rejects duplicate numbers/non-replayable migrations.
7. **Medium — mobile protection:** verify on physical devices, OS backups, purge/revocation, interrupted sync/upload and long-offline conflict behavior.
8. **Medium — retention and deletion:** define legal schedules per data class and implement auditable deletion/hold behavior across D1, R2, Google Sheet/Script Properties, browser/mobile persistence and providers.

## Validation and limits

- Counted 145 Drizzle regular-table declarations and 79 SQL files at `4a5cd19`.
- Inspected migration SQL for tables, indexes, virtual tables, triggers, views, drops and foreign-key declarations; separately enumerated all four mobile SQLite tables, 36 columns and three indexes plus browser, AsyncStorage, Sheet and Script Properties use.
- `npm.cmd run db:check` passed against a fresh local Wrangler D1 instance.
- Did not read or mutate production D1/R2, Firebase users, mobile devices, Google Sheets or provider records.
- Did not perform a production export, restore, Time Travel operation, retention test or object inventory. All such operational capabilities remain unknown until provider evidence and a recovery rehearsal exist.
