export const MAXIMUM_CREDITEX_JSON_BYTES = 16 * 1024;

export type BoundedJsonRequestErrorCode =
  | "REQUEST_TOO_LARGE"
  | "REQUEST_JSON_INVALID";

export class BoundedJsonRequestError extends Error {
  readonly code: BoundedJsonRequestErrorCode;
  readonly status: number;

  constructor(
    code: BoundedJsonRequestErrorCode,
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "BoundedJsonRequestError";
    this.code = code;
    this.status = status;
  }
}

export async function readBoundedJsonRequest(
  request: Request,
  maximumBytes = MAXIMUM_CREDITEX_JSON_BYTES,
): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error("maximumBytes must be a positive safe integer.");
  }

  if (!request.body) {
    throw new BoundedJsonRequestError(
      "REQUEST_JSON_INVALID",
      400,
      "Send a valid JSON request body.",
    );
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let jsonText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new BoundedJsonRequestError(
          "REQUEST_TOO_LARGE",
          413,
          "The request exceeds 16 KiB.",
        );
      }
      jsonText += decoder.decode(value, { stream: true });
    }
    jsonText += decoder.decode();
  } catch (error) {
    if (error instanceof BoundedJsonRequestError) throw error;
    throw new BoundedJsonRequestError(
      "REQUEST_JSON_INVALID",
      400,
      "Send a valid UTF-8 JSON request body.",
    );
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    throw new BoundedJsonRequestError(
      "REQUEST_JSON_INVALID",
      400,
      "Send a valid JSON request body.",
    );
  }
}
