# API monitoring runbook

Status: Google Apps monitoring source is ready for deployment and activation

The live service monitor runs from the existing Google Apps Script project so it remains independent of the website runtime it checks. It uses fixed synthetic inputs and never submits a customer lead.

## What runs

The `runOperationalHealthCheck` trigger runs hourly. Each run:

1. Requests `/api/health` and confirms the Sites application runtime responds with the expected service identity.
2. Requests `/api/electricity-plans` for a fixed synthetic residential comparison in postcode 3000.
3. Requests `/api/gas-plans` for a fixed synthetic annual gas comparison in postcode 3000.
4. Confirms both plan routes return at least one priceable plan, successful list and detail sources, dated plan evidence and detail API version 3.
5. Calls `/api/internal/lead-webhook-probe` with a dedicated secret token.
6. Confirms the downstream lead processor acknowledges the `webhook.delivery_probe` test event.
7. Emails `info@ausenergyassessments.com` only on a healthy-to-unhealthy or unhealthy-to-healthy transition.
8. Repeats an unresolved failure alert after six hours. Failed alert delivery remains pending for the next hourly run.

## Required configuration

The same high-entropy `AEA_LEAD_WEBHOOK_TEST_TOKEN` must be stored in two protected locations:

- the Sites production environment;
- the Google Apps Script project properties.

Never add the token to repository source, client code, a public URL or a spreadsheet cell. The existing `AEA_LEAD_WEBHOOK_URL` must also remain configured in Sites.

Run `setupOperationalMonitoring` once after deploying the Apps Script source. It replaces only an existing `runOperationalHealthCheck` trigger and creates one hourly trigger. The normal `setup` function also installs this trigger while preserving the daily comparison reminder trigger.

## Operations inbox and off-screen delivery

The Sites application keeps a durable administrator notification and delivery ledger in D1. Actionable, high and urgent events are queued automatically. This includes customer enquiries, trade responses, approval work, verified billing problems, comparison-enquiry delivery failures and administrator access changes.

To send those summaries to a private operations channel, configure:

```text
AEA_OPS_ALERT_WEBHOOK_URL=https://your-private-operations-alert.example/endpoint
AEA_OPS_ALERT_WEBHOOK_SECRET=replace-with-a-private-bearer-secret
```

The destination must use HTTPS. The secret is sent only as a server-side bearer credential and is optional when the destination uses another private authentication boundary. Never place either value in browser code or a `NEXT_PUBLIC_` variable.

Owners and administrators can see whether the channel is connected, inspect delivered, waiting and failed counts, send a privacy-safe test alert, and retry an individual failure. Failed attempts retry after 5 minutes, 30 minutes, 2 hours, 6 hours and then 12 hours. The durable inbox remains the source of truth even when no off-screen channel is connected.

## Privacy boundary

Health checks and alerts contain no customer name, email, phone, NMI, meter intervals, annual usage supplied by a customer, saved comparison or lead payload. Postcode 3000 and the electricity and gas usage values are fixed synthetic monitor inputs.

Operational records contain only:

- check name and healthy or failed outcome;
- HTTP status and duration;
- random monitor or request correlation ID;
- aggregate plan-source counts where available;
- a privacy-safe lead probe ID.

Off-screen admin notification payloads contain only:

- notification ID, event type, category and priority;
- operational title and privacy-safe summary;
- action-required flag and creation time;
- the relative path to the protected operations portal.

They do not include or log request bodies, customer names, emails, phones, street addresses, account identifiers, IP addresses, meter data, plan selections, consent text, uploaded files, webhook URLs, account tokens or probe secrets.

## Alert response

When `site_runtime` fails:

1. Open the live site and `/api/health`.
2. Check the latest Sites deployment state and platform status.
3. Do not rotate secrets unless the failure evidence identifies authentication or configuration.

When `electricity_plans` or `gas_plans` fails:

1. Check the matching route using the same fixed synthetic inputs.
2. Use the request ID and aggregate source counts to distinguish total upstream failure from unavailable retailer sources or rejected tariff structures.
3. Do not weaken tariff validation merely to restore plan counts.

When `lead_delivery` fails:

1. Check whether the Sites probe route is configured and authorised.
2. Search downstream operational records by probe ID only if needed.
3. Confirm the deployed Apps Script source still recognises `webhook.delivery_probe` and returns `ok` without creating a spreadsheet row or email.
4. Keep the public fallback telephone number available while delivery is impaired.

When every check fails, first confirm the production site is reachable, then inspect platform status and the Apps Script execution history.

## Recovery and release checks

A recovery email is sent only after every check succeeds. After configuration or incident repair, run `runOperationalHealthCheck` manually and confirm:

```text
status=healthy
site_runtime.ok=true
electricity_plans.ok=true
gas_plans.ok=true
lead_delivery.ok=true
```

Before updating the Apps Script deployment:

1. Confirm repository tests cover all five customer event types and the operational probe.
2. Confirm unsubscribe links contain only an opaque token.
3. Confirm internal and customer reply routing remains correct.
4. Create a new Apps Script deployment version rather than relying on saved editor source alone.
5. Run only the privacy-safe operational check after deployment. Do not submit a real customer lead as a health check.

The older Netlify scheduled implementation remains in the repository for its inactive deployment target. It must not be enabled or deployed without explicit Netlify approval.
