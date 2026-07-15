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

## Version 1 transport

- Bootstrap: `GET /api/trade-team/sync` returns the current accessible job snapshot and an opaque `v1` cursor.
- Delta: `GET /api/trade-team/sync?cursor=v1:<sequence>` returns bounded upsert and delete changes after that cursor.
- Replay: `POST /api/trade-team/sync` accepts up to 50 queued actions with a stable device ID and a unique client action ID for every action.
- Authentication: requests use the existing Firebase bearer identity. Native clients normally omit the browser Origin header.
- Caching: every response is private and no-store. The app owns encrypted temporary persistence.

## Supported queued actions

- `set_job_stage` requires the job revision that the device edited.
- `set_task_status` requires the checklist revision that the device edited.
- `add_time_entry` is append-only and can be replayed safely.

The server returns `applied`, `duplicate`, `conflict` or `rejected` for each action. A conflict includes the current revision so the app can refresh the job and ask the technician to review the newer state. Reusing an action ID with different content is rejected.

## Native client responsibilities

- Generate and retain a stable random device ID per installation.
- Generate a unique client action ID before changing local state.
- Store queued actions and cached jobs in an encrypted local database.
- Apply server tombstones before showing the next screen.
- Upload actions in order, but treat every response independently so one conflict does not block unrelated work.
- Keep photos and documents in a separate encrypted upload queue. Version 1 does not place file bytes in the structured sync batch.
- Refresh authentication before sync and stop processing immediately after account suspension, membership removal or sign-out.
- Never place tokens, customer details or field notes in diagnostics, push notification text or crash reports.

## Next contract layer

The next mobile foundation should add resumable idempotent media uploads, device registration and revocation, push notification tokens, app-version enforcement and a controlled recovery flow for actions left in progress after a device or network failure.
