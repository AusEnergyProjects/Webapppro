# Trade integration activation runbook

This runbook covers the owner-only setup needed before installers can connect external services. Never put provider secrets in Git, D1 records, support tickets or customer notes. Store production values in Sites runtime secrets.

## Stripe Connect

Use the SaaS platform model where each installer is the merchant and collects payment from its own direct customer. AEA does not receive or distribute the installer payment.

1. Complete Stripe business and identity verification for the AEA platform account.
2. Enable OAuth for Stripe Dashboard accounts.
3. Register this redirect URI:

   `https://aea-energy-comparison.info294029.chatgpt.site/api/trade-integrations/callback/stripe`

4. Add the live client ID as `STRIPE_CONNECT_CLIENT_ID`.
5. Keep the live platform secret in `STRIPE_SECRET_KEY` or the existing `STRIPE_REFERRAL_SECRET_KEY`.
6. Create a production Connect event destination for events on connected accounts at:

   `https://aea-energy-comparison.info294029.chatgpt.site/api/stripe/webhook`

7. Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.async_payment_failed`.
8. Store that destination signing secret as `STRIPE_CONNECT_WEBHOOK_SECRET`.

The existing account webhook remains responsible for AEA membership billing. Its signing secret stays separate in `STRIPE_WEBHOOK_SECRET`.

## Square

1. Create the production OAuth application and register:

   `https://aea-energy-comparison.info294029.chatgpt.site/api/trade-integrations/callback/square`

2. Store the application ID as `SQUARE_APPLICATION_ID` and the application secret as `SQUARE_APPLICATION_SECRET`.
3. Keep `SQUARE_ENVIRONMENT` unset for production. Use `sandbox` only in an isolated non-production deployment.
4. Create a webhook subscription for `payment.created` and `payment.updated` at:

   `https://aea-energy-comparison.info294029.chatgpt.site/api/square/webhook`

5. Store the webhook signature key as `SQUARE_WEBHOOK_SIGNATURE_KEY`.
6. Store the exact notification URL above as `SQUARE_WEBHOOK_NOTIFICATION_URL` so signature verification cannot drift behind a proxy.

## Google property tools

1. Use a dedicated Google Cloud project for the property lookup service.
2. Enable only Geocoding API and Maps Static API.
3. Create a server-side API key restricted to those two APIs.
4. Set conservative service quotas and billing alerts that match the operating budget.
5. Store the key as `GOOGLE_MAPS_API_KEY`.

The application sends address lookups only for installer-owned direct customers. AEA-protected household addresses are blocked before Google is called. The database stores only the Google place ID, not coordinates or the formatted street address.

## Release checks

After changing any runtime value, deploy a saved Sites version so the new environment revision is applied. Then confirm:

- `/api/health` responds successfully.
- Unauthenticated integration reads remain rejected.
- Webhooks reject unsigned requests.
- The installer integration centre shows only providers with complete server configuration as ready.
- A provider-signed test payment updates one direct-customer job once and creates one payment audit event.
