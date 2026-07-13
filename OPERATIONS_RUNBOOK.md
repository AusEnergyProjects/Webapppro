# API monitoring runbook

Status: ready for configuration, not deployed

This monitoring covers the public electricity-plan API and the lead-delivery path without submitting a customer lead.

## What runs

The Netlify scheduled function `api-health-monitor` runs hourly on published production deploys. Each run:

1. Requests `/api/electricity-plans` for a fixed synthetic residential comparison in postcode 3000, with a cache-busting monitor ID.
2. Confirms that the route returns at least one priceable plan and at least one successful list and detail source.
3. Calls `/api/internal/lead-webhook-probe` with the dedicated probe token.
4. Confirms that the downstream lead processor acknowledges the `webhook.delivery_probe` test event.
5. Sends an alert on a healthy-to-unhealthy or unhealthy-to-healthy transition.
6. Repeats an unresolved failure alert after six hours. Failed alert deliveries remain pending and are retried on the next hourly run.

Scheduled functions run only on published deploys. Preview deploys and ordinary `next dev` sessions do not run the hourly schedule.

## Required Netlify variables

Configure these as private server-side environment variables. Never prefix them with `NEXT_PUBLIC_`.

```text
AEA_LEAD_WEBHOOK_TEST_TOKEN=<at least 32 random characters>
AEA_OPS_ALERT_WEBHOOK_URL=https://your-private-alert-receiver.example/endpoint
```

The existing `AEA_LEAD_WEBHOOK_URL` must also remain configured. The alert receiver should accept an HTTP JSON POST, return a 2xx response only after accepting the notification, and notify an on-call person or monitored operations channel.

Do not point `AEA_OPS_ALERT_WEBHOOK_URL` at the customer lead processor unless that processor has a dedicated operations-event branch. Alert events have `eventType` values `ops.health_alert` and `ops.health_recovered` and must never create customer records.

## Privacy boundary

Health requests and alerts contain no customer name, email, phone, NMI, meter intervals, annual usage, postcode supplied by a customer, or lead payload. The postcode 3000 check is a fixed synthetic monitor input.

Application API logs use one JSON object per event. They contain:

- event and outcome category;
- HTTP status and duration;
- random request correlation ID;
- aggregate plan-source counts for the plan API;
- the categorical submission type for the lead API.

They do not log request bodies, contact details, IP addresses, NMIs, meter data, plan selections, consent text, or downstream webhook URLs.

## Alert response

When `electricity_plans` fails:

1. Open the matching `monitor.api_health` log entry and note the status, safe source counts and plan request ID.
2. Check `api.electricity_plans` events using that request ID.
3. Distinguish total upstream failure from tariff validation rejection or unavailable plan details.
4. Do not disable strict tariff validation to restore plan counts.

When `lead_delivery` fails:

1. Check the internal probe response status and the lead processor's operational-event log.
2. Search downstream records by probe ID only if the processor records it as an operational event.
3. Confirm that no customer lead was created from `webhook.delivery_probe`.
4. Keep the public fallback telephone number available while delivery is impaired.
5. Confirm the deployed Apps Script source matches `integrations/google-apps-script/lead-email-relay.gs` and that the active web app deployment was updated after the last source change.

When both checks fail, first confirm the production site and Netlify function runtime are reachable, then check environment configuration and provider status.

## Recovery and verification

A recovery alert is sent only after both checks succeed. After configuration or incident repair, verify the next scheduled run shows:

```text
event=monitor.api_health
status=healthy
electricity_plans.ok=true
lead_delivery.ok=true
```

Do not test recovery by submitting a real lead. Use only the dedicated webhook probe event.

## Email workflow release check

The lead processor must return the plain text acknowledgement `ok` only after it accepts the event and completes the required sends. Before updating the Apps Script deployment:

1. Confirm the repository relay tests cover all five event types and the operational probe.
2. Confirm new unsubscribe links use only `?action=unsub&t=<opaque token>`.
3. Confirm internal messages reply to the supplied customer email when present, while customer messages reply to `info@ausenergyassessments.com`.
4. Create a new Apps Script deployment version rather than relying on saved editor source alone.
5. Run the privacy-safe probe after deployment. Do not create a customer lead as a health check.
