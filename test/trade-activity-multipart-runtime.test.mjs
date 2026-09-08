import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import nextConfig from "../next.config.ts";
import { parseBodySizeLimit } from "../node_modules/vinext/dist/config/next-config.js";
import {
  handleProgressiveServerActionRequest,
  readActionFormDataWithLimit,
} from "../node_modules/vinext/dist/server/app-server-action-execution.js";

const MiB = 1024 * 1024;
const configuredLimit = parseBodySizeLimit(nextConfig.experimental?.serverActions?.bodySizeLimit);
const endpoint = "https://example.test/api/trade-activity-forms";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function multipartRequest(original, preview, metadataBytes = 0) {
  const body = new FormData();
  body.append("action", "upload");
  body.append("file", new Blob([original], { type: "image/jpeg" }), "original.jpg");
  if (preview) body.append("preview", new Blob([preview], { type: "image/jpeg" }), "preview.jpg");
  if (metadataBytes) body.append("captureMetadata", "x".repeat(metadataBytes));
  const source = new Request(endpoint, { method: "POST", body });
  const bytes = await source.arrayBuffer();
  return new Request(endpoint, {
    method: "POST",
    headers: { "content-type": source.headers.get("content-type"), "content-length": String(bytes.byteLength) },
    body: bytes,
  });
}

function progressiveGuard(request, maxActionBodySize) {
  return handleProgressiveServerActionRequest({
    request,
    contentType: request.headers.get("content-type"),
    actionId: null,
    allowedOrigins: [],
    maxActionBodySize,
    clearRequestContext() {},
    readFormDataWithLimit: readActionFormDataWithLimit,
    decodeAction: async () => null,
    getAndClearPendingCookies: () => [],
    reportRequestError() {},
  });
}

test("ordinary mobile photo passes Vinext before API dispatch with unchanged original bytes", async () => {
  const original = new Uint8Array(3_037_500).fill(0xa5);
  const blocked = await progressiveGuard(await multipartRequest(original), parseBodySizeLimit(undefined));
  assert.equal(blocked.status, 413);
  assert.equal(await blocked.text(), "Payload Too Large");

  const request = await multipartRequest(original);
  assert.equal(await progressiveGuard(request, configuredLimit), null);
  const delivered = await request.formData();
  assert.equal(delivered.get("file").name, "original.jpg");
  assert.equal(delivered.get("file").type, "image/jpeg");
  assert.equal(sha256(new Uint8Array(await delivered.get("file").arrayBuffer())), sha256(original));
});

test("activity original plus report preview and capture envelope fits the framework upload guard", async () => {
  const original = new Uint8Array(8 * MiB).fill(0x35);
  const preview = new Uint8Array(MiB).fill(0x5a);
  const request = await multipartRequest(original, preview, 16 * 1024);
  assert.ok(Number(request.headers.get("content-length")) <= 9 * MiB + 32 * 1024);
  assert.equal(await progressiveGuard(request, configuredLimit), null);
  const delivered = await request.formData();
  assert.equal(delivered.get("file").size, original.byteLength);
  assert.equal(delivered.get("preview").size, preview.byteLength);
  assert.equal(sha256(new Uint8Array(await delivered.get("file").arrayBuffer())), sha256(original));
});

test("framework guard still rejects oversized multipart requests", async () => {
  assert.equal(configuredLimit, 16 * MiB);
  const request = new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(configuredLimit + 1) },
    body: "--test--\r\n",
  });
  const response = await progressiveGuard(request, configuredLimit);
  assert.equal(response.status, 413);
  assert.equal(await response.text(), "Payload Too Large");
});
