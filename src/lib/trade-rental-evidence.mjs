function object(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value) {
  const input = String(value || "");
  if (!input) return "";
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

const MAX_RENTAL_PHOTO_ACCURACY_METRES = 100;
const MAX_RENTAL_PHOTO_AGE_MS = 15 * 60 * 1000;
const MAX_RENTAL_PHOTO_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_RENTAL_LOCATION_CAPTURE_GAP_MS = 2 * 60 * 1000;

function milliseconds(value) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

export function rentalEvidenceCapture(value) {
  const envelope = object(value);
  const capture = object(envelope.capture);
  const location = object(envelope.location);
  const capturedAtUtc = iso(capture.captureObservedAtUtc || capture.observedAtUtc);
  const locationObservedAtUtc = iso(location.observedAtUtc);
  const latitude = finite(location.latitude);
  const longitude = finite(location.longitude);
  const accuracyMetres = finite(location.accuracyMetres);
  const locationMocked = location.mocked === true ? true : location.mocked === false ? false : null;
  const source = String(envelope.source || "");
  if (!capturedAtUtc || !["in_app_camera", "web_file_upload"].includes(source)) return null;
  const locationCaptured = String(location.state || "") === "captured"
    && Boolean(locationObservedAtUtc)
    && latitude !== null && latitude >= -90 && latitude <= 90
    && longitude !== null && longitude >= -180 && longitude <= 180
    && accuracyMetres !== null && accuracyMetres >= 0 && accuracyMetres <= MAX_RENTAL_PHOTO_ACCURACY_METRES;
  return {
    source,
    metadataBasis: "device_reported",
    capturedAtUtc,
    utcOffsetMinutes: Math.max(-840, Math.min(840, Math.trunc(finite(capture.utcOffsetMinutes) || 0))),
    timeZone: String(capture.timeZone || "unknown").slice(0, 100),
    locationCaptured,
    locationObservedAtUtc: locationCaptured ? locationObservedAtUtc : "",
    latitude: locationCaptured ? latitude : null,
    longitude: locationCaptured ? longitude : null,
    accuracyMetres: locationCaptured ? accuracyMetres : null,
    locationMocked: locationCaptured ? locationMocked : null,
  };
}

export function rentalEvidencePhotoCapture(value, options = {}) {
  const capture = rentalEvidenceCapture(value);
  if (!capture?.locationCaptured || capture.locationMocked === true) return null;
  const capturedAt = milliseconds(capture.capturedAtUtc);
  const locationAt = milliseconds(capture.locationObservedAtUtc);
  if (capturedAt === null || locationAt === null
    || Math.abs(locationAt - capturedAt) > MAX_RENTAL_LOCATION_CAPTURE_GAP_MS) return null;
  if (options.receivedAtUtc) {
    const receivedAt = milliseconds(options.receivedAtUtc);
    if (receivedAt === null
      || capturedAt > receivedAt + MAX_RENTAL_PHOTO_CLOCK_SKEW_MS
      || locationAt > receivedAt + MAX_RENTAL_PHOTO_CLOCK_SKEW_MS
      || receivedAt - capturedAt > MAX_RENTAL_PHOTO_AGE_MS
      || receivedAt - locationAt > MAX_RENTAL_PHOTO_AGE_MS) return null;
  }
  return capture;
}
