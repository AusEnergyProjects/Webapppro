# Authentication, security, privacy and compliance audit

Audit date: 2026-07-21 (Australia/Sydney)<br>
Repository: `C:\Webproject\aea-energy-domain-migration`<br>
Final repository snapshot: `ff3c8efe3d5e501286d8e83e28086d6d4590be27` on `codex/sites-custom-domain-migration`<br>
Application implementation snapshot: `4a5cd19dda6f86896cfc751f5a42aa07f9b4eff5`, deployed as Sites version 199<br>
Method: source, schema, migration, test and dated release-document review; no production identities, secrets, customer records or provider consoles were accessed

## Result

Authentication and authorization are materially implemented, not merely represented by client-side menus. Firebase ID tokens are verified server-side against a fixed issuer and audience, sensitive account classes are rechecked in D1, administrator roles are enforced at route boundaries, and trade/customer queries commonly scope records by the authenticated owner or assigned member. The mobile application additionally registers a device, encrypts its local work database and queued files, and purges local work after remote revocation.

The system must not be described as secure or compliant on this evidence. The web implementation is `VERIFIED DEPLOYED` as Sites v199 according to the exact release record at `docs/RELEASE_TRUTH.md:124`; deployment increases the urgency of the following high-value gaps rather than resolving them:

1. Privileged owners have no application-enforced MFA, while the deployed database console can enumerate production tables and view broad cross-tenant PII. Its 15-minute check is based only on the Firebase `auth_time` claim, not a password/MFA purpose-specific challenge.
2. Server verification validates Firebase JWT signature, issuer, audience and normal token expiry but does not perform a Firebase revoked-token check. D1 status/device checks reduce exposure on some paths; they do not prove immediate global token revocation.
3. The worker sends useful headers but no Content Security Policy. The latest header observation also recorded no CSP (`docs/RELEASE_TRUTH.md:125`).
4. Rate limiting is feature-specific rather than a general authenticated/admin abuse boundary.
5. The privacy notice describes collection, use, sharing, retention and contact rights, but no centralized retention schedule, subject-access export/deletion workflow, verified deletion job, backup-confidentiality control or Notifiable Data Breaches response plan was found.
6. Firebase persistence on mobile uses React Native `AsyncStorage`, while the field database and upload files use stronger SecureStore-backed encryption. The resulting credential-at-rest posture is `PARTIAL`.

## Status summary

| Control domain | Status | Conclusion |
|---|---|---|
| Firebase registration/login/reset/logout | `VERIFIED DEPLOYED` artifact; provider policy `UNKNOWN` | Email/password and Google flows exist in Sites v199; production Firebase settings were not inspected by this audit. |
| Server JWT verification | `VERIFIED DEPLOYED` | Signature, issuer and audience checks are in the deployed Worker; revocation remains partial. |
| Token revocation | `PARTIAL` | Account/device records can deny access on covered paths, but no Firebase revoked-token verification call was found. |
| MFA for privileged users | `UNKNOWN` at provider; `PARTIAL` in application | No application-enforced MFA enrollment, challenge or recovery workflow was found. Firebase-console policy was inaccessible. |
| Admin authorization | `VERIFIED DEPLOYED` | Owner/admin/reviewer/support roles and active/email-verified checks are server-side; owner console access was reached in signed-in v199 QA. |
| Customer/trade tenant authorization | `VERIFIED DEPLOYED` controls; assurance `PARTIAL` | Owner UID, account status and assignment boundaries are widespread and tested, but no complete route-by-route penetration test was run. |
| Mobile device controls | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` | Device headers, revocation purge, SQLCipher and encrypted upload queues exist. |
| CSRF/CORS boundary | `PARTIAL` | Bearer tokens are the primary credential and 82 of 94 routes use `sameOrigin`; that helper accepts requests with no `Origin`. |
| Injection protection | `PARTIAL` | Bound SQL and strict console identifiers were found; no DAST/fuzzing or complete taint analysis was performed. |
| Security headers | `PARTIAL` | HSTS, frame, MIME, referrer and permissions policies exist; CSP is absent. |
| Rate limiting/abuse prevention | `PARTIAL` | Public leads and selected delivery channels are bounded; no uniform auth/admin/console limiter was found. |
| Security audit logging | `PARTIAL` | Admin and workflow audit/event tables exist, but database-level immutability, log access governance and full redaction are not proven. |
| Privacy notice | `VERIFIED DEPLOYED` artifact; adequacy `PARTIAL` | A dated notice exists in Sites v199, but operational execution and legal sufficiency are not proven. |
| Retention, deletion and subject rights | `PARTIAL` | High-level promises and some mobile expiry/purge exist; no authoritative data-class schedule or end-to-end rights workflow was found. |
| Incident/NDB response | `UNKNOWN` | An API-monitor response runbook exists; no privacy breach assessment/notification plan was found. |
| Legal compliance | `UNKNOWN` | Applicability and compliance require business facts and qualified legal review not available to this audit. |

## Identity and authentication map

### Customer and trade registration

`FirebaseAccountPanel` implements customer self-registration, Google sign-in, email/password sign-in, email-verification dispatch and password reset (`src/components/FirebaseAccountPanel.tsx:39-95`). It requires an eight-character client-side minimum and presents generic failure copy (`src/components/FirebaseAccountPanel.tsx:20-29`, `54-78`). Firebase remains the password authority; no password is sent to or stored by the application server in the reviewed flow.

`DirectTradePartnerForm` provides equivalent Google/email registration and creates the business profile only after obtaining a Firebase bearer token (`src/components/DirectTradePartnerForm.tsx:96-121`, `170-215`, `244`). Team users can create or sign in with the email an employer invited; the server decides whether that identity maps to an active team record (`src/components/TradeTeamPortal.tsx:28-56`). Client copy correctly says technicians see assigned jobs only, but that statement is only trustworthy because server scoping also exists.

Status: `VERIFIED DEPLOYED` for the application flows. Provider-level controls such as password policy, email enumeration protection, bot protection, MFA and authorized OAuth domains are `UNKNOWN` because the Firebase console was not accessed.

### Login, reset, logout and refresh

- Web surfaces use Firebase SDK state listeners and `getIdToken()` before protected requests. Customer, trade, team and operations portals expose sign-out actions.
- Password-reset email is implemented for customer, trade, team, admin and mobile login surfaces (`src/components/FirebaseAccountPanel.tsx:80-95`; `mobile/src/lib/auth.ts:36-41`).
- The mobile client forces an ID-token refresh on every API request with `getIdToken(true)` (`mobile/src/lib/api.ts:18-32`). Web components generally use `getIdToken()` and rely on Firebase SDK refresh behaviour.
- Mobile sign-out removes the local field cache; settings warns about unsynced work before the destructive sign-out (`mobile/src/app/(tabs)/settings.tsx:31`).

Firebase determines ID-token expiry and refresh-token lifecycle. The repository does not redefine those lifetimes. Current provider policy, refresh-token invalidation and actual logout propagation are `UNKNOWN` without provider/runtime evidence.

### Server token verification

`requireFirebaseIdentity` requires a bearer token and verifies it against Google's Firebase JWK set with issuer `https://securetoken.google.com/australian-energy-assessments` and the matching audience (`src/lib/firebase-server.ts:3-25`). It requires a UID and email and returns email-verification, `auth_time` and sign-in-provider claims (`src/lib/firebase-server.ts:27-43`). Normal JWT temporal validation is provided by the verification library.

