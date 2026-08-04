import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import type { ImagePickerAsset, PermissionResponse as CameraPermissionResponse } from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

import { APP_VERSION } from '@/lib/config';
import {
  governedEvidenceBinding,
  type GovernedEvidenceSelection,
} from '@/lib/compliance';
import { getDeviceId } from '@/lib/device';
import type { FieldJob } from '@/lib/types';

export type EvidenceCaptureSource = 'in_app_camera' | 'document_picker';
export type EvidenceLocationState =
  | 'captured'
  | 'not_requested'
  | 'permission_denied'
  | 'services_disabled'
  | 'unavailable'
  | 'error';

export type EvidenceIdentifiers = {
  jobId: string;
  complianceCaseId: string;
  complianceActivityVersionId: string;
  evidencePolicyVersionId: string;
  evidenceRequirementId: string;
  evidenceRequirementCode: string;
};

export type EvidencePermissionState = {
  status: 'granted' | 'denied' | 'undetermined' | 'not_requested';
  granted: boolean;
  canAskAgain: boolean;
  accuracy: 'full' | 'reduced' | 'fine' | 'coarse' | 'none' | 'unknown';
};

export type EvidenceLocation = {
  state: EvidenceLocationState;
  observedAtUtc: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMetres: number | null;
  altitudeMetres: number | null;
  altitudeAccuracyMetres: number | null;
  headingDegrees: number | null;
  speedMetresPerSecond: number | null;
  mocked: boolean | null;
};

export type EvidenceCaptureEnvelope = {
  schemaVersion: 1;
  captureSessionId: string;
  source: EvidenceCaptureSource;
  identifiers: EvidenceIdentifiers;
  capture: {
    observedAtUtc: string;
    utcOffsetMinutes: number;
    timeZone: string;
    cameraPermission: EvidencePermissionState;
    locationPermission: EvidencePermissionState;
  };
  location: EvidenceLocation;
  original: {
    preservedWithoutAppTransformation: boolean;
    editingApplied: boolean;
    pickerQuality: number | null;
    exifRequested: boolean;
    exifState: 'available' | 'not_returned' | 'not_applicable';
    exif: Record<string, unknown> | null;
    widthPixels: number | null;
    heightPixels: number | null;
  };
  integrity: {
    algorithm: 'SHA-256';
    digestHex: string;
    byteLength: number;
    computedAtUtc: string;
  };
  provenance: {
    installationId: string;
    appId: string;
    appName: string;
    appVersion: string;
    nativeVersion: string;
    nativeBuildVersion: string;
    platform: string;
    platformVersion: string;
    isPhysicalDevice: boolean;
    manufacturer: string;
    modelName: string;
    osName: string;
    osVersion: string;
  };
  acceptance: {
    status: 'not_assessed';
    statement: string;
  };
};

export type PendingPhotoCapture = {
  captureSessionId: string;
  captureObservedAtUtc: string;
  utcOffsetMinutes: number;
  timeZone: string;
  identifiers: EvidenceIdentifiers;
  category: 'before' | 'progress' | 'after';
  caption: string;
  gpsRequired: boolean;
  cameraPermission: EvidencePermissionState;
  preCaptureLocationPermission: EvidencePermissionState;
  preCaptureLocation: EvidenceLocation;
  asset?: {
    uri: string;
    fileName: string | null;
    mimeType: string | null;
    fileSize: number | null;
    width: number;
    height: number;
    exif: Record<string, unknown> | null;
  };
};

const notRequestedPermission: EvidencePermissionState = {
  status: 'not_requested',
  granted: false,
  canAskAgain: true,
  accuracy: 'unknown',
};

export function evidenceIdentifiers(
  job: Pick<FieldJob, 'id'>,
  selection?: GovernedEvidenceSelection,
): EvidenceIdentifiers {
  const binding = selection ? governedEvidenceBinding(selection) : {
    complianceCaseId: '',
    complianceActivityVersionId: '',
    evidencePolicyVersionId: '',
    evidenceRequirementId: '',
    evidenceRequirementCode: '',
  };
  return {
    jobId: job.id,
    ...binding,
  };
}

export function validateEvidenceIdentifiers(identifiers: EvidenceIdentifiers) {
  if (typeof identifiers.jobId !== 'string' || !identifiers.jobId.trim()) {
    throw new Error('The evidence capture is missing its job ID.');
  }
  const governed = [
    identifiers.complianceCaseId,
    identifiers.complianceActivityVersionId,
    identifiers.evidencePolicyVersionId,
    identifiers.evidenceRequirementId,
    identifiers.evidenceRequirementCode,
  ];
  if (governed.some((value) => typeof value !== 'string')) {
    throw new Error(
      'Governed evidence identifiers are malformed. Sync the job before capturing evidence.',
    );
  }
  const populated = governed.filter((value) => value.trim()).length;
  if (populated !== 0 && populated !== governed.length) {
    throw new Error(
      'Governed evidence must be bound to one complete case, activity, policy and requirement.',
    );
  }
  return identifiers;
}

export function cameraPermissionState(permission?: CameraPermissionResponse): EvidencePermissionState {
  if (!permission) return notRequestedPermission;
  return {
    status: permission.status,
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    accuracy: 'unknown',
  };
}

export function locationPermissionState(permission?: Location.LocationPermissionResponse): EvidencePermissionState {
  if (!permission) return notRequestedPermission;
  return {
    status: permission.status,
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    accuracy: permission.ios?.accuracy || permission.android?.accuracy || 'unknown',
  };
}

