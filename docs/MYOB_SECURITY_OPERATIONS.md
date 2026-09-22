# MYOB integration security operations

Issued: 22 September 2026. Owner: James, Australian Energy Assessments Pty Ltd (AEA). Operational contact: info@ausenergyassessments.com. Scope: TLink's MYOB connection, the personnel and systems supporting it, and MYOB-derived information.

This document establishes operating requirements for the integration work. It does not certify that production controls have been enabled. Production MYOB access remains prohibited while a critical acceptance item below is open. No signature, completed account review, penetration test or production exercise is implied by publication of this document.

## 1. Permitted purpose and development separation

- Process MYOB information only to deliver the customer's explicitly authorised TLink accounting functions and necessary security/support operations. Do not use it for marketing, cross-business analysis, training, product development or unrelated analytics.
- Codex, other AI development tools and TLink's AI assistant must not receive live MYOB customer, invoice, payment or financial information; derived extracts; production OAuth credentials; encryption keys; or other production secrets. This includes prompts, attachments, screenshots, database exports, console output, browser sessions and support transcripts.
- Development and automated tests use source code, public API documentation and independently created synthetic fixtures. A redacted production invoice is not a synthetic fixture. A human may describe the technical failure without copying the underlying production record or identifiers.
- Before production activation, remove AI tooling's access to production databases, secret stores, operational consoles, authenticated financial pages and production-capable credentials. Document the access removal and verify it with a negative access test. An instruction in a prompt, a hidden UI button or an application flag is not evidence that those capabilities were removed.
- Human production operators use a separate authenticated environment. They must not paste production output into an AI session. Source-only builds may be prepared with AI assistance; production secret injection and privileged operations occur through the restricted release path.
- Do not register a generic MYOB proxy or MCP tool for external agents. Adding an AI feature that processes MYOB information requires a separate review and any necessary written MYOB permission before use.

## 2. Access control and MFA

James owns the access register and production activation decision. Record each person's name, unique account, role, approved systems, reason for access, approval date, MFA evidence and last review. Store this register in restricted operational storage, not in the public website or source repository.

1. Require MFA on every production administration account and every TLink account permitted to access MYOB information. Require a verified second-factor session at the server boundary; enrolment alone does not prove that a particular session used MFA.
2. Use named accounts and least-privilege roles. Do not share passwords, recovery codes, MYOB company-file credentials or business OAuth tokens. The server's application credential identifies TLink and is not a customer login.
3. Check business membership and the authorised company-file binding for each accounting operation. A customer may only use its own connection and records. Test cross-business reads, writes and forged resource identifiers before activation.
4. Enable provider-side MFA and restrict production database, bucket, secret and deployment permissions independently of application permissions. Keep recovery methods accessible only to the authorised human owner. Do not place recovery material in this document, Git or AI tools.
5. Review access at least quarterly and before production activation. Review the previous period's privileged changes and remove permissions with no current business need. Record the outcome even when no access changes are required.
6. On departure, compromise or loss of business need, disable access immediately, revoke sessions and relevant tokens, rotate affected secrets and record completion. Remove access at the identity, hosting and deployment layers, not only in TLink.
7. Emergency access must be a named, MFA-protected human account. Record the reason, actions and end time; remove temporary privileges immediately afterwards and review the activity by the next business day. Never disable the MYOB MFA checks to resolve a support issue.

## 3. Retention, disconnection and deletion

Collect only the provider identifiers, mappings and status fields needed for the authorised function. Avoid storing raw MYOB response bodies or duplicate customer/financial datasets. This schedule separates integration caches from TLink's original business records.

| Record class | Retention requirement | Disposal and evidence |
| --- | --- | --- |
| OAuth state and one-use connection challenge | At most 10 minutes, and consumed once | Expiry enforced when read; remove used/expired entries. No secrets in URLs, logs or support notices. |
| MYOB access/refresh tokens and connection credentials | Only while that connection is authorised | Make unusable immediately on disconnect or access withdrawal; remove active stored credentials and outstanding authorisation state. Revoke provider access where supported. Record the outcome without token values. |
| Company-file selection, provider customer/invoice identifiers, account/tax mappings and cached MYOB status | While needed for an authorised connection or a specifically recorded reconciliation purpose | On disconnect stop all provider operations immediately. Delete disconnected caches/mappings within 30 days, or sooner on an approved deletion request, unless a documented reconciliation need or hold applies. No silent indefinite retention. |
| Customer-requested deletion of MYOB-derived records | Acknowledge within 2 business days; complete active-system deletion within 30 calendar days of verified authority | Inventory all affected stores, isolate any narrowly justified exception, delete eligible records, check the result and record completion. Provider backup limits are handled as below. |
| TLink-originated invoices and other business records | Retain only for a documented necessary business purpose or applicable legal obligation | Record the purpose, record class and review/deletion date. Do not claim that every record legally requires seven years. Where a documented accounting-record purpose justifies that duration, use a default maximum of seven years from issue, subject to a shorter requirement or a documented legal hold. Review retention exceptions at least annually. |
| Security/access audit events | At least 365 days after the event; longer only for an active investigation or documented hold | Use a separately protected audit store. Review expired events monthly and dispose of eligible events within 30 days after the minimum period. Keep event metadata, not invoice payloads or secrets. |
| Synthetic development fixtures | Until the test or support reproduction no longer needs them | Keep them demonstrably synthetic and remove obsolete copies. Never seed development from production MYOB exports. |

