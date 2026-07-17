# Service reminder delivery setup

P6-2G uses Resend for email and Twilio for SMS because both provide authenticated asynchronous delivery events. Provider credentials belong only in protected Sites runtime secrets. They must never be stored in Git, D1, administrator notes or trade account records.

The code and database boundary are safe while providers are unconfigured. Both channels start disabled. The operations owner can enable a channel only after its send credentials and callback verification secret are present.

## Current production setup

As of 17 July 2026, the AEA Resend account is active under the business Google identity. A sending-only production key and webhook signing secret are protected in Sites. The dedicated `reminders.ausenergyassessments.com` DKIM, SPF and return-path records are present in Squarespace DNS and the domain is verified in Resend. Sites environment revision 14 is deployed. Email remains disabled until an owner deliberately enables the channel.

The AEA Twilio account is upgraded. The `AEA service reminders` Messaging Service is configured with the production delivery callback and Advanced Opt-Out. The `TLink customer verification` Verify Service is configured for SMS with Fraud Guard, and its protected identifier is deployed in Sites environment revision 14. The `TLink` transactional alphanumeric sender registration is saved as a draft pending genuine brand-ownership evidence and company officer or authorised representative identity verification. SMS remains disabled until Twilio approves the sender and it is attached to the Messaging Service.

## Resend email

1. Create or use the AEA Resend account.
2. Verify the sending domain that will appear in `RESEND_FROM_EMAIL`.
3. Create a sending-only API key and store it as the protected `RESEND_API_KEY` Sites secret.
4. Store the verified sender, including its display label, as `RESEND_FROM_EMAIL`.
5. Store the customer reply destination as `RESEND_REPLY_TO`.
6. Create a webhook for:

   `https://compare.ausenergyassessments.com/api/service-reminder-provider-events/resend`

7. Subscribe to `email.sent`, `email.delivered`, `email.failed`, `email.bounced`, `email.suppressed` and `email.complained`.
8. Store the webhook signing secret as the protected `RESEND_WEBHOOK_SECRET` Sites secret.
9. Deploy the newest saved Sites version so the new runtime revision applies.
10. In Operations control centre, open Access & audit and enable Email only after it reports that credentials and callbacks are ready.

Resend requests use the delivery idempotency key. Bounces, suppression and complaints immediately disable email reminders for that customer asset and prevent queued retries.

## Twilio SMS and mobile verification

1. Create or use the AEA Twilio account and complete the Australian sender and compliance requirements for the intended traffic.
2. Create a Messaging Service with its approved sender.
3. Create a Verify Service for customer mobile ownership checks.
4. Store `TWILIO_ACCOUNT_SID`, protected `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID` and `TWILIO_VERIFY_SERVICE_SID` in Sites.
5. Store this exact non-secret callback URL:

   `https://compare.ausenergyassessments.com/api/service-reminder-provider-events/twilio`

   as `SERVICE_REMINDER_TWILIO_CALLBACK_URL`.
6. Set the Messaging Service delivery status callback and inbound message webhook to the same URL.
7. Enable Advanced Opt-Out for the Messaging Service. Keep the standard STOP handling active.
8. Deploy the newest saved Sites version so the new runtime revision applies.
9. In Operations control centre, open Access & audit and enable SMS only after it reports that credentials and callbacks are ready.

Twilio callbacks are verified against the exact callback URL and the account auth token. STOP messages disable SMS for the customer, suppress pending attempts and return an empty TwiML response.

## Release checks

- Keep each channel disabled until its verified sender, credentials and authenticated callbacks are ready.
- Verify customer email and mobile ownership before enabling the corresponding asset channel.
- Prepare the reminder again whenever its content changes. One follow-up, channel and content revision can be sent only once.
- Confirm delivered, bounced, failed and opted-out states in the operations delivery panel.
- Never test production delivery with a real customer. Use provider test recipients and a designated AEA test account.
