# Next task handover

Status: active rolling handover
Prepared: 17 July 2026
Baseline commit: `a6f0e18` on `codex/sites-custom-domain-migration`, Sites version 131

## Current delivery summary

P6-2F adds a consent-aware service follow-up preparation queue to the existing installed-asset, service-plan, customer, service-site and team sources of truth. It does not send customer messages or create another asset or service-plan model.

Migration `0052_service_follow_up_preparation.sql` adds one owner-scoped preparation record per service plan and due date plus an immutable audit event stream. The unique plan and due-date boundary prevents duplicate reminder preparation while completed service events continue to advance the authoritative service plan.

The installer dashboard and manager or coordinator staff portal now include customer, site, asset, due-state, assignee, consent and preparation-state filters. Owner and dispatch roles can assign internal preparation, suppress a follow-up with a reason, complete or reopen work, and generate deterministic customer-safe reminder content for review.

Readiness requires an active customer account, an unwithdrawn customer-account consent receipt, an explicit asset lifecycle preference with reminders enabled and the customer's selected lead-time window. Missing or withdrawn consent blocks readiness. Protected marketplace records remain excluded unless they already have authorised customer ownership and direct CRM customer and site links. The API does not select customer email, phone or street-address fields.

## Recommended next milestone

### P6-2G: build the outbound service-reminder delivery boundary

Outcome: allow an authorised person to send an approved service reminder through explicitly configured providers with delivery, deduplication and opt-out controls.

### In scope

- Add administrator-managed email and SMS provider configuration with protected hosted credentials.
- Require a prepared P6-2F reminder, current customer consent and a deliberate authorised send action.
- Add an idempotency key per follow-up, channel and content revision.
- Store queued, sent, delivered, failed, bounced and opted-out delivery states plus provider receipts.
- Apply customer opt-out and lifecycle preference changes before every delivery attempt.
- Add retry boundaries, rate limits and administrator delivery-health monitoring.
- Add focused authorization, consent-race, deduplication, provider-signature, failure and privacy tests.

### Explicitly out of scope

- Marketing campaigns, lead nurturing, autonomous outreach or AI-written sales copy.
- Automatic sending without a deliberate authorised action.
- Push notifications, route optimisation, appointment auto-booking or payments.
- Replacing provider suppression, unsubscribe or delivery-receipt sources of truth.

### Acceptance criteria

- Every outbound delivery resolves to one approved P6-2F follow-up and exact content revision.
- No delivery is queued when consent is missing, withdrawn or outside the selected channel preference.
- Repeated requests cannot send the same content twice through the same channel.
- Provider callbacks are authenticated, replay-safe and update one delivery record.
- Customer opt-out immediately suppresses pending delivery and future preparation eligibility.
- `npm run validate` passes on the exact release commit.

### Stop and escalate if

- Provider credentials or verified sending domains and numbers are unavailable.
- A channel cannot provide authenticated delivery receipts or enforce opt-out handling.
- The slice expands into marketing automation, autonomous outreach, payments or scheduling.

## Recommendation after P6-2G

Build P6-2H as service follow-up performance and workload reporting using consent-safe aggregate metrics, without customer ranking or staff performance scoring.