Deleting a mapping must not cause an invoice to be exported again automatically. On reconnection, require reconciliation of any affected export history before another export. Disconnection does not delete an invoice already created in the customer's MYOB company file.

Deletion procedure:

1. Verify the requester's authority through the established account process. Record a request ID, business scope and receipt time without duplicating financial content.
2. Disable affected connections and background processing. Inventory active database records, object storage, operational exports and support copies. Authentication-account deletion is separate from disconnecting MYOB.
3. Determine whether any specific record is required for an existing dispute, investigation or legal obligation. James records the reason, record scope, access restriction, review date and release condition for a hold. Apply a hold only to the necessary records, not the entire customer dataset.
4. Delete eligible active records and verify absence using the restricted human operational path. Keep only the minimum audit evidence of the request and outcome. Do not send deleted data to AI tools for verification.
5. Record backup expiry separately. Restored backups must have the deletion register reapplied before normal processing resumes. Backups must not become a new active source for deleted information.
6. Tell the requester what was removed, any limited exception and the applicable provider backup horizon. Do not describe active deletion as immediate removal from every backup.

Provider backup limitations:

- Google documents that deleted Firebase Authentication account information is removed from live and backup systems within 180 days. Logged IP addresses are retained for a few weeks. This relates to identity data, not permission to store MYOB financial information in Firebase.
- The actual retention and deletion horizons for this Sites-managed D1/R2 deployment have not been verified. Record the provider/account-specific backup settings and deletion process before production activation. Do not substitute a general product default or an invented 30-day guarantee.

## 4. Security logs and monitoring

Record successful and failed authentication/access decisions, MFA failures, connection/selection changes, export and refresh outcomes, disconnect/deletion actions, privileged configuration changes and attempted cross-business access. Each event records time in UTC, actor or process identifier, business scope where relevant, action, outcome, source and correlation ID. Use codes and identifiers sufficient for investigation; exclude tokens, keys, authorisation headers and financial/customer payloads.

Application append-only behaviour is one layer. A D1 trigger or application restriction alone must not be represented as immutable storage against a privileged database administrator. Before production, verify a separate protected audit retention destination, restricted administration and retention of at least 365 days. R2 bucket locks are one possible storage control, subject to actual access to the managed bucket and separation of lock-management permissions.

The designated human operator reviews security alerts each business day and responds immediately to suspected incidents. Alert on repeated denied accounting access, cross-business attempts, abnormal export activity, disabled monitoring, failed retention/deletion jobs and unexpected privileged changes. Verify alert delivery and investigation access with synthetic events before activation. Review dependency/security findings for each release; resolve critical affected findings before release and document other risk decisions and due dates.

## 5. Incident response

All times are recorded in UTC. James is incident coordinator and contacts MYOB at apisupport@myob.com through the established support channel. The security register must name an authorised backup contact before production activation; none is invented here.

| Severity | Examples | Response |
| --- | --- | --- |
| Critical | Suspected token/secret exposure, cross-business financial access, unauthorised export, compromised production administrator | Start containment immediately. Suspend affected integration access and engage James. Notify MYOB immediately and in all cases within 24 hours of awareness, even while scope is uncertain. |
| High | Suspected relevant account compromise, attempted exploitation with uncertain impact, missing/tampered audit evidence, unexplained provider access | Investigate and contain immediately. Treat as a suspected MYOB incident and use the same notification deadline; do not wait for proof. |
| Operational | Confirmed ordinary failure with no indication of security impact | Track and resolve through support. Escalate immediately if security impact is suspected; a low initial classification does not reset the awareness time. |

Response sequence:

1. Record discovery time, reporter, observed indicators and initial scope in restricted incident storage. Preserve original evidence and access history. Do not place payloads or secrets in email, source control or AI tools.
2. Contain using an authorised human session: suspend affected connections or operations, revoke compromised sessions/provider access, rotate affected secrets and remove inappropriate permissions. Preserve evidence before destructive remediation where doing so does not prolong active exposure.
3. Send the initial MYOB notice immediately, within 24 hours at the latest. Unknown fields are labelled unknown; investigation is not a reason to delay. Use verified existing support contact details.
4. Investigate access paths and affected businesses, preserve a timeline, test the repair in isolation and verify that credentials, monitoring and audit protection are working before restoring access.
5. Provide MYOB with material updates and the requested reasonable information. Coordinate any notice naming MYOB with MYOB beforehand unless a legal notification obligation requires otherwise. Independently assess applicable notification duties; do not invent a universal customer/regulator deadline.
6. Close only after containment, corrective action and owner review are recorded. Complete a lessons/recovery review within 5 business days of containment, assign remaining actions and retain the incident evidence under a documented hold until released.