No call equivalent to Firebase Admin `verifyIdToken(token, true)`, token revocation timestamp lookup, or a repository-owned revoked-token list was found. This does not mean revocation is absent from Firebase; it means the application server has no proven immediate revoked-ID-token check. A stolen still-valid ID token may remain usable until expiry unless a downstream D1 account/device status check blocks that particular route. Status: `PARTIAL`.

### Invitations and recovery

- Team invitation is an application record linked to a subsequently created Firebase identity. The server maps the verified identity to the team and rejects users without active access.
- Admin invitation/claiming uses an active `admin_users` record. A pending Firebase UID can be replaced only after the verified bearer identity matches the stored email (`src/lib/admin-server.ts:33-64`).
- First-owner bootstrap is secret-backed and one-time in the reviewed admin flow. Owner recovery requires the password sign-in provider and an authentication age no older than 60 minutes (`src/app/api/admin/recovery/route.ts:12-84`).
- Admin-management logic prevents self-demotion and removal of the last owner (`src/app/api/admin/admins/route.ts:60-80`).

These are meaningful safeguards. They do not replace MFA, separation of duties or a provider-owned break-glass process. Recovery-email ownership, support escalation and the business's off-platform identity-recovery procedure remain `UNKNOWN`.

### MFA, sessions and device management

No MFA enrollment UI, TOTP/WebAuthn factor, step-up challenge or recovery-code workflow was found. The database console's reauthentication check accepts any Firebase sign-in with `auth_time` within 15 minutes and tells the user to sign out/in (`src/app/api/admin/database/route.ts:83-86`, `165-203`). It does not require password, MFA, a purpose-bound nonce or a second approver. For an owner-level destructive data capability, status is `PARTIAL` and risk is high.

