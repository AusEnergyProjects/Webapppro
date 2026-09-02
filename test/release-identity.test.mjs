import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { releaseIdentityFromEnvironment } from "../src/lib/release-identity.mjs";

test("accepts an exact Git commit SHA as the runtime release identity", () => {
  assert.equal(
    releaseIdentityFromEnvironment({
      AEA_RELEASE_SHA: " AA184E8F4BF952A4B9A3315E3C86F9094499B517 ",
    }),
    "aa184e8f4bf952a4b9a3315e3c86f9094499b517",
  );
});

test("fails closed when the runtime release identity is absent or malformed", () => {
  assert.equal(releaseIdentityFromEnvironment({}), "");
  assert.equal(releaseIdentityFromEnvironment({ AEA_RELEASE_SHA: "version-495" }), "");
  assert.equal(releaseIdentityFromEnvironment(null), "");
});

test("the worker publishes the release identity only on the health response", () => {
  const worker = fs.readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /if \(pathname === "\/api\/health"\)/);
  assert.match(worker, /headers\.set\("X-Release-Id", releaseId\)/);
  assert.match(
    worker,
    /secureResponse\(queueBackgroundDispatches\(handled, ctx, request, env\), request, env\)/,
  );
});
