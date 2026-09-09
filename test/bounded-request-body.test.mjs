import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedRequestText, RequestBodyTooLargeError } from "../src/lib/bounded-request-body.mjs";

function streamed(chunks, headers = {}) {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) { if (chunks.length) controller.enqueue(chunks.shift()); else controller.close(); },
    cancel() { cancelled = true; },
  });
  return { request: new Request("https://example.test/api/leads", { method: "POST", body, duplex: "half", headers }), cancelled: () => cancelled };
}

test("request limit counts UTF-8 bytes despite absent or understated Content-Length", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    const input = streamed([new TextEncoder().encode("é".repeat(40_000)), new Uint8Array(1)], headers);
    await assert.rejects(readBoundedRequestText(input.request, 65_536), RequestBodyTooLargeError);
    assert.equal(input.cancelled(), true);
  }
});

test("chunked request cancels at the first byte over budget", async () => {
  const input = streamed([new Uint8Array(4), new Uint8Array(4), new Uint8Array(1), new Uint8Array(99)]);
  await assert.rejects(readBoundedRequestText(input.request, 8), RequestBodyTooLargeError);
  assert.equal(input.cancelled(), true);
});

test("exact-limit UTF-8 split across chunks decodes correctly", async () => {
  const bytes = new TextEncoder().encode("é猫");
  const input = streamed([bytes.slice(0, 1), bytes.slice(1, 3), bytes.slice(3)]);
  assert.equal(await readBoundedRequestText(input.request, 5), "é猫");
});

test("invalid and truncated UTF-8 fail instead of silently replacing bytes", async () => {
  for (const bytes of [new Uint8Array([0xff]), new Uint8Array([0xc3])]) {
    await assert.rejects(readBoundedRequestText(streamed([bytes]).request, 16), TypeError);
  }
});
