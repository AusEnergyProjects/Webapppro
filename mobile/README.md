# AEA Field

AEA Field is the native iOS and Android technician app for the Australian Energy Assessments installer CRM. It is intentionally narrower than the office workspace: technicians see assigned work, complete checklists, record time and add field evidence without receiving protected customer contact information.

## What is implemented

- Firebase email and password authentication, password reset and a configuration-ready Google sign-in path.
- Registered installation-specific devices with app-version enforcement, native push tokens and owner-controlled revocation.
- Assigned-job bootstrap and delta sync through contract version 2.
- SQLCipher-encrypted job, action, conflict and upload metadata.
- AES-256-GCM encrypted 5 MB photo and document chunks, with the key held in the device secure store.
- Offline job stages, checklist updates and time entries with stable action IDs, safe replay and conflict review.
- Camera and PDF or image document capture.
- Resumable multipart field uploads that continue after a network drop or restart.
- Automatic foreground, reconnect, notification-open and operating-system scheduled background sync.
- Immediate local purge on sign-out, unassignment tombstones or remote device revocation.
- A 24-hour maximum cache for direct-customer street addresses. AEA protected jobs remain region-only.

## Development setup

This app requires a custom development build. Expo Go cannot run the SQLCipher database configuration.

1. Copy `.env.example` to `.env` and keep the public Firebase and API values current.
2. Run `npm install`.
3. Run `npx expo prebuild --clean` when native projects are required locally.
4. Run `npx expo run:android` on Windows or macOS, or `npx expo run:ios` on macOS.

Useful checks:

```bash
npm run typecheck
npm run lint
npm run doctor
npm run export:verify
```

## Native service credentials still required for distribution

Before an internal store build, create and add:

- Android and iOS Google OAuth client IDs for the existing Firebase project.
- Android Firebase `google-services.json` for FCM.
- iOS Firebase `GoogleService-Info.plist` and APNs credentials.
- The EAS project ID, Apple Developer team and Google Play application record.

These credentials are not source code and must not be committed. Email and password sign-in, offline operation and secure API sync do not depend on Google OAuth being configured.

## Privacy boundary

The web CRM remains the system of record. Technicians receive only work authorised by the server. AEA protected leads never include a household name, phone, email or street address. Diagnostics and notification content must remain free of customer information, tokens and field notes.
