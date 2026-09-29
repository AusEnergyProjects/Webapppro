import { MESSAGE_AUDIO_BYTES, type MessageAttachment, type MessageMediaAuth } from "./trade-message-media";

export async function prepareMessagePhoto(file: File, avatar = false) {
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024) throw new Error("Choose a photo smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 50000000) throw new Error("This photo is too large. Choose a smaller copy.");
    const limit = avatar ? 512 : 2000, ratio = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo editing is unavailable in this browser.");
    context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Photo could not be prepared.")), "image/jpeg", 0.82));
    return new File([blob], avatar ? "profile.jpg" : "photo.jpg", { type: "image/jpeg" });
  } finally { bitmap.close(); }
}

export async function uploadPrivateMessageFile(file: File, target: { threadId: string } | { memberId: string }, getAuthHeaders: MessageMediaAuth, signal?: AbortSignal, request: typeof fetch = fetch) {
  const form = new FormData(); form.set("file", file);
  if ("threadId" in target) { form.set("purpose", "message"); form.set("threadId", target.threadId); }
  else { form.set("purpose", "avatar"); form.set("memberId", target.memberId); }
  const headers = new Headers(await getAuthHeaders()); headers.delete("Content-Type");
  const response = await request("/api/trade-message-media", { method: "POST", headers, body: form, signal });
  const result: { ok?: boolean; error?: string; attachment?: MessageAttachment } = await response.json();
  if (!response.ok || !result.ok || !result.attachment) throw new Error(result.error || "Upload failed. Please try again.");
  return result.attachment;
}

export async function removePrivateMessageFile(id: string, getAuthHeaders: MessageMediaAuth, request: typeof fetch = fetch) {
  const response = await request(`/api/trade-message-media?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: await getAuthHeaders() });
  if (!response.ok) throw new Error("Attachment could not be removed. Please try again.");
}

export function voiceNoteMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"].find(type => MediaRecorder.isTypeSupported(type)) || "";
}

export async function startVoiceNoteCapture(input: { signal: AbortSignal; onComplete: (file: File) => void; onError: (error: Error) => void }) {
  if (input.signal.aborted) throw new DOMException("Recording cancelled", "AbortError");
  const mimeType = voiceNoteMimeType();
  if (!mimeType || !navigator.mediaDevices?.getUserMedia) throw new Error("Voice recording is unavailable in this browser.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  const stopTracks = () => stream.getTracks().forEach(track => track.stop());
  if (input.signal.aborted) { stopTracks(); throw new DOMException("Recording cancelled", "AbortError"); }
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64000 }); }
  catch (error) { stopTracks(); throw error; }
  const chunks: Blob[] = []; let bytes = 0, cancelled = false, failed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const finish = (cancel: boolean) => {
    cancelled ||= cancel;
    if (timeout) clearTimeout(timeout);
    if (recorder.state !== "inactive") recorder.stop();
    stopTracks();
  };
  const abort = () => finish(true);
  input.signal.addEventListener("abort", abort, { once: true });
  recorder.ondataavailable = event => {
    bytes += event.data.size;
    if (bytes > MESSAGE_AUDIO_BYTES) { failed = true; finish(true); input.onError(new Error("Voice note is too large. Record a shorter message.")); }
    else if (event.data.size) chunks.push(event.data);
  };
  recorder.onerror = () => { failed = true; finish(true); input.onError(new Error("Recording stopped unexpectedly. Please try again.")); };
  recorder.onstop = () => {
    if (timeout) clearTimeout(timeout);
    stopTracks(); input.signal.removeEventListener("abort", abort);
    if (!cancelled && !failed && !input.signal.aborted && bytes) {
      const type = recorder.mimeType || mimeType;
      const extension = type.startsWith("audio/mp4") ? "m4a" : type.startsWith("audio/ogg") ? "ogg" : "webm";
      input.onComplete(new File(chunks, `voice-note.${extension}`, { type }));
    } else if (!cancelled && !failed && !input.signal.aborted) input.onError(new Error("No audio was recorded. Please try again."));
  };
  try { recorder.start(1000); timeout = setTimeout(() => finish(false), 90000); }
  catch (error) { input.signal.removeEventListener("abort", abort); stopTracks(); throw error; }
  return { stop: () => finish(false), cancel: () => finish(true) };
}
