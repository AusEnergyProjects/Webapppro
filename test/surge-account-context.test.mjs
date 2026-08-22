import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  deleteSurgeAccountContext,
  loadSurgeAccountContext,
  saveSurgeAccountContext,
} from "../src/lib/surge-account-context-server.ts";
import {
  EMPTY_SURGE_STARTER_PROFILE,
  SURGE_PROFILE_VERSION,
} from "../src/lib/surge-assessor-profile.ts";

function database() {
  let stored = null;
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.values = values;
          return this;
        },
        async first() {
          return stored ? { profile_json: stored } : null;
        },
        async run() {
          if (sql.includes("INSERT INTO")) stored = call.values[1];
          if (sql.includes("DELETE FROM")) stored = null;
          return { success: true };
        },
      };
    },
  };
}

test("signed-in Surge context is stored only against the authenticated owner", async () => {
  const db = database();
  const profile = {
    ...EMPTY_SURGE_STARTER_PROFILE,
    version: SURGE_PROFILE_VERSION,
    postcode: "3000",
    reviewed: ["postcode"],
  };
  await saveSurgeAccountContext(db, "firebase-owner", profile, new Date("2026-08-22T00:00:00.000Z"));
  const loaded = await loadSurgeAccountContext(db, "firebase-owner");
  assert.equal(loaded?.postcode, "3000");
  assert.deepEqual(loaded?.reviewed, ["postcode"]);
  assert.ok(db.calls.every((call) => call.values[0] === "firebase-owner"));
  await deleteSurgeAccountContext(db, "firebase-owner");
  assert.equal(await loadSurgeAccountContext(db, "firebase-owner"), null);
});

test("the account API requires explicit save and delete confirmation", () => {
  const source = fs.readFileSync("src/app/api/energy-assistant/account-context/route.ts", "utf8");
  assert.match(source, /confirmAccountContextSave !== true/);
  assert.match(source, /confirmDelete !== true/);
  assert.match(source, /requireFirebaseIdentity/);
  assert.match(source, /Cache-Control.*no-store/s);
});

test("the signed-in controls do not associate browser context automatically", () => {
  const source = fs.readFileSync("src/components/SurgeAccountContextControls.tsx", "utf8");
  assert.match(source, /Save context to my account/);
  assert.match(source, /Delete account copy/);
  assert.doesNotMatch(source, /accountContextRequest\(nextUser, "PUT"/);
  assert.match(source, /onClick=\{save\}/);
  assert.match(source, /onClick=\{remove\}/);
});
