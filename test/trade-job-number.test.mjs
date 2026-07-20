import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTlinkJobNumber,
  nextTlinkJobNumber,
  reserveTlinkJobNumbers,
} from "../src/lib/trade-job-number-server.ts";

const codePattern = /^TLJ-X[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/;

function counterDb(returnedValues) {
  const values = [...returnedValues];
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return { last_value: values.shift() };
            },
          };
        },
      };
    },
  };
}

test("future TLink job references are opaque, readable and deterministic", () => {
  const references = Array.from({ length: 2_000 }, (_, index) => formatTlinkJobNumber(index + 1));

  assert.equal(new Set(references).size, references.length);
  assert.ok(references.every((reference) => codePattern.test(reference)));
  assert.equal(formatTlinkJobNumber(804), formatTlinkJobNumber(804));
  assert.notEqual(formatTlinkJobNumber(804), "TLJ-00000804");
  assert.ok(references.every((reference) => !/^TLJ-\d{8}$/.test(reference)));
  assert.notDeepEqual(references.slice(0, 8), [...references.slice(0, 8)].sort());
});

test("the opaque formatter rejects values outside its collision-free space", () => {
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, (2 ** 32) + 1]) {
    assert.throws(() => formatTlinkJobNumber(invalid), /JOB_NUMBER_UNAVAILABLE/);
  }
  assert.match(formatTlinkJobNumber(2 ** 32), codePattern);
});

test("single and bulk allocation encode the same global counter sequence", async () => {
  const now = "2026-07-21T00:00:00.000Z";
  assert.equal(await nextTlinkJobNumber(counterDb([805]), now), formatTlinkJobNumber(805));
  assert.deepEqual(
    await reserveTlinkJobNumbers(counterDb([808]), 3, now),
    [806, 807, 808].map(formatTlinkJobNumber),
  );
});

test("bulk allocation remains bounded", async () => {
  assert.deepEqual(await reserveTlinkJobNumbers(counterDb([]), 0, "2026-07-21T00:00:00.000Z"), []);
});
