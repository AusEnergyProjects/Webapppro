# Mobile field sync contract

## Purpose

The installer web CRM is the system of record. Future iOS and Android apps will use the same authenticated installer APIs while continuing to work during unreliable or unavailable network access.

## Permanent boundaries

- Technicians receive assigned jobs only.
- Managers and coordinators receive the dispatch scope allowed by their server-side role.
- AEA protected jobs contain a job reference, work scope and service region only. Customer identity, contact details and street address must never enter the mobile sync payload.
- Direct-customer street addresses may be supplied only for an assigned job. Native clients must encrypt the local database, purge the address within 24 hours and remove the entire job immediately after an unassignment tombstone.
- Signing out must purge all locally cached business data.
- The server remains authoritative. Device storage is a temporary working copy.

## Version 3 transport

- Registration: `POST /api/trade-team/devices` records one installation-specific device ID, platform, app version and optional push token.
- Bootstrap: `GET /api/trade-team/sync?deviceId=<id>` returns the current accessible job snapshot and an opaque `v1` cursor.
- Delta: `GET /api/trade-team/sync?deviceId=<id>&cursor=v1:<sequence>` returns bounded upsert and delete changes after that cursor.
- Replay: `POST /api/trade-team/sync` accepts up to 50 queued actions from an active registered device with a unique client action ID for every action.
- Authentication: requests use the existing Firebase bearer identity. Native clients normally omit the browser Origin header.
- Version enforcement: every native request identifies its platform and semantic app version. Clients below the configured minimum receive HTTP 426 with the required version.
- Caching: every response is private and no-store. The app owns encrypted temporary persistence.

## Supported queued actions

- `set_job_stage` requires the job revision that the device edited.
- `set_task_status` requires the checklist revision that the device edited.
- `add_time_entry` is append-only and can be replayed safely.
- `save_job_form` carries the assigned form revision, the latest bounded answers and an optional completion request. Repeated offline saves for the same form are coalesced on the device while preserving the original revision.

The server returns `applied`, `duplicate`, `conflict`, `retry` or `rejected` for each action. A conflict includes the current revision so the app can refresh the job and ask the technician to review the newer state. Reusing an action ID with different content is rejected. Processing receipts carry a five-minute lease. An interrupted request can be retried safely after the lease expires without leaving an action permanently blocked.

## Resumable field media

- Initiate: `POST /api/trade-team/media` with `action: initiate` creates an idempotent 24-hour upload session.
- Parts: multipart `POST /api/trade-team/media` with `action: upload_part` uploads numbered 5 MB parts. Re-sending a part replaces only that part.
- Resume: `GET /api/trade-team/media` returns the uploaded part numbers and ETags so a device can continue after losing reception or restarting.
- Complete: `POST /api/trade-team/media` with `action: complete` assembles the R2 object, creates the CRM media record and advances job sync in one controlled workflow.
- Abort: `DELETE /api/trade-team/media` stops the multipart upload and removes its part receipts.
- Limits: JPEG, PNG, WebP and PDF files are accepted up to 50 MB. AEA protected job filenames and captions are checked for contact details.

If the object was assembled but the final database response was interrupted, a repeated completion request verifies the object and safely finalises the CRM record. The client upload ID cannot be reused with different metadata.

## Device and notification controls

- Installer owners can see registered field devices in the CRM Team area and revoke a lost, replaced or retired device.
- Revocation blocks sync, queued actions and media uploads immediately, clears its push token and marks active upload sessions as aborted.
- A device cannot reactivate itself after revocation. The business owner must authorise it before secure registration can continue.
- Push tokens are private server records. Job changes create a data-free outbox event containing only a sync instruction, contract version and opaque job identifier.
- Notification titles and bodies must remain generic. The app fetches authorised data through sync after opening a notification.

## Native client responsibilities

- Generate and retain a stable random device ID per installation.
- Generate a unique client action ID before changing local state.
- Store queued actions and cached jobs in an encrypted local database.
- Apply server tombstones before showing the next screen.
- Upload actions in order, but treat every response independently so one conflict does not block unrelated work.
- Keep photos and documents in a separate encrypted upload queue and retain their stable client upload IDs until the server reports completion.
- Refresh authentication before sync and stop processing immediately after account suspension, membership removal or sign-out.
- On HTTP 403 device revocation, purge the encrypted local database, queued files, cached addresses and push token before returning to sign-in.
- On HTTP 426, stop all sync and direct the user to the current app release without deleting queued work.
- Never place tokens, customer details or field notes in diagnostics, push notification text or crash reports.

## Native application build layer

The `mobile/` workspace now implements the iOS and Android field client on Expo SDK 57 and React Native 0.86. It uses a custom development build because SQLCipher is enabled through native configuration.

- Job, action, conflict and upload metadata is held in SQLCipher.
- Photos and documents are divided into 5 MB AES-256-GCM encrypted chunks. The file key remains in the platform secure store and only one decrypted chunk is held in memory during upload.
- Bootstrap, delta pages, action replay, tombstones, resumable uploads, app-version enforcement and remote revocation use contract version 3.
- Sync runs when the app opens, reception returns, a private push notification is opened, the user requests it or the operating system grants a background window.
- The technician interface is limited to assigned work, job stage, checklists, time and evidence. Device registration, sync state and actionable conflicts are visible without exposing the underlying complexity during normal work.
- Assigned job payloads include the original versioned technical form snapshot, bounded answers, readiness and completion state. The app renders the saved snapshot and never silently upgrades it.
- Technicians can edit, save and complete forms offline. Required fields are checked on the device and again by the server, completed forms lock, and technical answers are rejected if they contain customer email or phone details.
- Native store credentials, Firebase mobile configuration files and platform OAuth client IDs remain release prerequisites and must not enter source control.
