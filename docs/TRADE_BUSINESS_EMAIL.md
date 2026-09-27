# Business email connections

Implementation branch: `codex/trade-outgoing-email`, based on `455c98938962024d319fab128313175bdb1a18c5`.

This feature is implemented locally. Google and Microsoft provider registration have started; provider approval, deployment and real mailbox acceptance checks are still outstanding. Do not enable a provider merely because its buttons or mocked tests work.

### Google activation progress, 27 September 2026

The owner approved creating the dedicated Google email client and configuring send-only permission. The Gmail API is enabled in `australian-energy-assessments`. The `TLink Business Email` Web application client has the exact production callback below. Its dedicated client ID and secret are saved in Sites runtime revision 139, with the secret protected and `GOOGLE_EMAIL_ENABLED=false`. The existing encryption key and existing OAuth client were preserved. The downloaded credential file was removed after secure storage. The consent configuration now lists only `openid`, email identity and `gmail.send`, with a sending justification, the public TLink homepage, privacy URL and existing support address. Branding verification must precede sensitive-scope verification; neither has been submitted or approved.

This is configuration preparation, not an activated connection or live release. Google branding and sensitive-scope verification, the public privacy disclosure, the application release and real mailbox acceptance checks must all be completed before broad onboarding.

The owner also approved Microsoft registration, Platform Policies and dedicated credentials with delegated identity and send-only permission. `TLink Business Email` is registered for organisational and personal Microsoft accounts with the exact callback below. The Microsoft console reports that publisher verification is required for ordinary end-user consent to the new multitenant app; registration alone is not readiness.

## Business setup

The business owner opens the existing **Business settings → Account → Outgoing email** setting, chooses **Connect Google** or **Connect Microsoft**, and signs in to the mailbox the team should use. The confirmed mailbox address becomes the sender for authorised team members without sharing the mailbox password or changing their individual TLink logins. The test action verifies a submission through that connection. This is a compact setting within the portal, not a separate setup page.

The authenticated mailbox is authoritative. This implementation supports Gmail, Google Workspace, Outlook and Microsoft 365 primary mailboxes. A business-owned address such as `office@example.com` works when hosted by one of those providers. Arbitrary aliases, delegated Exchange shared mailboxes, generic SMTP providers and inbox synchronisation are not implemented. Customer replies go to the connected mailbox.

## Routed communication

- Customer quotes, quick invoices and rental reports.
- Customer photo requests, appointment notices and direct appointment invitations.
- The customer email composer in Leads, CRM and Schedule, with recipients resolved from authorised records on the server.

Platform authentication, team invitations, installer notifications and SMS retain their existing providers. Required program/compliance document delivery retains Resend because its immutable receipt contract and migration 0173 explicitly require it; changing it requires a coordinated receipt migration. Accepted-quote invoices remain the existing read-only records; this feature does not add a send action for them. Do not describe this release as migrating every platform email.

An account that has never connected a mailbox retains the existing platform route for document sends. The new free-text composer requires a connected mailbox. After a connection is disconnected, revoked or disabled, affected business sends pause; they do not silently switch back to the platform address.

## Platform activation

Use dedicated email OAuth clients. Calendar client credentials and permissions are separate. Keep secrets out of Git, logs, screenshots and documentation.

| Provider | Exact production callback | Protected runtime configuration |
| --- | --- | --- |
| Google | `https://ausenergyassessments.com/api/trade-email/callback/google` | `GOOGLE_EMAIL_CLIENT_ID`, `GOOGLE_EMAIL_CLIENT_SECRET`, `GOOGLE_EMAIL_ENABLED=true` |
| Microsoft | `https://ausenergyassessments.com/api/trade-email/callback/microsoft` | `MICROSOFT_EMAIL_CLIENT_ID`, `MICROSOFT_EMAIL_CLIENT_SECRET`, `MICROSOFT_EMAIL_ENABLED=true` |

Both use the existing `CRM_INTEGRATION_ENCRYPTION_KEY`. Preserve that key: replacing it without migrating encrypted records breaks existing integrations. Public provider availability requires its enable switch, both credentials and the encryption key.

For Google's required pre-approval demonstration only, `GOOGLE_EMAIL_TEST_OWNER_UIDS` can contain explicitly authorised test business owner UIDs, separated by commas. Exact owner matching permits those businesses while `GOOGLE_EMAIL_ENABLED=false`; an absent or empty list permits nobody. This enables real sending for that business's already authorised team, not just the test button, so use only an approved test business. It never bypasses account eligibility, customer access or team permissions. Remove the list when testing ends. No test owner is configured as part of the registration preparation above.

For Google:

1. In the authorised Google Cloud project, enable the Gmail API and create a Web application OAuth client with the exact callback above.
2. Configure the external consent application, authorised domain, support contact and required public application/privacy information.
3. Request `openid`, `email` and `https://www.googleapis.com/auth/gmail.send`. No inbox-reading scope is requested.
4. Complete the applicable Google sensitive-scope verification and production publishing process before broad business onboarding. Testing-mode refresh tokens with Gmail scopes expire after seven days; testing mode is not production readiness.
5. Install the dedicated credentials as protected runtime secrets, then enable only when the approved connection can be exercised.

