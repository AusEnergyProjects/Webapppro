# TLink

TLink is the native iOS and Android app for technicians, trades and assessors using the TLink field workspace. It is intentionally narrower than the office workspace: field workers see assigned work, complete workflows, record time and add field evidence without receiving protected customer contact information.

## What is implemented

- TLink-issued one-time setup PIN sign-in using the worker's exact name, with a device-bound 90-day field session stored in the secure store.
- Optional Firebase email and password sign-in for office users who need the broader web account path.
- Registered installation-specific devices with app-version enforcement, native push tokens and owner-controlled revocation.
- A native Messages inbox keeps team chats, groups, permitted customer SMS, photos, voice notes and internal voice/video calls inside TLink, using the app's dark theme. Requests use the existing device-bound authentication directly.
- Explicit notification permission setup, phone-settings recovery, per-device mute and safe team-conversation routing from notification taps.
- A worker-specific week calendar, day schedule, assigned-job cards and one-tap workflow launch.
- A simple plus flow for workers who are allowed to create a new self-assigned rental or safety job.
- Independent rental minimum standards, electrical safety, gas safety and smoke alarm scopes. Minimum standards is selected by default, every scope can be cleared and at least one scope is required.
- A permanent Check for update control backed by EAS Update and the TLink full-build release endpoint.
- Assigned-job bootstrap and delta sync through contract version 3.
- SQLCipher-encrypted job, action, conflict and upload metadata.
- AES-256-GCM encrypted 5 MB photo and document chunks, with the key held in the device secure store.
- Offline job stages, checklist updates and time entries with stable action IDs, safe replay and conflict review.
- Camera and PDF or image document capture.
- Audit-supporting evidence envelopes with exact queued-file SHA-256, app-observed UTC and timezone, available EXIF, foreground location state and safe app/device provenance.
- Resumable multipart field uploads that continue after a network drop or restart.
- Automatic foreground, reconnect, notification-open and operating-system scheduled background sync.
- Immediate local purge on sign-out, unassignment tombstones or remote device revocation.
- A 24-hour maximum cache for direct-customer street addresses. Australian Energy Assessments protected jobs remain region-only.

## Development setup

This app requires a custom development build. Expo Go cannot run the SQLCipher database configuration or the local native call module.

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

## Distribution configuration

The shared Android and iOS EAS project is `@ausenergy/aea-field` with project ID `3b02565e-dc34-4088-8cdd-e3c8a9ba11e9`. Version 1.1.0 adds the local `modules/tlink-calls` native module and `plugins/with-tlink-calls.js` configuration, so it requires a new signed app installation. The app-version runtime policy separates this JavaScript from installed 1.0.1 and 1.0.2 binaries; an over-the-air update cannot install the new native module. EAS archives this monorepo using the repository-root `.easignore`, which preserves the local module source and includes only the exact `mobile/google-services.json` Android client configuration exception. That client file remains excluded from Git; private signing material and provider keys must remain excluded from both Git and the build archive.

Preview builds use internal distribution and the `preview` update channel. Android produces an installable APK. iOS preview builds use ad hoc provisioning and can only be installed on devices included in the signing profile. For broader iPhone and iPad testing, use the `production` build profile and its matching update channel, then submit the signed build to TestFlight through App Store Connect. Apple Developer membership, the correct signing team and an App Store Connect app record are required. A successful EAS export is not an installable iOS build or proof of physical-device acceptance.

After TestFlight distribution or an App Store release is available, configure `AEA_MOBILE_LATEST_IOS_VERSION` and `AEA_MOBILE_IOS_UPDATE_URL` with the published version and real TestFlight public join link or App Store URL. The secure install page displays the native iPhone button only for those Apple URLs. A Home Screen web shortcut is separate from the native app. Expo SDK 57 supports iOS 16.4 and later. Test PIN sign-in, assigned work, camera and location evidence, offline restart, reconnection and shared-job completion on a physical iPhone before claiming field readiness.

