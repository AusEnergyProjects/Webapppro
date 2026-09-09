export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

/** Read UTF-8 without buffering more than the permitted request size. */
export async function readBoundedRequestText(request, maximumBytes) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maximumBytes) throw new RequestBodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new RequestBodyTooLargeError();
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    // Cancellation is cleanup only; preserve the original size/encoding error.
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
