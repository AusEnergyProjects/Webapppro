export type TeamCallMode = "audio" | "video";
export type CameraFacing = "user" | "environment";

export function teamCallMediaConstraints(mode: TeamCallMode): MediaStreamConstraints {
  return {
    audio: { echoCancellation: true, noiseSuppression: true },
    video: mode === "video" ? { ...teamCallCameraConstraints(), facingMode: { ideal: "user" } } : false,
  };
}

export function teamCallCameraConstraints(facing?: CameraFacing): MediaTrackConstraints {
  return {
    width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 },
    ...(facing ? { facingMode: { exact: facing } } : {}),
  };
}

export function teamCallMediaError(error: unknown, mode: TeamCallMode): string {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  const devices = mode === "video" ? "microphone and camera" : "microphone";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `Your ${devices} permission is blocked. Open this site's permissions beside the address bar, allow access, then retry. On a phone, also check the browser's permission in device settings.`;
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return mode === "video" ? "A microphone or camera is unavailable. Connect your devices and retry, or use voice only." : "No microphone was found. Connect a microphone or headset and retry.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return `Your ${devices} could not open. Close other apps using them, then retry.`;
  }
  return error instanceof Error ? error.message : "The call could not start. Check your connection and retry.";
}