For Microsoft:

1. Register a confidential Web application supporting accounts in any organisational directory and personal Microsoft accounts, matching the implementation's `common` authority.
2. Add the exact callback above and delegated permissions `openid`, `profile`, `email`, `offline_access`, `User.Read`, and `Mail.Send`.
3. Complete the applicable publisher/tenant consent setup. Some business tenants require their administrator's approval.
4. Install the client ID and secret as protected runtime secrets. Track the secret's expiry and rotate it before expiry.
5. Enable after the delegated primary-mailbox flow passes real acceptance checks. Do not advertise delegated shared-mailbox send-as support.

Apply `drizzle/0196_trade_outgoing_email.sql` through the normal Sites migration/package workflow before the new routes run. The email migration follows the already live `0195_trade_quote_roof_image.sql`; never reuse that live sequence number. Release only from the reviewed revision, with the protected runtime values and approved provider configuration. No remote migration or deployment has been applied. Saved runtime changes take effect only with a deployment.

Provider references: [Google Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Google refresh-token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Microsoft authorisation code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [Microsoft sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0).

## Delivery and access guarantees

- Only the owner can connect, replace, test or disconnect the business mailbox. Existing team permissions still determine which customers and jobs each member can contact.
- OAuth state is short-lived, single-use and bound to an HttpOnly browser cookie. Credentials and the PKCE verifier are encrypted at rest. The callback rechecks account eligibility before storing the connection.
- The recipient is derived from the authorised customer, enquiry or job, including current protected-contact consent. A posted arbitrary `to` address is not accepted.
- The submission journal binds an owner/request key to its message content and records the sender, provider and actor. It also covers new platform fallback submissions so connecting a mailbox cannot replay an ambiguous platform attempt through a different provider.
- A provider acceptance is reported as **accepted**, not delivered. Microsoft `202` provides no message identifier; the internal `submission:` reference is not a provider delivery receipt.
- Confirmed Google/Microsoft acceptance with a stored submission reference settles quote dispatch guards so later quote revisions are possible. It does not populate a delivery timestamp or change the customer-facing state to delivered.
- Timeouts, unknown responses and persistence failures after submission are treated as uncertain. The same request may check its saved result but cannot automatically send again. Confirm the mailbox result before any manual reconciliation; never reset a journal row just to retry it.
- Known rejections can retry after the journal cooldown. A failed attempt cannot silently switch sender/provider. Old pre-migration delivery attempts without a journal are held for reconciliation when switching to a business mailbox.
- Refresh leases prevent concurrent token rotation. Final submission reservations require a still-connected mailbox and an eligible installer account. Provider requests are bounded to 20 seconds with redirects disabled.
- The serialized mailbox request is limited to 3 MiB. Rental PDFs above 1.5 MiB use the existing secure report link. New quote emails (renderer revision 3) attach PDFs up to 1.5 MiB and always provide the secure review/download link; larger roof-design PDFs use that link. The threshold is provider-independent, and immutable PDF hashes are still checked. Historic quote renderer revisions 1 and 2 retain their exact content and attachment contract. Other oversized messages fail explicitly.
- Disconnect removes stored credentials and pending OAuth state but preserves the sending journal. Closing the trade account also disconnects it. Provider-side application grants can additionally be removed in the mailbox account's security settings.

## Real acceptance checks before activation

Use an authorised test business and recipients the user has approved. Local fixture sends do not establish any of these results.

1. Connect each enabled provider from Business settings, return to the same settings section, confirm the correct sender and receive the test email.
2. From two permitted TLink team accounts, submit customer mail and a quote. Verify the same business From address, reply destination, Sent folder and attached immutable PDF. Confirm an unauthorised team member cannot send or change the connection.
3. Exercise a quick invoice, rental report and calendar invitation; verify the attachment or secure link and calendar organiser.
4. Revoke provider access, attempt another send, reconnect and verify clear recovery without platform fallback. Check an expired access token refreshes without prompting the business again.
5. Confirm an uncertain submission remains held and cannot issue a replacement quote generation or automatic resend. Confirm a revoked contact release blocks sending before provider submission.
6. Confirm affected desktop and mobile production screens, protected unauthenticated routes, deployment revision and migration provenance.

To pause a provider, set its enable switch to `false` through the approved runtime workflow. Connected accounts pause sending rather than falling back. Do not drop the connection or journal tables as a rollback shortcut.

## Local verification

Focused coverage is in `test/trade-email-{provider,server,recipient,api,routing,ui}.test.mjs` and the existing quote, invoice, rental-report and customer-contact suites. Full project validation is `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run db:check` and `npm.cmd run build`.

The isolated UI fixture in `C:\Webproject\outputs\trade-email-qa` uses mocked responses and synthetic customers. It verifies layout and user interactions only and is not shipped in the application.