Initial notice template:

```text
Subject: TLink MYOB integration - [suspected/confirmed] security incident [incident ID]

We became aware of this incident at [UTC date/time].
Application/operator: TLink / Australian Energy Assessments Pty Ltd.
Contact: info@ausenergyassessments.com; coordinator: James.
Summary: [brief factual description, no credentials or customer payloads].
Affected functions/business scope: [known scope or currently being assessed].
Potential data categories: [categories only; no records attached].
Containment completed: [actions and UTC times].
Current service state: [disabled/restricted/other verified state].
Evidence preserved: [restricted incident reference, not a public link].
Next update: [specific UTC time].
Please advise the secure channel for any detailed evidence you require.
```

## 6. Synthetic tabletop record

On 22 September 2026 this procedure was exercised as a source/document desk review using a fictional incident. This was not a live incident, penetration test, provider IAM check or delivered alert/notification. No production information or secrets were used and no notice was sent.

- Scenario: a synthetic account `synthetic-business-a` is reported as obtaining a result belonging to `synthetic-business-b`; no real customer identifiers appear in the exercise.
- Simulated awareness: 22 September 2026 at 09:00 UTC. Classification: Critical, suspected cross-business access.
- Simulated initial notice: 09:15 UTC that day. The 24-hour outer deadline is 23 September 2026 at 09:00 UTC; the notice must still be initiated immediately rather than held until that deadline.
- Walkthrough covered disabling affected operations through a human operator, preserving audit evidence, notifying MYOB with unknown scope labelled honestly, testing isolation before restoration and tracking corrective actions.
- Local document validation checked the synthetic notice interval (15 minutes), the calculated UTC deadline and the companion-document links. These checks passed; they do not test a production notification or provider control.
- Result: the procedure identifies a coordinator, containment sequence, notice content and escalation deadline. Open exercise dependencies are a verified backup coordinator, actual production IAM/MFA evidence, working alert delivery, protected audit retrieval and a verified restoration exercise. These remain production acceptance items.

## 7. Production acceptance record

Every item below requires evidence linked from the release/operations record and human owner review. Documentation alone does not close a technical or contractual item. Current status is open unless verified evidence is added deliberately; implementation in a working tree does not establish deployment.

| Required evidence | Current acceptance status |
| --- | --- |
| Approved initial API scope and MYOB developer access; licence terms/price confirmed before activation | OPEN: MYOB assessment pending. |
| Identity Platform capability, TOTP enrolment, verified MFA sessions and negative server-side access tests | OPEN: require configured-provider, deployed-code and user-enrolment evidence. |
| Named production operator accounts, provider MFA, least-privilege roles, recovery arrangements and backup coordinator | OPEN: account-specific evidence required. |
| Business/company-file isolation, token encryption, request-authorisation and disconnect/deletion behaviour | OPEN: record scoped automated tests and deployed verification; no live MYOB data in AI tests. |
| AI tools disconnected from production data, secrets and privileged consoles | OPEN: actual capability removal and negative access evidence required. |
| At least 365 days of protected audit retention, restricted lock administration and exercised retrieval | OPEN: append-only application/database behaviour alone is insufficient. |
| Working monitoring/alert delivery and human incident/recovery exercise | OPEN: the desk review above does not prove deployed operations. |
| Active-store deletion and verified provider backup retention/restoration handling | OPEN: Sites-managed storage evidence required. |
| Completed processor/account register, applicable agreements, actual processing locations and MYOB resolution of overseas-hosting disclosure | OPEN: see the processor register. |
| Required focused security tests, typecheck, publication build and wider release checks with failures resolved or explicitly assessed | OPEN: release evidence required. |
| Final human production acceptance | OPEN: no signature or approval is represented here. |

## Sources and companion record

- [MYOB Developer Security Requirements](https://developer.myob.com/program/security-requirements/): authentication, audit protection, overseas hosting and monitoring expectations.
- [MYOB Developer Program terms](https://www.myob.com/au/legal/sme-developer-terms): permitted purpose/retention, third-party obligations and incident requirements, particularly sections 27 to 41.
- [Firebase privacy information](https://firebase.google.com/support/privacy): authentication location and deletion horizon.
- [Cloudflare R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/): storage lock capability and administrative configuration.
- [MYOB processor register](MYOB_PROCESSOR_REGISTER.md): processing chain, contracts and unresolved account evidence.
