import { mediaDevices, type MediaStream } from 'react-native-webrtc';

export type NativeCallMode = 'audio' | 'video';

export function releaseNativeCallMedia(stream: MediaStream | null) {
  if (!stream) return;
  stream.getTracks().forEach(track => track.stop());
  stream.release();
}

export async function acquireNativeCallMedia(mode: NativeCallMode, isCurrent: () => boolean, signal?: AbortSignal) {
  if (signal?.aborted) return null;
  let expired = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const request = mediaDevices.getUserMedia({ audio: true,
    video: mode === 'video' ? { facingMode: 'user', width: 640, height: 480, frameRate: 24 } : false }).then(stream => {
    if (expired || !isCurrent()) { releaseNativeCallMedia(stream); return null; }
    return stream;
  });
  let stream: MediaStream | null;
  try {
    stream = await Promise.race([request, new Promise<null>((resolve, reject) => {
      abort = () => { expired = true; resolve(null); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      timeout = setTimeout(() => {
        expired = true;
        const error = new Error('Microphone or camera access was not completed. Allow access when your device asks, then retry.');
        error.name = 'NativeCallMediaPermissionTimeout';
        reject(error);
      }, 30_000);
    })]);
  } finally { clearTimeout(timeout); if (abort) signal?.removeEventListener('abort', abort); }
  if (!stream) return null;
  if (!isCurrent()) {
    releaseNativeCallMedia(stream);
    return null;
  }
  if (!stream.getAudioTracks().length || (mode === 'video' && !stream.getVideoTracks().length)) {
    releaseNativeCallMedia(stream);
    // react-native-webrtc returns a partial stream when only one requested
    // permission is granted. Treat it as a permission failure, not a call.
    const error = new Error(mode === 'video' ? 'Allow microphone and camera access, or try voice only.' : 'Allow microphone access to answer.');
    error.name = 'NotAllowedError';
    throw error;
  }
  return stream;
}

export function nativeCallError(error: unknown, mode: NativeCallMode) {
  const name = error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : '';
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : 'The call could not connect. Please try again.';
  if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError', 'NativeCallMediaPermissionTimeout'].includes(name) || /permission.*denied|not authorized/i.test(message)) {
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
