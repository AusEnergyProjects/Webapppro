import { mediaDevices, type MediaStream } from 'react-native-webrtc';

export type NativeCallMode = 'audio' | 'video';

export function releaseNativeCallMedia(stream: MediaStream | null) {
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
  stream.release();
}

export async function acquireNativeCallMedia(mode: NativeCallMode, isCurrent: () => boolean) {
  const stream = await mediaDevices.getUserMedia({ audio: true,
    video: mode === 'video' ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 } : false });
  if (!isCurrent()) {
    releaseNativeCallMedia(stream);
    return null;
  }
  if (!stream.getAudioTracks().length || (mode === 'video' && !stream.getVideoTracks().length)) {
    releaseNativeCallMedia(stream);
    throw new Error(mode === 'video' ? 'The camera or microphone did not open. Try voice only, or check device permissions.' : 'The microphone did not open. Check device permissions.');
  }
  return stream;
}

export function nativeCallError(error: unknown, mode: NativeCallMode) {
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : 'The call could not connect. Please try again.';
  if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(name) || /permission.*denied|not authorized/i.test(message)) {
    return { message: `Allow TLink to use your microphone${mode === 'video' ? ' and camera' : ''} in device settings, then retry.`, settings: true };
  }
  if (['NotFoundError', 'DevicesNotFoundError'].includes(name)) {
    return { message: mode === 'video' ? 'No camera or microphone was found. Try voice only, or reconnect your device.' : 'No microphone was found. Reconnect your microphone and retry.', settings: false };
  }
  if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) {
    return { message: 'The camera or microphone is unavailable. Close other calling or camera apps, then retry.', settings: false };
  }
  return { message, settings: false };
}
