# Trade integration activation runbook

This runbook covers owner-only setup for the external services that TLink may use while hosted on ChatGPT Sites. Never put provider secrets in Git, D1 records, support tickets or customer notes. Store production values only as protected Sites runtime secrets.

## Sites financial-transaction restriction

TLink must not initiate, execute or facilitate a financial transaction while hosted on ChatGPT Sites. The deployed application therefore:

- does not create or expose customer checkout links;
- does not expose payment providers in the active integration model;
- does not accept payment-provider OAuth callbacks;
- accepts legacy payment webhooks with a bounded ignored response and makes no database mutation; and
- stores no active checkout or payment-event model in current application source.

Invoice and provider-neutral accounting status remain operational business records. They do not grant, rank or expand free TLink access. Do not add payment-provider credentials or attempt payment-provider onboarding for the Sites deployment. Re-enablement requires an approved non-Sites host plus written legal and provider acceptance for the exact flow.

## Xero accounting

1. Register the production Xero OAuth application and allow:

   `https://compare.ausenergyassessments.com/api/trade-integrations/callback/xero`

2. Store the client ID as `XERO_CLIENT_ID` and client secret as `XERO_CLIENT_SECRET`.
3. Confirm the app is approved for `offline_access`, `accounting.invoices` and `accounting.contacts`.
4. Connect a test organisation from an installer account.
5. Export a direct-customer job and confirm a draft invoice is created. The platform must not email the customer.
6. Approve and pay the test invoice in Xero, then use Refresh status in the installer CRM. Confirm the invoice total and paid amount update once.

Xero exports remain drafts so the installer can check account coding and tax treatment before approval or sending.

## MYOB accounting

1. Register the production MYOB OAuth application and allow:

   `https://compare.ausenergyassessments.com/api/trade-integrations/callback/myob`

2. Store the API key as `MYOB_CLIENT_ID` and API secret as `MYOB_CLIENT_SECRET`.
3. Confirm the app requests `sme-company-settings`, `sme-sales`, `sme-contacts-customer` and `sme-general-ledger`.
4. Reconnect any MYOB account that was authorised before the customer and general ledger scopes were added.
5. Export a direct-customer job, choose the correct income account, and confirm a tax-inclusive service invoice is created without automatic email delivery.
6. Record a test payment in MYOB, then use Refresh status in the installer CRM. Confirm the balance changes once.

The MYOB income account is selected for each first export. This avoids guessing how the installer has structured its chart of accounts.

## QuickBooks accounting

1. Register the production QuickBooks Online OAuth application and allow:

   `https://compare.ausenergyassessments.com/api/trade-integrations/callback/quickbooks`

2. Store the client ID as `QUICKBOOKS_CLIENT_ID` and client secret as `QUICKBOOKS_CLIENT_SECRET`.
3. Confirm the app requests `com.intuit.quickbooks.accounting` and returns a company `realmId` to the callback.
4. From an accepted direct-customer quote, choose the QuickBooks product or service that should receive the sale. TLink creates one unsent invoice using the immutable commercial reference, accepted scope and exact AUD total, then verifies the returned total before storing the provider link.
5. Confirm the invoice is reviewed in QuickBooks before any manual approval or customer delivery. TLink does not send it automatically.
6. Connect a test company from an installer account and confirm the encrypted connection and selected product or service remain isolated to that trade owner.

QuickBooks invoice export is available only after the production OAuth application is configured and the installer connects a company. A disconnected provider leaves the accepted TLink handoff intact.

## Release checks

After changing an approved runtime value, deploy a saved Sites version so the new environment revision is applied. Then confirm:

- `/api/health` responds successfully.
- Unauthenticated integration reads remain rejected.
- Payment providers are absent from the integration provider list, UI and callback return model.
- The retired payment-link API route is absent.
- Legacy Stripe and Square webhook requests return an ignored response and do not read or write D1.
- After the contract migration, retired payment-provider connections, OAuth state, checkout, event and allocation tables are absent.
- Xero, MYOB and QuickBooks reject AEA protected jobs before any provider request is made.
- One direct-customer job creates at most one accounting invoice record.
- Accounting refresh never reduces a previously recorded paid amount.