export function emptyLocation(state: Exclude<EvidenceLocationState, 'captured'>): EvidenceLocation {
  return {
    state,
    observedAtUtc: '',
    latitude: null,
    longitude: null,
    accuracyMetres: null,
    altitudeMetres: null,
    altitudeAccuracyMetres: null,
    headingDegrees: null,
    speedMetresPerSecond: null,
    mocked: null,
  };
}

function locationSnapshot(location: Location.LocationObject): EvidenceLocation {
  return {
    state: 'captured',
    observedAtUtc: new Date(location.timestamp).toISOString(),
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracyMetres: location.coords.accuracy,
    altitudeMetres: location.coords.altitude,
    altitudeAccuracyMetres: location.coords.altitudeAccuracy,
    headingDegrees: location.coords.heading,
    speedMetresPerSecond: location.coords.speed,
    mocked: typeof location.mocked === 'boolean' ? location.mocked : null,
  };
}

export async function observeLocation(
  requestPermission: boolean,
): Promise<{ permission: EvidencePermissionState; location: EvidenceLocation }> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted && requestPermission && permission.canAskAgain) {
      permission = await Location.requestForegroundPermissionsAsync();
    }
    const permissionState = locationPermissionState(permission);
    if (!permission.granted) {
      return { permission: permissionState, location: emptyLocation('permission_denied') };
    }
    if (!await Location.hasServicesEnabledAsync()) {
      return { permission: permissionState, location: emptyLocation('services_disabled') };
    }
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
      mayShowUserSettingsDialog: true,
    });
    return { permission: permissionState, location: locationSnapshot(location) };
  } catch {
    return {
      permission: locationPermissionState(await Location.getForegroundPermissionsAsync().catch(() => undefined)),
      location: emptyLocation('error'),
    };
  }
}

function timezoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function observedTime() {
  const observed = new Date();
  return {
    captureObservedAtUtc: observed.toISOString(),
    utcOffsetMinutes: -observed.getTimezoneOffset(),
    timeZone: timezoneName(),
  };
}

function safeExif(exif: Record<string, unknown> | null | undefined) {
  if (!exif) return null;
  try {
    return JSON.parse(JSON.stringify(exif)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function serialisableAsset(asset: ImagePickerAsset): NonNullable<PendingPhotoCapture['asset']> {
  return {
    uri: asset.uri,
    fileName: asset.fileName || null,
    mimeType: asset.mimeType || null,
    fileSize: asset.fileSize ?? null,
    width: asset.width,
    height: asset.height,
    exif: safeExif(asset.exif),
  };
}

export async function buildEvidenceEnvelope(input: {
  captureSessionId: string;
  source: EvidenceCaptureSource;
  identifiers: EvidenceIdentifiers;
  cameraPermission?: EvidencePermissionState;
  locationPermission?: EvidencePermissionState;
  location?: EvidenceLocation;
  asset?: Pick<NonNullable<PendingPhotoCapture['asset']>, 'width' | 'height' | 'exif'>;
  observedTime?: ReturnType<typeof observedTime>;
}): Promise<Omit<EvidenceCaptureEnvelope, 'integrity'>> {
  const observed = input.observedTime || observedTime();
  validateEvidenceIdentifiers(input.identifiers);
  return {
    schemaVersion: 1,
    captureSessionId: input.captureSessionId,
    source: input.source,
    identifiers: input.identifiers,
    capture: {
      observedAtUtc: observed.captureObservedAtUtc,
      utcOffsetMinutes: observed.utcOffsetMinutes,
      timeZone: observed.timeZone,
      cameraPermission: input.cameraPermission || notRequestedPermission,
      locationPermission: input.locationPermission || notRequestedPermission,
    },
    location: input.location || emptyLocation('not_requested'),
    original: {
      preservedWithoutAppTransformation: true,
      editingApplied: false,
      pickerQuality: input.source === 'in_app_camera' ? 1 : null,
      exifRequested: input.source === 'in_app_camera',
      exifState: input.source === 'document_picker'
        ? 'not_applicable'
        : input.asset?.exif
          ? 'available'
          : 'not_returned',
      exif: input.asset?.exif || null,
      widthPixels: input.asset?.width ?? null,
      heightPixels: input.asset?.height ?? null,
    },
    provenance: {
      installationId: await getDeviceId(),
      appId: Application.applicationId || '',
      appName: Application.applicationName || 'AEA Field',
      appVersion: APP_VERSION,
      nativeVersion: Application.nativeApplicationVersion || '',
      nativeBuildVersion: Application.nativeBuildVersion || '',
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      isPhysicalDevice: Device.isDevice,
      manufacturer: Device.manufacturer || '',
      modelName: Device.modelName || '',
      osName: Device.osName || '',
      osVersion: Device.osVersion || '',
    },
    acceptance: {
      status: 'not_assessed',
      statement: 'Captured evidence still requires the applicable scheme and compliance review.',
    },
  };
}

export function completeEvidenceEnvelope(
  envelope: Omit<EvidenceCaptureEnvelope, 'integrity'>,
  integrity: { digestHex: string; byteLength: number },
): EvidenceCaptureEnvelope {
  return {
    ...envelope,
    integrity: {
      algorithm: 'SHA-256',
      digestHex: integrity.digestHex,
      byteLength: integrity.byteLength,
      computedAtUtc: new Date().toISOString(),
    },
  };
}

export function captureSessionId() {
  return `capture-${Crypto.randomUUID()}`;
}
