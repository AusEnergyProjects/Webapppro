import { WATTZUN_MAX_AUDIO_BYTES, WATTZUN_VOICE_STREAM_TYPE, WATTZUN_REALTIME_VOICE_STREAM_TYPE, type WattzunReply, type WattzunVoiceResult } from "./wattzun-portal.ts";

const MAX_FRAME = 64_000;
const unreadable = () => new Error("Wattzun returned an unreadable voice reply. Try again.");

/** A validated reply precedes bounded PCM frames; a done frame proves clean completion. */
export async function readWattzunVoiceStream(response: Response, signal: AbortSignal,
  isReply: (value: unknown) => value is WattzunReply): Promise<WattzunVoiceResult> {
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error : "Wattzun could not complete that request. Try again.");
  }
  const contentType = response.headers.get("content-type")?.split(";")[0];
  const realtime = contentType === WATTZUN_REALTIME_VOICE_STREAM_TYPE;
  if ((!realtime && contentType !== WATTZUN_VOICE_STREAM_TYPE) || !response.body) throw unreadable();
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", bytes = 0, wireBytes = 0, finished = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const dispose = () => { signal.removeEventListener("abort", cancel); reader.releaseLock(); };
  signal.addEventListener("abort", cancel, { once: true });
  async function frame(): Promise<unknown> {
    while (true) {
      if (signal.aborted) throw new Error("Call ended.");
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        if (newline > MAX_FRAME) throw unreadable();
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        return JSON.parse(line) as unknown;
      }
      if (buffer.length > MAX_FRAME) throw unreadable();
      const chunk = await reader.read();
      if (chunk.done) throw unreadable();
      wireBytes += chunk.value.byteLength;
      if (wireBytes > WATTZUN_MAX_AUDIO_BYTES * 1.5 + MAX_FRAME) throw unreadable();
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  }
  try {
    const header = await frame();
    if (!header || typeof header !== "object" || !("type" in header) || header.type !== "reply"
      || !("transcript" in header) || typeof header.transcript !== "string" || (!realtime && !header.transcript.trim()) || header.transcript.length > 4_000
      || !("reply" in header) || !isReply(header.reply)) throw unreadable();
    const requestSummary = "requestSummary" in header ? header.requestSummary : undefined;
    if (requestSummary !== undefined && (!realtime || typeof requestSummary !== "string" || !requestSummary.trim() || requestSummary.length > 1800)) throw unreadable();
    let transcript = header.transcript;
    let finishInput: (value: string) => void = () => {};
    const inputTranscript = new Promise<string>(resolve => { finishInput = resolve; });
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await frame();
          if (!next || typeof next !== "object" || !("type" in next)) throw unreadable();
          if (next.type === "done") {
            if (!bytes || bytes % 2) throw unreadable();
            if ("transcript" in next) {
              if (!realtime || typeof next.transcript !== "string" || !next.transcript.trim() || next.transcript.length > 4_000
                || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(next.transcript)) throw unreadable();
              transcript = next.transcript.trim();
            }
            finishInput(transcript);
            finished = true; await reader.cancel(); dispose(); controller.close(); return;
          }
          if (next.type !== "audio" || !("data" in next) || typeof next.data !== "string" || !next.data
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(next.data)) throw unreadable();
          const audio = Uint8Array.from(atob(next.data), char => char.charCodeAt(0));
          bytes += audio.byteLength;
          if (!audio.byteLength || bytes > WATTZUN_MAX_AUDIO_BYTES) throw unreadable();
          controller.enqueue(audio);
        } catch { finishInput(transcript); finished = true; await reader.cancel().catch(() => {}); dispose(); controller.error(signal.aborted ? new Error("Call ended.") : unreadable()); }
      },
      async cancel() { if (!finished) { finishInput(transcript); finished = true; await reader.cancel().catch(() => {}); dispose(); } },
    }, { highWaterMark: 0 });
    return { ok: true, get transcript() { return transcript; }, inputTranscript, ...(typeof requestSummary === "string" ? { requestSummary } : {}), reply: header.reply, audio: { mimeType: "audio/pcm", stream } };
  } catch { await reader.cancel().catch(() => {}); dispose(); throw signal.aborted ? new Error("Call ended.") : unreadable(); }
}