TLink name and PIN sign-in, offline operation and secure API sync do not require native Google OAuth client IDs, an iOS Firebase `GoogleService-Info.plist` or push notification credentials. Optional office email/password sign-in uses the Firebase JavaScript SDK configuration. Keep signing credentials and private provider keys out of source control.

Team calls use native WebRTC with the same authorised signalling and short-lived relay credentials as the web portal. The 1.1.0 native module adds iOS PushKit/CallKit incoming calls and audio-session ownership, plus Android call notifications, an incoming-call screen and a microphone foreground service for active calls. Android can withhold full-screen notification access, leaving the call notification available. Microphone/camera permission is requested only when starting or answering; a notification tap never answers automatically. A system Answer must still pass current business, membership and call checks. On an iOS locked cold start, protected credentials may require the user to unlock the phone and restore authentication before answering. Active voice calls can continue in the background; the camera turns off when the app is hidden and must be explicitly re-enabled. Older binaries retain their foreground calling limits. Online, Busy and Offline are saved for the selected business; Busy and Offline block incoming calls while messages remain available.

The server implements Android FCM and iOS APNs delivery with current business, member, device, session and conversation checks. FCM uses `TLINK_FCM_SERVICE_ACCOUNT_JSON`, or the existing protected `FIREBASE_AUTH_SERVICE_ACCOUNT_JSON` after its `cloudmessaging.messages.create` permission is authorised. APNs requires an authorised Apple signing key and the server settings `TLINK_APNS_KEY_ID`, `TLINK_APNS_TEAM_ID`, `TLINK_APNS_PRIVATE_KEY` and `TLINK_APNS_ENVIRONMENT` (`production` or `sandbox`, matching the signed app's push environment). The APNs topic is `au.com.australianenergyassessments.field`; incoming VoIP calls use its `.voip` topic and the separately registered PushKit token. The iOS signing profile must include push capability. None of these server secrets belong in the app's public environment or source control.

Permission, device registration, configured credentials and provider acceptance do not prove delivery to a phone. Real notification delivery, cold-start Answer/End and sustained background audio still require physical-device verification on both platforms; this implementation does not establish that all notifications are working. Foreground fieldwork and sync do not depend on push delivery. Android channels include `field-sync`, `team-messages`, the legacy `team-calls`, and native `tlink-native-calls`/`tlink-ongoing-calls`. Team push data uses `type: team_message | team_call | team_call_ended`, opaque `threadId` and call identifiers, with bounded expiry. Taps wait for approved field access before opening the native conversation. Notification content must not include customer details.

Customer texts retain the business's shared number, recorded consent and assigned-job permissions. Team chat attachment bytes are retrieved through authenticated requests, bounded before local caching, and removed when their in-app viewer is released. Old browser handoff endpoints remain server-side for installed 1.0.1 clients; the 1.0.2 app no longer creates or opens them.

## Evidence capture boundary

Camera capture disables editing, requests the highest picker quality and available EXIF, then preserves and encrypts the exact file returned by the platform picker. The picker or operating system may still determine the camera output format. On iOS, Expo ImagePicker does not return GPS tags in EXIF for camera captures, so TLink records a separate foreground location observation with its timestamp, permission state, accuracy, altitude and heading when available.

`expo-location` is configured for foreground use only. The app never requests background location. A new native development or distribution build is required after adding this module. If location permission is denied, location services are off or no fix is available, the envelope records that state. A governed requirement marked as GPS-required is blocked until a current location is available.

The capture envelope and hash support Creditex review. They do not prove that evidence is accepted by a government, registry or scheme administrator. Exact activity rules, device testing, server-side hash verification and reviewer approval remain separate controls.

## Privacy boundary

The web CRM remains the system of record. Technicians receive only work authorised by the server. Australian Energy Assessments protected leads never include a household name, phone, email or street address. Diagnostics and notification content must remain free of customer information, tokens and field notes.