No web UI was found for listing or revoking Firebase sessions/devices. The mobile field client is different: it attaches a stable device ID/platform/version to requests, and a server `DEVICE_REVOKED` or `DEVICE_REAUTHORISATION_REQUIRED` response triggers local database/file/key purge, push-token removal and Firebase sign-out (`mobile/src/lib/api.ts:24-32`; `mobile/src/lib/sync.ts:74-103`). Status: mobile `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; web session management `UNKNOWN`.

## Authorization and role model

The application has three separate human authorization namespaces: administrator roles, trade partner types and installer-team roles. The word `owner` appears in both the administrator and installer-team namespaces but does not confer privileges across them. Capability links, registered mobile devices and provider callbacks are constrained principals or gates, not additional human roles.

### Complete current principal and role matrix

| Namespace/principal | Role or gate | Current allowed scope | Explicit denial or limiting boundary | Source evidence | Status |
|---|---|---|---|---|---|
| Public | Unauthenticated visitor | Public pages and intentionally public/read-only or submission routes only | Cannot satisfy Firebase, trade-team or administrator guards; a complete public-route allowlist across all 94 route files was not generated | Bearer-token requirement in `src/lib/firebase-server.ts:17-29`; administrator guard in `src/lib/admin-server.ts:33-50` | `PARTIAL`; protected-boundary pattern verified, exhaustive public inventory `UNKNOWN` |
| Capability link | Opaque link holder | Only the object and actions encoded by an unexpired, active token; the quote link can view, ask a question, accept or decline the current issued version | No general customer, trade or administrator session; stale, revoked, expired or superseded quote links fail | `src/app/api/quote-review/[token]/route.ts:21-41,70-115` | `VERIFIED DEPLOYED` artifact; exhaustive capability-link negative testing `PARTIAL` |
| Firebase account | Household customer | Read/update the account and customer projects bound to the token UID; project creation and reads require an active customer account | No other customer's UID-scoped record and no trade/admin privilege by virtue of sign-in alone | `src/app/api/customer-account/route.ts:22-45`; `src/app/api/customer-projects/route.ts:283-310,321-330` | `VERIFIED DEPLOYED` controls; cross-tenant penetration assurance `PARTIAL` |
| Trade partner type | Installer business owner | Owner-scoped installer operations, entitled marketplace opportunities and the installer-team `owner` context | Account must be active and entitled; supplier accounts are rejected from household opportunities | `src/lib/trade-team-server.ts:37-53`; `src/app/api/trade-opportunities/route.ts:76-110` | `VERIFIED DEPLOYED` controls |
| Trade partner type | Supplier business owner | Supplier-scoped catalogue, location, enquiry and purchasing workflows | Must be an active `supplier`; no household-opportunity access | `src/app/api/supplier-products/route.ts:85-96`; `src/app/api/trade-opportunities/route.ts:93-100` | `VERIFIED DEPLOYED` controls |
| Installer team | `owner` | Full owner-scoped installer access, dispatch and team management; resolved from the installer account holder, not the persisted member label | Requires active installer account and relevant entitlement | `src/lib/trade-team-server.ts:37-53,75-80` | `VERIFIED DEPLOYED` controls |
| Installer team | `manager` | Owner-tenant operations and dispatch | Cannot manage team membership; does not receive cross-tenant access | `src/lib/trade-team-server.ts:55-80` | `VERIFIED DEPLOYED` controls |
| Installer team | `coordinator` | Owner-tenant operations and dispatch | Cannot manage team membership; does not receive cross-tenant access | `src/lib/trade-team-server.ts:55-80` | `VERIFIED DEPLOYED` controls |
| Installer team | `technician` | Field operations for jobs assigned to the member | Cannot dispatch and is denied a job whose assignee is another member | `src/lib/trade-team-server.ts:55-76,83-90` | `VERIFIED DEPLOYED` controls |
| Mobile gate | Registered active device plus installer-team role | Mobile sync only after the base team authorization, owner/actor/member binding, platform and minimum-version checks pass | Revoked, unregistered, mismatched-platform and outdated clients are rejected; device registration does not elevate the base role | `src/lib/trade-mobile-server.ts:40-84` | `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED` |
| Administrator | `owner` | All administrator reads and mutations, administrator access management, owner recovery, owner-only database console and reminder-channel configuration | Still requires verified active administrator identity; destructive console writes require recent authentication | `src/lib/admin-server.ts:4-50`; `src/app/api/admin/admins/route.ts:8-80`; `src/app/api/admin/database/route.ts:113-211`; `src/app/api/admin/service-reminder-delivery/route.ts:58-78` | `VERIFIED DEPLOYED` artifact; provider MFA `UNKNOWN` |
| Administrator | `admin` | Default administrator reads, operational mutation families and most configuration/moderation actions | Cannot manage administrator accounts, use the database console or change reminder-channel configuration | `src/lib/admin-server.ts:4-50`; complete route ledger below | `VERIFIED DEPLOYED` artifact |
| Administrator | `reviewer` | Default administrator reads plus verification, product, handover, transfer and correction decisions; notification triage and pilot participation records | Cannot change account commercial/availability settings, product listing availability, general configuration, administrator access or database rows | `src/app/api/admin/accounts/route.ts:193-223`; `src/app/api/admin/products/route.ts:121-148`; complete route ledger below | `VERIFIED DEPLOYED` artifact |
| Administrator | `support` | Default administrator reads, personal saved views, bounded notification triage and pilot session/participant work | Cannot perform account/product/handover decisions, owner/admin configuration, access management or database actions; notification assignment and case changes narrow further by action | `src/lib/admin-server.ts:4-50`; `src/app/api/admin/notifications/route.ts:202-361`; `src/app/api/admin/usability-pilot/route.ts:89-207` | `VERIFIED DEPLOYED` artifact |
| Provider callback | Signature-authenticated service event | Process only the provider-specific event after signature and replay checks | No human UI or general bearer privilege; provider configuration and production event history were not inspected | `src/app/api/service-reminder-provider-events/resend/route.ts:11-25`; `src/app/api/stripe/webhook/route.ts:336-370` | Control `IMPLEMENTED, NOT DEPLOYMENT-VERIFIED`; live-provider operation `UNKNOWN` |

### Administrator roles

The authoritative admin roles are `owner`, `admin`, `reviewer` and `support` (`src/lib/admin-server.ts:4-11`). `requireAdminIdentity` verifies the Firebase token, requires a verified email, reads the D1 admin record, rejects inactive accounts and enforces the route's allowed-role list (`src/lib/admin-server.ts:33-71`). The owner-only database console calls `requireAdminIdentity(request, ["owner"])` on GET, POST and DELETE (`src/app/api/admin/database/route.ts:113-116`, `165-169`, `188-192`). This is server-side authorization; the matching owner-only tab visibility is not the primary control.

Reviewer restrictions are narrower in source: reviewers can decide evidence status but cannot change product listing availability (`src/app/api/admin/products/route.ts:137`), and account mutation rejects reviewer changes outside review fields (`src/app/api/admin/accounts/route.ts:216-223`). The manually reconciled route/action ledger below is complete for the current 27-route `/api/admin` namespace and the one conditional administrator path outside it. It is not generated or enforced from a central policy manifest, so future route drift remains a `PARTIAL` least-privilege control.

#### Complete administrator action and surface ledger

The current operations UI exposes 17 named tabs. Inbox, overview, all accounts, jobs, customers, partners, leads, products, product enquiries, handovers, asset safety, asset governance, field forms, referrals and field pilot are rendered for every active administrator role. Database and access/audit are rendered only for `owner`; performance and service-follow-up panels are rendered only for `owner` and `admin` (`src/components/AdminOperationsPortal.tsx:697-804,823-867,970-971,1038-1108`). UI visibility is convenience only; the server guards below are authoritative.

At the audited snapshot, `src/app/api/admin/**/route.ts` contains 27 route files and 53 exported operations: 24 `GET`, 11 `POST`, 16 `PATCH` and 2 `DELETE`. Every operation appears exactly once below. Role abbreviations are `O` owner, `A` admin, `R` reviewer and `S` support. `All` means all four active, email-verified administrator roles after `requireAdminIdentity`; it never means public access.

| Administrator surface | Complete methods/actions in current route | Effective server permission | Exact source evidence | Status / explicit unknown |
|---|---|---|---|---|
| Accounts, `/api/admin/accounts` | `GET` account lists/details; `PATCH` account, verification, availability, plan/billing, feature-grant and internal-note fields | `GET`: All. `PATCH`: O/A full; R verification status and notes only; S denied | `src/app/api/admin/accounts/route.ts:86-196,203-255` | `VERIFIED DEPLOYED`; no live negative-role exercise |
| Administrator access, `/api/admin/admins` | `GET` access register; `POST` invite; `PATCH` role/status, with final-owner/self-protection | O only for all three operations | `src/app/api/admin/admins/route.ts:8-80` | `VERIFIED DEPLOYED`; Firebase-console policy `UNKNOWN` |
| Asset safety, `/api/admin/asset-safety` | `GET` notices; `POST` draft/publish notice; `PATCH` publish/withdraw | `GET`: All. `POST/PATCH`: O/A | `src/app/api/admin/asset-safety/route.ts:68-121` | `VERIFIED DEPLOYED` artifact |
| Asset transfers, `/api/admin/asset-transfers` | `GET` transfer queue; `PATCH` approve/reject dual-consent ownership transfer | `GET`: All. `PATCH`: O/A/R | `src/app/api/admin/asset-transfers/route.ts:60-78,82-140` | `VERIFIED DEPLOYED` artifact |
| Database console, `/api/admin/database` | `GET` catalog/schema/page; `POST` allowlisted row insert; `DELETE` allowlisted row hard-delete | O only; mutation also requires recent owner authentication | `src/app/api/admin/database/route.ts:113-211` | `VERIFIED DEPLOYED`; production mutation was not exercised by this audit |
| Account directory, `/api/admin/directory` | `GET` cross-account/customer detail and audited private-customer view; `PATCH` customer support record, note and project/account status consequences | `GET`: All. `PATCH`: O/A | `src/app/api/admin/directory/route.ts:65-103,285-340` | `VERIFIED DEPLOYED` artifact; broad read exposure remains a privacy risk |
| Ecosystem health, `/api/admin/ecosystem-health` | `GET` read-only cross-role walkthrough/health | All | `src/app/api/admin/ecosystem-health/route.ts:17-23` | `VERIFIED DEPLOYED` artifact; live provider health is bounded |
| Verification evidence, `/api/admin/evidence` | `GET` protected verification-document download with audit event | O/A/R; S denied | `src/app/api/admin/evidence/route.ts:15-30` | `VERIFIED DEPLOYED` artifact; malware/content controls `PARTIAL` |
| Field-form governance, `/api/admin/form-templates` | `GET` templates; `POST` create draft or publish; `PATCH` publish/withdraw | `GET`: All. `POST/PATCH`: O/A | `src/app/api/admin/form-templates/route.ts:62-113` | `VERIFIED DEPLOYED` artifact |
| Handover corrections, `/api/admin/handover-corrections` | `GET` submitted correction queue; `PATCH` approve/reject and apply allowlisted asset field correction | `GET`: All. `PATCH`: O/A/R | `src/app/api/admin/handover-corrections/route.ts:44-55,79-120` | `VERIFIED DEPLOYED` artifact |
| Handover review, `/api/admin/handovers` | `GET` handover queue/detail; `PATCH` approve/publish, request changes or reject | `GET`: All. `PATCH`: O/A/R | `src/app/api/admin/handovers/route.ts:14-18,96-150` | `VERIFIED DEPLOYED` artifact |
| Job directory, `/api/admin/jobs` | `GET` cross-business job search/list | All | `src/app/api/admin/jobs/route.ts:6-30` | `VERIFIED DEPLOYED` artifact; broad read exposure remains subject to role-purpose review |
| Personal list views, `/api/admin/list-views` | `GET`, `PATCH` and `DELETE` the caller's saved admin list preferences | All, always scoped by `admin.uid` and `owner_scope = admin` | `src/app/api/admin/list-views/route.ts:10-43` | `VERIFIED DEPLOYED` artifact |
| Admin lookups, `/api/admin/lookups` | `GET` bounded installer, opportunity, customer or product selector data | All | `src/app/api/admin/lookups/route.ts:10-52` | `VERIFIED DEPLOYED` artifact; field-level least privilege not independently approved |
| Operations inbox, `/api/admin/notifications` | `GET` inbox/health. `PATCH`: mark one/all read, add note, assign, set due, set priority, resolve, reopen, send test, retry delivery | All may read, mark read, add note and self-assign. O/A may assign anyone, send/retry off-screen delivery and reopen. O/A/R may set due/priority and resolve. S cannot do those elevated actions | `src/app/api/admin/notifications/route.ts:85-205,215-361` | `VERIFIED DEPLOYED` artifact; no centralized policy declaration |
| Automatic opportunity allocation, `/api/admin/opportunities/allocate` | `POST` run bounded allocation for one opportunity | O/A | `src/app/api/admin/opportunities/allocate/route.ts:6-20` | `VERIFIED DEPLOYED` artifact |
| Opportunity matches, `/api/admin/opportunities/matches` | `POST` manually create/update eligible installer match; `PATCH` change match workflow status | O/A | `src/app/api/admin/opportunities/matches/route.ts:29-37,61-120,160-193,202-210,254-280` | `VERIFIED DEPLOYED` artifact |
| Opportunities, `/api/admin/opportunities` | `GET` list/detail; `POST` create; `PATCH` change status and close linked matches | `GET`: All. `POST/PATCH`: O/A | `src/app/api/admin/opportunities/route.ts:50-53,128-185` | `VERIFIED DEPLOYED` artifact |
| Performance, `/api/admin/performance` | `GET` seven-day sampled route performance, SLO calculation and query-plan checks | O/A | `src/app/api/admin/performance/route.ts:19-56` | `VERIFIED DEPLOYED` artifact; sample completeness `PARTIAL` |
| Product enquiries, `/api/admin/product-enquiries` | `GET` cross-party product-enquiry list and commercial summary | All | `src/app/api/admin/product-enquiries/route.ts:12-67` | `VERIFIED DEPLOYED` artifact; no admin mutation exists on this route |
| Product moderation, `/api/admin/products` | `GET` products; `PATCH` review status/note and optional listing status | `GET`: All. `PATCH`: O/A full; R review evidence only and cannot change listing; S denied | `src/app/api/admin/products/route.ts:39-42,121-150` | `VERIFIED DEPLOYED` artifact |
| Owner recovery, `/api/admin/recovery` | `POST` reconnect the UID on an existing active owner record | Special gate: verified Firebase email, password sign-in, authentication within 60 minutes and matching active owner email; no pre-existing admin session required | `src/app/api/admin/recovery/route.ts:14-68` | `VERIFIED DEPLOYED` artifact; provider account-recovery/MFA policy `UNKNOWN` |
| Referrals, `/api/admin/referrals` | `GET` referral ledger; `PATCH` approve, reject or retry reward | `GET`: All. `PATCH`: O/A | `src/app/api/admin/referrals/route.ts:14-18,54-98` | `VERIFIED DEPLOYED` artifact |
| Service follow-up reporting, `/api/admin/service-follow-up-reporting` | `GET` privacy-bounded operational reporting | O/A | `src/app/api/admin/service-follow-up-reporting/route.ts:11-16` | `VERIFIED DEPLOYED` artifact; live data population not inspected |
| Reminder delivery administration, `/api/admin/service-reminder-delivery` | `GET` channel/delivery health; `PATCH` enable/configure channel; `POST` retry appointment or photo-request delivery | `GET/POST`: O/A. `PATCH`: O only | `src/app/api/admin/service-reminder-delivery/route.ts:52-96` | `VERIFIED DEPLOYED` artifact; live sender/provider state `UNKNOWN` |
| Operations session/bootstrap, `/api/admin/session` | `GET` session, metrics and audit summary; `POST` create the first owner once | `GET`: All. `POST`: special gate requiring verified Firebase email, configured bootstrap token and an empty `admin_users` table | `src/app/api/admin/session/route.ts:19-89,91-136` | `VERIFIED DEPLOYED` artifact; custody/rotation of bootstrap token `UNKNOWN` |
| Field usability pilot, `/api/admin/usability-pilot` | `GET` pilot data; `POST` add participant or log session; `PATCH` update pilot or participant | `GET`: All. O/A may add participants and update pilot schedule/status. All may log sessions and update participants | `src/app/api/admin/usability-pilot/route.ts:89-168,172-207` | `VERIFIED DEPLOYED` artifact; support's broad participant-update scope requires owner review |

One administrator action sits outside `/api/admin`: `GET /api/trade-handover/documents` conditionally permits any administrator role to download a protected handover document only when the caller is neither its installer owner nor an entitled customer, and writes an administrator audit event (`src/app/api/trade-handover/documents/route.ts:71-107`). This conditional operation is not included in the 53-operation namespace count.

Source enumeration is complete for this snapshot; its status as an enduring control is `PARTIAL`. No central route-policy manifest or CI comparison prevents a new route/action from bypassing this ledger, no live negative-role test was run, and default-read access still gives all four administrator roles broad customer, job, opportunity, product and operational data. Whether each broad read is necessary for reviewer/support duties is `UNKNOWN` pending an accountable role-purpose review.

### Trade and team roles

Trade account ownership is anchored to Firebase UID and account status. Installer and supplier partner types receive different feature entitlements. Team roles are `owner`, `manager`, `coordinator` and `technician` (`src/lib/trade-team-server.ts:5`). Owners, managers and coordinators can dispatch; technicians are denied jobs not assigned to their member ID (`src/lib/trade-team-server.ts:76-88`). Sync responses similarly reduce a technician's audience (`src/app/api/trade-team/sync/route.ts:182-213`).

This server-side pattern is `VERIFIED DEPLOYED`, but its assurance remains `PARTIAL` because no live cross-tenant/role penetration test was performed.

### Household, token and object scope

Household account routes generally require a verified Firebase identity and join customer records to that UID/email. Trade CRM and list routes commonly include `firebase_uid = ?` in SQL. Token routes use opaque job/quote link records rather than customer login. Existing contract tests assert many of these boundaries.

This audit did not prove every one of 94 route handlers against horizontal object access, stale invitation, reassignment, token replay and mixed owner/team cases. Broken object-level authorization is therefore not declared absent. Status: `PARTIAL` overall, despite good repeated patterns.

## Secrets, service identities and logging

The tracked secret-file scan found only `.env.example` and `mobile/.env.example`; no tracked `.env`, private key, service-account JSON, `google-services.json` or iOS Firebase plist was found. This is positive repository evidence, not proof that Git history, build artifacts, provider logs or external systems contain no credentials.

Runtime integrations depend on Sites environment values and provider credentials. The app can use D1/R2 bindings, but a binding does not prove the business independently owns or can export the resource. Credential owner, rotation date, scope, break-glass access and service-account inventory are `UNKNOWN` unless separately verified in provider consoles.

Admin operations write structured records to `admin_audit_log` via a shared statement helper (`src/lib/admin-server.ts:74-106`). Numerous domain workflows have append-only event/revision tables. However:

- no database trigger or provider policy was found that makes the admin audit table immutable outside application code;
- the new database console makes that table browse-only but does not prevent provider-level mutation;
- `adminError` returns generic client copy but writes the raw error object to server logs (`src/lib/admin-server.ts:22-30`);
- route-performance telemetry also logs a raw error object if persistence fails (`src/lib/route-performance.ts:41-49`).

Client disclosure is bounded, but sensitive-log redaction across all runtime errors and provider logs is `PARTIAL`.

## Security threat review

### Control-by-control assessment

| Threat/control | Status | Evidence and residual risk |
|---|---|---|
| Privilege escalation | `PARTIAL` | Admin role and active-state checks are server-side; team roles are server-scoped. No MFA and an owner database console make a single privileged identity disproportionately valuable. |
| Broken object-level authorization | `PARTIAL` | Owner/UID/assignment predicates are widespread and tested. A full negative test matrix across 94 routes, tokens and historical reassignment was not run. |
| SQL injection | `PARTIAL` | Ordinary routes overwhelmingly bind values. The console rejects non-catalog identifiers and binds row values, so it does not expose arbitrary SQL. No complete taint analysis or fuzzing was performed. |
| Command injection | `UNKNOWN` | No runtime shell-command surface was identified in reviewed request handlers; build/maintenance scripts are outside an untrusted web request boundary. A repository-wide DAST result is absent. |
| XSS | `PARTIAL` | React escaping is the dominant rendering path and the source scan found no `dangerouslySetInnerHTML`/`eval` use in active source. CSP is absent, so any future or dependency injection has little browser containment. |
| CSRF | `PARTIAL` | Protected APIs use bearer headers rather than ambient app cookies, and 82/94 handlers reference `sameOrigin`. `sameOrigin` accepts a missing `Origin` (`src/lib/admin-server.ts:13-16`); this is a defence-in-depth check, not a strong standalone CSRF token. |
| CORS | `PARTIAL` | No broad allow-all CORS policy was found in the worker. Provider callbacks/public reads intentionally differ. Deployed edge overrides were not inspected. |
| SSRF | `UNKNOWN` | Several server integrations call configured/provider URLs. No exhaustive destination allowlist and redirect analysis was completed in this workstream. |
| Open redirect | `UNKNOWN` | The canonical host redirect is fixed and HTTPS (`worker/index.ts:28-35`). OAuth return-state and every user-controlled redirect were not exhaustively tested. |
| Path traversal | `UNKNOWN` | Object access uses application-generated keys in reviewed flows; no fuzzing of storage/download paths was run. |
| Unsafe deserialization | `PARTIAL` | JSON bodies are parsed and many actions validate enumerations/shape, but validation is route-local rather than one universal schema layer. |
| File-upload abuse | `PARTIAL` | Job/evidence workflows impose authorization and bounded storage logic in active source; malware scanning, content disarm and production object lifecycle are not proven here. |
| Webhook spoof/replay | `PARTIAL` | Provider-specific signature/event-ledger logic and tests exist, but production secrets, replay history and provider configuration were not accessed. |
| Credential exposure | `PARTIAL` | No real credential file is tracked and protected console columns are redacted by name. Runtime secret ownership, logs, history and provider access remain unverified. |
| Unsafe maintenance/seed command | `BROKEN` | A no-argument synthetic seeder uses the application's Firebase client project, attempts 350 identity mutations, writes plaintext password files and can overwrite the tracked fixture. It has no environment/project/emulator guard, dry run or confirmation (`scripts/seed-synthetic-population.mjs:8-14,57-105,300-321`). Provider acceptance/prior execution are `UNKNOWN`. |
| Dependency/supply chain | `PARTIAL` | Versions are lockfile-controlled and lint/type/tests pass. No dependency-vulnerability, license, provenance or SBOM gate was run/found. |
| Rate limiting | `PARTIAL` | `/api/leads` uses a durable fail-closed limiter (`src/app/api/leads/route.js:108-123`); photo/service delivery has daily limits. No console/admin/global authenticated limiter was found. |
| Encryption in transit | `PARTIAL` | Worker emits HSTS on HTTPS (`worker/index.ts:12-25`) and release notes observed HTTPS/HSTS. Internal provider TLS and every callback endpoint were not independently verified. |
| Encryption at rest | `PARTIAL` | Mobile SQLCipher and AES file queues use SecureStore-held keys. D1/R2/provider encryption and key ownership are provider facts not proven by source. |
| Security headers | `PARTIAL` | Permissions, referrer, MIME, frame and HSTS headers are set; CSP is missing (`worker/index.ts:12-25`; `docs/RELEASE_TRUTH.md:125`). |
| Backup confidentiality | `UNKNOWN` | No independently controlled backup set, encryption-key ownership record or restore exercise was found. |

The nine route handlers without a `sameOrigin` reference are public reads/health or provider-facing callbacks/webhooks: certificate prices, direct-trade billing, gas plans, health, Resend events, Twilio events, Square webhook, Stripe webhook and an integration callback. Three JavaScript handlers—electricity plans, the internal lead probe and public leads—form a separate source set; the public lead mutation has its own limiter and validation. Absence of `sameOrigin` on a webhook is not itself a defect when signature verification is authoritative.

### Highest-value attack paths

#### 1. Compromise one owner Firebase identity

Risk: critical. The account can reach administrator operations and, in deployed v199, browse broad tables and hard-delete rows from three allowlisted tables. MFA is not application-enforced; the console's step-up is only recent `auth_time`. Name-based redaction still reveals emails, phone numbers, addresses and free text. No dedicated NMI schema field was found; the comparator states that NMI stays in the browser. This concentrates confidentiality and integrity risk in one identity.

Required immediate containment for the current console deployment: withdraw generic mutation/browsing, mandate phishing-resistant MFA for owners, add purpose-specific step-up, reason/ticket capture, rate limits and alerts, and replace the feature with read-only explicit projections plus named domain repair commands. The console-specific decision is in `13_DATABASE_CONSOLE_SECURITY_REVIEW.md`.

#### 2. Use a stolen but not-yet-expired Firebase ID token

Risk: high. JWT verification proves authenticity and expiry but has no proven server-side revocation check. An attacker with an owner/trade/customer token can act until normal expiry unless a covered D1 status/device boundary stops it.

Required control: define a risk-based revocation strategy. At minimum, privileged and destructive endpoints should check a server-owned session/revocation version or provider revocation state, require recent MFA-backed authentication and bind audit events to session/device context.

#### 3. Browser code execution without CSP containment

Risk: high. React reduces ordinary HTML injection, but a compromised third-party script/dependency or future unsafe sink could act with the signed-in user's Firebase session. No CSP was observed live.

Required control: deploy a strict nonce/hash-based CSP in report-only mode first, inventory Firebase/Google and required asset origins, remove unnecessary third-party script dependencies, then enforce it with violation monitoring. Add Trusted Types where browser/support constraints permit.

#### 4. Cross-tenant disclosure through future database schema growth

Risk: high because the console is deployed. The table policy defaults every syntactically valid application table to visible/read-only, and column redaction is based on names. A new table or innocently named sensitive column becomes owner-browsable without an explicit security review (`src/lib/admin-database-console.ts:131-159`).

Required control: deny by default. Use explicit table and column projections, semantic diagnostic views, irreversible masking, row-purpose boundaries and tests that fail when a new schema object is not classified.

#### 5. Mobile local credential compromise

Risk: medium/high depending on device threat model. Work data and upload files have strong app-level encryption, but Firebase React Native persistence uses `AsyncStorage` (`mobile/src/lib/auth.ts:18-23`). Android backup is disabled (`mobile/app.json:20-30`), but local compromise/jailbreak and iOS backup behaviour were not assessed.

Required control: document Firebase's exact native persistence contents and platform protection, prefer platform-secure credential persistence where supported, enforce device revocation and app attestation for field roles, and test sign-out/revocation purge on real devices.

#### 6. Abuse authenticated or operational endpoints

Risk: medium. Public lead submission fails closed behind a durable limiter, but broad admin/console and many authenticated mutation routes have no common rate/velocity policy. A compromised account can enumerate, scrape or repeatedly mutate within its authorization.

Required control: per-identity, per-device and per-action limits; burst plus sustained quotas; alerting on owner/admin anomalies; idempotency for retryable writes; and explicit lockout/recovery procedures that do not enable denial of service against legitimate operators.

#### 7. Run the synthetic identity generator against the application Firebase project

Risk: high. Source possession and ordinary network access are enough to invoke `node scripts/seed-synthetic-population.mjs` with no arguments. Its default path uses the app client project, attempts sign-up/sign-in/profile updates for 350 fixed synthetic emails, retries selected provider failures and writes plaintext passwords plus SQL output. An interrupted run can leave partial external identities; a completed rerun is not idempotent because it generates new passwords for the same emails. The public Firebase client key is not treated as a secret here; the defect is the absent target/safety boundary.

Required control: remove direct production-project defaults. Require a non-production project or local emulator identifier distinct from every production config, explicit `--confirm` target text, dry-run default, bounded count, HTTPS/host/secret validation for broker mode, non-repository output enforcement and an auditable cleanup/reconciliation command. Until then, routine execution is `BLOCKED`; provider account history must be checked read-only before claiming no prior impact.

## Mobile security review

The mobile field app has several strong controls:

- SQLCipher is enabled in Expo configuration, and a random database key is kept in SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`mobile/app.json:46-57`; `mobile/src/lib/database.ts:13-30`).
- Upload files are AES-encrypted in bounded parts with a SecureStore key, and the original picker file is deleted when possible (`mobile/src/lib/encrypted-files.ts:10-40`).
- Database, keys and encrypted files can be purged together (`mobile/src/lib/database.ts:359-366`; `mobile/src/lib/encrypted-files.ts:59-70`).
- API calls force a fresh Firebase ID token and send device/version context (`mobile/src/lib/api.ts:18-32`).
- Server device revocation causes local purge and sign-out (`mobile/src/lib/sync.ts:74-103`).
- Android backup is disabled (`mobile/app.json:20-30`).

Unverified or partial controls:

- Firebase session persistence uses `AsyncStorage`, not the app's SecureStore boundary (`mobile/src/lib/auth.ts:18-23`).
- App attestation, jailbreak/root detection, screenshot protection, clipboard controls, TLS pinning, biometric gate enforcement and remote-wipe delivery latency were not found/proven.
- SQLCipher/AES behaviour was type-checked but not tested on built iOS/Android binaries.
- Store signing identities, Firebase mobile files and push credentials are unavailable according to the release record (`docs/RELEASE_TRUTH.md:126`).

Overall mobile security status: `PARTIAL`.

## Privacy and data-protection review

### Data classes present

The schema holds extensive personal and commercially sensitive data. Representative fields include:

- trade profile email, phone and address (`db/schema.ts:6-14`);
- verification evidence object keys (`db/schema.ts:157-160`);
- administrator and team-member emails (`db/schema.ts:172`, `384`);
- CRM customer contacts, mobile/email, service addresses and site instructions (`db/schema.ts:1151-1191`, `1258-1280`);
- encrypted provider credentials (`db/schema.ts:2230`);
- customer email, phone and address (`db/schema.ts:2364-2371`);
- contact-release records and protected object keys (`db/schema.ts:2490-2495`, `2534`).

Depending on user input, free-text job, access, hazard, support and evidence fields may also contain sensitive information even if their column names are not intrinsically sensitive. The database console's name-based redaction does not protect those fields.

### Notice and purpose limitation

The privacy page says what data may be collected, how it is used, the protected-lead boundary, connected-provider choices, file/meter handling, retention principles and how to seek access/correction (`src/app/privacy/page.tsx:12-44`). It explicitly warns against emailing passwords, card data, identity documents or provider tokens (`src/app/privacy/page.tsx:90-97`). Status: `VERIFIED DEPLOYED` for the notice artifact; operational adequacy remains `PARTIAL`.

Operational adequacy is `PARTIAL`. The audit did not find a single data inventory tying every schema field, R2 object, provider copy, log and backup to purpose, legal basis/requirement, retention period, deletion method, owner and subject-right response. A broad notice cannot substitute for those controls.

### Retention, access, correction and deletion

The notice promises retention only while needed and provides a contact for access/correction (`src/app/privacy/page.tsx:38-43`). Mobile code purges revoked-device data and expires cached addresses. Those are useful controls.

No centralized retention schedule, scheduled production deletion/de-identification process, customer data export, verified subject-access workflow, verified account deletion workflow, legal-hold process or cross-provider erasure orchestration was found. Deleting a row in an application console is not a compliant deletion process because related events, files, provider copies and backups may remain. Status: `PARTIAL`.

### Breach and incident handling

`OPERATIONS_RUNBOOK.md` covers API monitoring, alerts and service incident checks. It is not a privacy breach response plan. No documented process was found for containment, evidence preservation, harm assessment, legal escalation, affected-individual/regulator notification, communications or post-incident review. Status: `UNKNOWN`.

## Australian compliance context

This section identifies obligations to assess; it is not legal advice or a certification.

| Topic | Authoritative source | Audit implication | Status |
|---|---|---|---|
| Privacy Act applicability | [OAIC small business guidance](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business) | Turnover, health/service, trading-in-information, contractor and related-entity facts are needed. The repository cannot establish whether an exemption applies. | `UNKNOWN` |
| Australian Privacy Principles | [OAIC APP overview](https://www.oaic.gov.au/privacy/australian-privacy-principles/read-the-australian-privacy-principles) | If covered, collection, use/disclosure, security, access/correction and cross-border controls require operational evidence, not only a notice. | `PARTIAL` |
| Collection notification | [OAIC APP 5 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-5-app-5-notification-of-the-collection-of-personal-information) | The privacy page is useful; just-in-time notices, provider/cross-border detail and each collection context were not reconciled. | `PARTIAL` |
| Security and destruction/de-identification | [OAIC APP 11 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information) | No complete retention/deletion schedule, backup disposal evidence or last restore/confidentiality test was found. | `PARTIAL` |
| Correction | [OAIC APP 13 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-13-app-13-correction-of-personal-information) | A contact method is published; request intake, identity proof, decision timing, downstream correction and audit evidence are unproven. | `PARTIAL` |
| Notifiable Data Breaches | [OAIC data breach preparation and response](https://www.oaic.gov.au/privacy/notifiable-data-breaches/preventing-preparing-for-and-responding-to-data-breaches/data-breach-preparation-and-response) | No NDB assessment/notification plan was found. Business applicability and procedures need qualified review. | `UNKNOWN` |
| Commercial electronic messages | [ACMA spam compliance guidance](https://www.acma.gov.au/avoid-sending-spam) | Email/SMS delivery code and unsubscribe tokens exist elsewhere, but consent records, sender identification, unsubscribe timing and all campaigns were not audited end-to-end. | `PARTIAL` |
| Marketing and product claims | [ACCC false or misleading claims guidance](https://www.accc.gov.au/business/advertising-and-promotions/false-or-misleading-claims) | Energy savings, independence, privacy and free-service claims require dated substantiation and change control. This audit does not certify them. | `UNKNOWN` |
| Digital accessibility | [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Semantic implementation exists, but a broken skip link, inconsistent modal focus and no conformance test prevent an accessibility claim. | `PARTIAL` |

The entity's turnover, corporate relationships, contracts, jurisdictions, employee count, government tenders, data-broker activity, health-information handling and professional legal advice were not available. Missing facts remain `UNKNOWN`; they are not evidence of exemption.

## Required remediation sequence

1. **Withdraw the deployed database console.** Abandon generic mutation and replace broad browsing with read-only allowlisted diagnostics plus named domain repair commands. See `13_DATABASE_CONSOLE_SECURITY_REVIEW.md`.
2. **Require phishing-resistant MFA and real step-up for owner/admin destructive actions.** Record session/device, reason/ticket and alert context; define break-glass recovery outside a single mailbox.
3. **Add privileged-session revocation.** Use provider revocation or a server-owned session version for owner/admin and high-risk routes; test stolen-token, suspension and recovery cases.
4. **Deploy CSP safely.** Start with report-only, inventory required origins, remove violations, then enforce a strict policy with monitoring.
5. **Create an explicit authorization matrix and negative integration suite.** Cover every role, tenant, object, token state and reassignment boundary across the 94 routes.
6. **Centralize abuse controls.** Apply identity/device/action quotas and anomaly alerts to owner/admin, token and high-cost provider operations while preserving public-lead fail-closed behaviour.
7. **Establish privacy operations.** Approve a data inventory and retention schedule; implement verified access/correction/deletion workflows across D1, R2, logs, integrations and backups; document legal holds.
8. **Create and exercise a breach-response plan.** Include NDB assessment, contacts, evidence, communication templates and tabletop testing.
9. **Harden mobile identity storage and release controls.** Verify native persistence, adopt secure storage/app attestation where supported, and test purge/revocation on release-signed devices.
10. **Add continuous security assurance.** Dependency/SBOM/secret scanning, CSP regression, authz tests, safe DAST against non-production, log-redaction tests and periodic provider-access review should become release gates.

## Validation limits

The application source passed full tests, lint, root and mobile TypeScript and fresh local migration replay in this audit; a concurrent release task additionally recorded full validation, production build and signed-in read-only Sites v199 QA. This workstream did not access the production login, Firebase console, Cloudflare/Sites control plane, D1/R2 data, webhook delivery, email/SMS inbox, payment account, secret value, vulnerability scanner, browser DAST or mobile binary. No conclusion in this document should be read as a penetration-test result, provider-ownership confirmation, legal opinion or compliance certification.
